import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser, isEnvAdmin, legacyLeagueId, resolveLeagueRole } from "@/lib/serverAuth";
import { isStaffRole, roleLevel } from "@/lib/roles";
import {
  LEAGUE_ROLES_FIELD, hasLeagueRoles, leagueRolePatch, normalizeLeagueRoles,
} from "@/lib/leagueRoles";
import { linkedDriver } from "@/lib/carSelectionServer";
import { UPLOAD_DENIED_ERROR, canUploadImages, stripImageFields } from "@/lib/imagePermissions";

// The response shape, built once so every path through GET agrees. The role
// reported is the ACTIVE LEAGUE's — see the note on GET.
async function profileAnswer({ uid, data, leagueId, envAdmin, driver }) {
  const { [LEAGUE_ROLES_FIELD]: leagueRoles, ...profile } = data;
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
    // A brand-new account joins the league it signed in on as a Player. That
    // membership is what makes it visible to that league's admins — an account
    // with no entry for a league is unaffiliated with it and is left off its
    // roster — so a new signup being manageable at all depends on it.
    const seedRole = envAdmin ? "owner" : "player";
    const profile = {
      display_name: user.name || user.email?.split("@")[0] || "Driver",
      email: user.email || null,
      photo_url: user.picture || null,
      bio: "",
      country: "",
      number: null,
      role: seedRole,
      ...(leagueId ? { [LEAGUE_ROLES_FIELD]: { [leagueId]: seedRole } } : {}),
      created_at: new Date().toISOString(),
    };
    await ref.set(profile);
    return NextResponse.json(await profileAnswer({ uid: user.uid, data: profile, leagueId, envAdmin, driver }));
  }

  const data = doc.data();
  const updates = {};
  // Keep permanent env-var owners' stored role in sync so listings agree.
  if (envAdmin && data.role !== "owner") updates.role = "owner";

  // Register the account in this league if it has no standing here yet. This is
  // the "membership" the admin roster keys off, and it is deliberately the
  // LOWEST one: opening a league makes you a Player of it and nothing more.
  // Staff standing is only ever granted by an admin of that league.
  //
  // An account that hasn't been migrated at all is left alone. Its legacy global
  // role still answers inside the legacy league (see lib/leagueRoles.js), and
  // the containment migration is what writes that down properly — auto-stamping
  // "player" here would DEMOTE an existing admin who happened to sign in before
  // the migration was run, which is precisely the lockout this design exists to
  // avoid.
  const registered = normalizeLeagueRoles(data[LEAGUE_ROLES_FIELD]);
  const unregistered = !!leagueId
    && hasLeagueRoles(data)
    && !Object.prototype.hasOwnProperty.call(registered, leagueId);
  if (unregistered) {
    const patch = leagueRolePatch(leagueId, envAdmin ? "owner" : "player");
    if (patch) Object.assign(updates, patch);
  }
  if (Object.keys(updates).length) await ref.set(updates, { merge: true });

  const merged = {
    ...data,
    ...updates,
    [LEAGUE_ROLES_FIELD]: { ...registered, ...normalizeLeagueRoles(updates[LEAGUE_ROLES_FIELD]) },
  };
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
