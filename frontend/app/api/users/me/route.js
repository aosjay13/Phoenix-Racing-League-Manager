import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser, isEnvAdmin, legacyLeagueId, resolveLeagueRole } from "@/lib/serverAuth";
import { isStaffRole, roleLevel } from "@/lib/roles";
import {
  LEAGUE_ROLES_FIELD, hasLeagueRoles, leagueRolePatch, normalizeLeagueRoles,
} from "@/lib/leagueRoles";
import { linkedDriver } from "@/lib/carSelectionServer";
import { selfUserFields } from "@/lib/userPrivacy";
import { UPLOAD_DENIED_ERROR, canUploadImages, stripImageFields } from "@/lib/imagePermissions";

// The response shape, built once so every path through GET agrees. The role
// reported is the ACTIVE LEAGUE's — see the note on GET.
async function profileAnswer({ uid, data, leagueId, envAdmin, driver }) {
  // The account's own view: its standing stays, but anything never meant to
  // leave the server (the recovery passphrase hash) is stripped here rather
  // than being spread out by accident. See lib/userPrivacy.js.
  const { [LEAGUE_ROLES_FIELD]: leagueRoles, ...profile } = selfUserFields(data);
  const role = envAdmin ? "owner" : await resolveLeagueRole(data, leagueId);
  // The APPLICATION owner, as distinct from the owner of whichever league is on
  // screen. Backup and restore span every league, so they are gated on this
  // rather than on `role` — and the UI needs to know, or it would offer an
  // export button that the server refuses. See isGlobalOwner in
  // lib/serverAuth.js: an ADMIN_EMAILS account, or the owner of the legacy
  // (oldest) league, which on a single-league install is the same person who was
  // simply "the Owner" before any of this.
  const legacy = await legacyLeagueId();
  const globalOwner = envAdmin
    || (legacy ? await resolveLeagueRole(data, legacy) : await resolveLeagueRole(data, "")) === "owner";
  return {
    uid,
    ...profile,
    role,
    role_level: roleLevel(role),
    is_admin: isStaffRole(role),
    env_admin: envAdmin,
    global_owner: globalOwner,
    // Which league the three fields above were computed for. The client holds on
    // to this so it can tell "not staff here" apart from "this answer is for the
    // league I just switched away from" while a switch is still in flight.
    league_id: leagueId || "",
    // Every league this account has standing in, so the UI can say so without a
    // second round trip.
    league_roles: normalizeLeagueRoles(leagueRoles),
    // Does this account belong to NO league at all? Answered here rather than
    // inferred from `league_roles` being empty, because the client can't see
    // the two things that make an empty map a lie: an env-var Owner (Owner
    // everywhere), and an account written before the map existed, whose
    // standing lives in its global role and counts inside the legacy league.
    // The shell reads this to send a brand-new account to /leagues instead of
    // to a Dashboard full of somebody else's league (see lib/leagueJoin.js).
    unaffiliated: !envAdmin
      && Object.keys(normalizeLeagueRoles(leagueRoles)).length === 0
      && !(!hasLeagueRoles(data) && !!legacy),
    driver_id: driver?.id || null,
    driver_name: driver?.name || null,
  };
}

