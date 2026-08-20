import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { docInLeague, legacyLeagueId, withAdmin, isEnvAdmin } from "@/lib/serverAuth";
import { normalizeRole, roleLevel, canManage, ROLE_LABELS } from "@/lib/roles";
import {
  LEAGUE_ROLES_FIELD, isLeagueMember, leagueIdsFor, leagueRoleFor, leagueRolePatch,
  withoutLeague,
} from "@/lib/leagueRoles";
import { syncEntryNamesForDriver } from "@/lib/driverSync";
import { withStatsRefresh } from "@/lib/statsRefresh";

// The user doc an account would have received on its first verified request
// (mirrors /api/users/me), built from its Firebase Auth record. Used when an
// admin acts on an account that hasn't been through that flow yet.
function seedProfile(authRecord, leagueId) {
  return {
    display_name: authRecord.displayName || authRecord.email?.split("@")[0] || "Driver",
    email: authRecord.email || null,
    photo_url: authRecord.photoURL || null,
    bio: "",
    country: "",
    number: null,
    role: "player",
    // Seeded straight into the league the admin is acting from: the account is
    // being given standing here and nowhere else.
    ...(leagueId ? { [LEAGUE_ROLES_FIELD]: { [leagueId]: "player" } } : {}),
    created_at: authRecord.metadata?.creationTime
      ? new Date(authRecord.metadata.creationTime).toISOString()
      : new Date().toISOString(),
  };
}

// Admin-only: set a user's role WITHIN THE ACTIVE LEAGUE and/or (re)link the
// driver profile they race as HERE. Both changes flow through withAdmin, so the
// actor is a verified staff member OF THIS LEAGUE before anything is written.
//
//   body.role      → "owner" | "admin" | "moderator" | "statistician" | "player"
//   body.driver_id → driver doc id, or "" / null to unlink
//
// ── Everything here is scoped, and that is the point ───────────────────────
//
// Roles live in a map keyed by league (`users.league_roles` — see
// lib/leagueRoles.js). A role change writes ONE key of that map: promoting
// somebody to Moderator here says nothing at all about what they are anywhere
// else, and a Player here who is an Owner of another league is still only a
// Player to this screen. Both the actor's rank and the target's are read from
// this league's key, so the hierarchy rules below compare like with like.
//
// The user↔driver link is stored on the driver document (drivers.user_id),
// matching the rest of the app (career stats, roster, public profiles). A driver
// belongs to one league, so an account may hold one per league — setting a new
// link clears the one they held IN THIS LEAGUE and leaves the others alone.
const handlePATCH = withAdmin(async (request, { params }, admin, actorRole, leagueId) => {
  const { uid } = params;
  const body = await request.json().catch(() => ({}));

  const userRef = db().collection("users").doc(uid);
  const userDoc = await userRef.get();
  // An account that signed up but never made a verified request has no user doc
  // yet (see /api/users/me), and the dashboard now lists those from Firebase
  // Auth. Seed the doc from the Auth record so an admin can set a role or link a
  // driver before the player's first visit, instead of hitting a 404.
  const authRecord = userDoc.exists ? null : await adminAuth().getUser(uid).catch(() => null);
  if (!userDoc.exists && !authRecord) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const target = userDoc.exists ? userDoc.data() : seedProfile(authRecord, leagueId);
  if (!userDoc.exists) await userRef.set(target);

  const legacy = leagueId ? await legacyLeagueId() : null;
  const targetEnvAdmin = isEnvAdmin(target.email);
  const targetRole = targetEnvAdmin
    ? "owner"
    : leagueRoleFor(target, leagueId, { legacyLeagueId: legacy });
  const targetIsMember = !leagueId
    || targetEnvAdmin
    || isLeagueMember(target, leagueId, { legacyLeagueId: legacy });

  const changed = {};

  // --- Display name change ---------------------------------------------
  // For a driver linked to an account, the account's display_name is the name
  // shown everywhere (the pool-driver name is only a fallback), so this is how
  // an admin corrects a linked driver's name. The change cascades onto that
  // driver's roster entries so results, standings, and the race-entry pickers
  // all follow — only the denormalized name string is touched (zero data loss).
  //
  // display_name is one of the few genuinely GLOBAL fields on an account (it is
  // the person's name, not their standing anywhere), so editing it is gated on
  // the target actually being one of this league's people — an admin of League B
  // does not get to rename League A's players.
  if (body.display_name !== undefined) {
    const dn = String(body.display_name).trim();
    if (!dn) return NextResponse.json({ error: "Display name can't be empty." }, { status: 400 });
    if (uid !== admin.uid && !targetIsMember) {
      return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
    }
    // Same hierarchy guard as role edits, except you may always rename yourself.
    if (uid !== admin.uid && !canManage(actorRole, targetRole)) {
      return NextResponse.json({ error: `You can't edit a ${ROLE_LABELS[targetRole]} — they rank at or above your role.` }, { status: 403 });
    }
    await userRef.update({ display_name: dn });
    changed.display_name = dn;
    const linked = await db().collection("drivers").where("user_id", "==", uid).get();
    const here = linked.docs.find(d => docInLeague(d.data(), leagueId));
    if (here) {
      try { await syncEntryNamesForDriver(here.id); } catch (err) { console.error("display_name cascade failed", err); }
    }
  }

  // --- Role change ------------------------------------------------------
  if (body.role !== undefined) {
    const newRole = normalizeRole(body.role);

    // Guard against self-lockout: nobody can change their own role.
    if (uid === admin.uid) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }
    // Env-var owners are permanent; the DB role can't override ADMIN_EMAILS.
    if (targetEnvAdmin) {
      return NextResponse.json({ error: "This account is a permanent Owner (set via ADMIN_EMAILS) and can't be changed." }, { status: 400 });
    }
    // Hierarchy: can't touch an account at or above your own level — compared
    // within THIS league, since that is the only place either rank applies.
    if (!canManage(actorRole, targetRole)) {
      return NextResponse.json({ error: `You can't modify a ${ROLE_LABELS[targetRole]} — they rank at or above your role in this league.` }, { status: 403 });
    }
    // Hierarchy: can't hand out a role higher than your own.
    if (roleLevel(newRole) > roleLevel(actorRole)) {
      return NextResponse.json({ error: `You can't assign the ${ROLE_LABELS[newRole]} role — it's above your own.` }, { status: 403 });
    }

    if (leagueId) {
      // ONE key of the map. merge:true deep-merges it, so this account's
      // standing in every other league survives untouched — and an account that
      // wasn't a member of this league becomes one by being given a role here.
      await userRef.set(leagueRolePatch(leagueId, newRole), { merge: true });
    } else {
      // No league in play at all (pre-migration / a direct API call): fall back
      // to the legacy global field, which is what the app read before leagues.
      await userRef.update({ role: newRole });
    }
    changed.role = newRole;
    changed.league_id = leagueId || null;
  }

  // --- Driver profile link change --------------------------------------
  if (body.driver_id !== undefined) {
    const targetId = body.driver_id || null;
    if (!targetIsMember) {
      return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
    }
    const batch = db().batch();

    // Detach this user from whichever driver holds the link IN THIS LEAGUE. A
    // profile they hold in another league is a different person's worth of
    // history and is never touched from here.
    const existing = await db().collection("drivers").where("user_id", "==", uid).get();
    existing.docs.forEach(d => {
      if (d.id !== targetId && docInLeague(d.data(), leagueId)) batch.update(d.ref, { user_id: null });
    });

    if (targetId) {
      const targetRef = db().collection("drivers").doc(targetId);
      const targetDoc = await targetRef.get();
      if (!targetDoc.exists) return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
      if (!docInLeague(targetDoc.data(), leagueId)) {
        return NextResponse.json({ error: "That driver profile belongs to another league." }, { status: 404 });
      }
      // Overrides any other user that was linked to this driver.
      batch.update(targetRef, { user_id: uid });
    }

    await batch.commit();
    changed.driver_id = targetId;
  }

  if (!Object.keys(changed).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, uid, ...changed });
});