// Called after sign-in AND on every league switch: creates/refreshes the user
// doc and returns it, answered FOR THE ACTIVE LEAGUE.
//
// `role`, `role_level` and `is_admin` describe this account IN THE LEAGUE THE
// REQUEST NAMED, never in the abstract — they are what the whole client-side UI
// gates on (AuthProvider -> AdminGate -> every admin button), so an Admin of
// League A reads back as a plain player the moment they switch to League B.
//
// It also reports the single driver profile linked to this account IN THIS
// LEAGUE (driver_id/driver_name) — one per league, which the claim flow
// enforces.
export const GET = withUser(async (request, ctx, user, leagueId) => {
  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  const envAdmin = isEnvAdmin(user.email);
  const driver = await linkedDriver(user.uid, leagueId);

  if (!doc.exists) {
    // A brand-new account, reached when somebody verified without passing
    // through the sign-up form's join call. It gets a profile and NO league
    // standing: being able to see a league is not being in one, and which
    // league lets this account in is that league's decision, not a side effect
    // of the page they happened to open. They land on /leagues to ask (see
    // lib/leagueJoin.js), and an approval is what writes the membership.
    //
    // The map is written as an EMPTY object rather than left off, which matters:
    // `hasLeagueRoles` keys the legacy fallback on the field being absent, so a
    // missing map would make this new account inherit the legacy league through
    // its global role. An empty map says "no standing anywhere", and means it.
    const seedRole = envAdmin ? "owner" : "player";
    const profile = {
      display_name: user.name || user.email?.split("@")[0] || "Driver",
      email: user.email || null,
      photo_url: user.picture || null,
      bio: "",
      country: "",
      number: null,
      role: seedRole,
      // Env-var Owners are Owner everywhere by definition, so recording it for
      // the league they arrived on grants nothing they didn't already have.
      [LEAGUE_ROLES_FIELD]: envAdmin && leagueId ? { [leagueId]: "owner" } : {},
      created_at: new Date().toISOString(),
    };
    await ref.set(profile);
    return NextResponse.json(await profileAnswer({ uid: user.uid, data: profile, leagueId, envAdmin, driver }));
  }

  const data = doc.data();
  const updates = {};
  // Keep permanent env-var owners' stored role in sync so listings agree.
  if (envAdmin && data.role !== "owner") updates.role = "owner";

  // This IS the first verified visit — withUser has already refused everything
  // that isn't one. So the "signed up, hasn't been through the door yet" flag
  // that POST /api/users/join set is no longer true, and the admin roster stops
  // showing them as pending. (Accounts that predate the flag never carry it, so
  // nothing changes for them.)
  if (data.signup_pending) updates.signup_pending = false;

  // ── Opening a league does NOT join it ────────────────────────────────────
  //
  // This route used to register the account as a Player of whatever league the
  // request named, the moment it had no standing there. It read as harmless —
  // "you're looking at it, so you're in it" — and it quietly undid the whole
  // point of per-league roles: every account on the installation drifted into
  // every league it ever glanced at, so League B's user roster filled up with
  // League A's players, its driver-link pickers offered strangers, and nobody
  // had ever decided to let any of them in.
  //
  // Membership is now something a league GRANTS. A player asks (POST
  // /api/league-join-requests), that league's own staff approve, and the
  // approval is the only thing that writes the key — see
  // /api/admin/league-join-requests/[id]. An account with no entry for this
  // league reads as a plain player of it and appears on none of its lists,
  // which is what being a stranger to a league should look like.
  //
  // Env-var Owners are the exception, as they are everywhere: they resolve to
  // Owner in every league by definition (see isEnvAdmin), so recording it
  // changes nothing about their access and only keeps the stored map honest
  // about the account that can always unstick a league.
  const registered = normalizeLeagueRoles(data[LEAGUE_ROLES_FIELD]);
  const needsEnvOwnerKey = envAdmin
    && !!leagueId
    && hasLeagueRoles(data)
    && registered[leagueId] !== "owner";
  if (needsEnvOwnerKey) {
    const patch = leagueRolePatch(leagueId, "owner");
    if (patch) Object.assign(updates, patch);
  }
  if (Object.keys(updates).length) await ref.set(updates, { merge: true });

  // The map is merged in only when there IS one. An account written before
  // `league_roles` existed has no such field, and that ABSENCE is exactly what
  // makes its old global role answer inside the legacy league (see
  // hasLeagueRoles in lib/leagueRoles.js). Writing an empty map in here would
  // flip the answer to "migrated, and a member of nothing", which reads the
  // existing league's Owner back as a plain player of their own league — the
  // lockout the legacy fallback exists to prevent.
  const mergedRoles = hasLeagueRoles(data) || updates[LEAGUE_ROLES_FIELD]
    ? { [LEAGUE_ROLES_FIELD]: { ...registered, ...normalizeLeagueRoles(updates[LEAGUE_ROLES_FIELD]) } }
    : {};
  const merged = { ...data, ...updates, ...mergedRoles };
  return NextResponse.json(await profileAnswer({ uid: user.uid, data: merged, leagueId, envAdmin, driver }));
});

const EDITABLE = ["display_name", "photo_url", "bio", "country", "number", "favorite_car", "socials"];
// `photo_url` is an image, and images cost storage — only the Owner may put a
// new one in (see lib/imagePermissions.js). The picture a player already has,
// including the one their sign-in account came with, keeps showing everywhere;
// what they can't do is upload another. Saving the rest of the profile with
// the same photo_url they were shown is not a change and passes through.
const IMAGE_EDITABLE = ["photo_url"];

export const PATCH = withUser(async (request, ctx, user, leagueId) => {
  const body = await request.json();
  const ref = db().collection("users").doc(user.uid);
  const updates = {};
  for (const f of EDITABLE) if (body[f] !== undefined) updates[f] = body[f];

  let write = updates;
  if (IMAGE_EDITABLE.some(f => f in updates)) {
    // Owner OF THIS LEAGUE — the storage bill belongs to a league, so being the
    // Owner of a different one buys nothing here.
    const doc = await ref.get();
    const existing = doc.exists ? doc.data() : {};
    const role = isEnvAdmin(user.email) ? "owner" : await resolveLeagueRole(existing, leagueId);
    if (!canUploadImages(role)) {
      const guarded = stripImageFields(updates, { fields: IMAGE_EDITABLE, existing });
      if (guarded.stripped.length && !Object.keys(guarded.updates).length) {
        return NextResponse.json({ error: UPLOAD_DENIED_ERROR }, { status: 403 });
      }
      write = guarded.updates;
    }
  }

  if (!Object.keys(write).length) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  await ref.set(write, { merge: true });
  return NextResponse.json({ ok: true });
});