// Admin-only: remove a user from THIS LEAGUE — and delete the account outright
// only when this was the last league they belonged to.
//
// That split is what multi-tenancy demands. An account is a person and spans
// leagues; a membership is that person's standing in one of them. Before roles
// were per-league, "delete" could only mean "delete everything", and that is now
// a hole rather than a feature: a Moderator of a league somebody joined
// yesterday must not be able to erase the Firebase identity of a person who owns
// a different league. So:
//
//   • Member of other leagues → their role entry for THIS league is dropped,
//     the driver profile they raced as HERE is returned to this league's
//     unclaimed pool, and this league's claim requests of theirs are removed.
//     Everything of theirs elsewhere is untouched, and so is their sign-in.
//   • This was their only league → the account is deleted as it always was:
//     driver returned to the pool, claim requests dropped, user doc removed, and
//     the Firebase Auth user deleted so they can't sign back in and re-create it.
//
// Race results stay on record either way.
const handleDELETE = withAdmin(async (request, { params }, admin, actorRole, leagueId) => {
  const { uid } = params;

  // Guard against self-deletion (lockout) and permanent env-var owners.
  if (uid === admin.uid) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  }
  const userRef = db().collection("users").doc(uid);
  const userDoc = await userRef.get();
  // Accounts with no user doc are deletable too (they're listed straight from
  // Firebase Auth), so fall back to the Auth record for the guards below.
  const authRecord = userDoc.exists ? null : await adminAuth().getUser(uid).catch(() => null);
  const target = userDoc.exists ? userDoc.data() : null;
  const email = target?.email || authRecord?.email || null;
  if (isEnvAdmin(email)) {
    return NextResponse.json({ error: "This account is a permanent Owner (set via ADMIN_EMAILS) and can't be deleted." }, { status: 400 });
  }

  const legacy = leagueId ? await legacyLeagueId() : null;
  // Hierarchy: you can only remove accounts at or below your own level IN THIS
  // LEAGUE.
  const targetRole = leagueRoleFor(target, leagueId, { legacyLeagueId: legacy });
  if (!canManage(actorRole, targetRole)) {
    return NextResponse.json({ error: `You can't remove a ${ROLE_LABELS[targetRole]} — they rank at or above your role in this league.` }, { status: 403 });
  }
  if (leagueId && target && !isLeagueMember(target, leagueId, { legacyLeagueId: legacy })) {
    return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
  }

  const batch = db().batch();

  // The driver profile they raced as in this league goes back to its unclaimed
  // pool; profiles in other leagues are left linked.
  const linked = await db().collection("drivers").where("user_id", "==", uid).get();
  const linkedHere = linked.docs.filter(d => docInLeague(d.data(), leagueId));
  linkedHere.forEach(d => batch.update(d.ref, { user_id: null }));

  // Drop this user's claim requests in this league.
  const reqs = await db().collection("claim_requests").where("uid", "==", uid).get();
  const reqsHere = reqs.docs.filter(r => docInLeague(r.data(), leagueId));
  reqsHere.forEach(r => batch.delete(r.ref));

  // Do they still belong anywhere else? Only then is this a removal rather than
  // a deletion. An account with no map at all belongs to the legacy league only,
  // so removing it there IS the whole account.
  const otherLeagues = leagueIdsFor(target).filter(id => id !== leagueId);
  const removeOnly = !!leagueId && !!target && otherLeagues.length > 0;

  if (removeOnly) {
    batch.update(userRef, { [LEAGUE_ROLES_FIELD]: withoutLeague(target, leagueId) });
    await batch.commit();
    return NextResponse.json({ ok: true, uid, removed_from_league: leagueId, leagues_remaining: otherLeagues.length });
  }

  if (userDoc.exists) batch.delete(userRef);
  await batch.commit();

  // Delete the Firebase Auth identity (best-effort — it may already be gone).
  try { await adminAuth().deleteUser(uid); } catch { /* not found / already removed */ }

  return NextResponse.json({ ok: true, uid, deleted: true });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const PATCH = withStatsRefresh(handlePATCH);
export const DELETE = withStatsRefresh(handleDELETE);
