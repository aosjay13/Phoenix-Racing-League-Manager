// Strict per-league isolation of accounts, roles and driver links.
//
// A role used to be one global string on an account, which made "admin" mean
// admin of the whole installation. It is now a MAP keyed by league
// (`users.league_roles`), and the promise this suite exists to hold is a pair of
// opposites that are both easy to break, silently, in the same change:
//
//   1. ISOLATION. Standing in one league must buy nothing in another. An Owner
//      of League A opening League B is a stranger there — not staff, not on its
//      user roster, not linked to any of its drivers.
//   2. NO LOCKOUT. Every account that could run the existing league yesterday
//      must still run it today, whether or not the containment migration has
//      been run yet, and whether or not anybody remembered to set ADMIN_EMAILS.
//
// Promise 2 is the one that fails quietly and catastrophically: a wrong answer
// there doesn't throw, it just leaves the league owner staring at "This page is
// for league staff only" on their own league. So the legacy-fallback rules get
// the most cases here, including the ones that must NOT fall back.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminGate } from "@/components/AdminGate";
import {
  LEAGUE_ROLES_FIELD, adminGateVerdict, directLeagueRole, hasLeagueRoles,
  isLeagueKey, isLeagueMember, leagueIdsFor, leagueRoleFor, leagueRolePatch,
  normalizeLeagueRoles, seedLeagueRoles, withLeagueRole, withoutLeague,
} from "@/lib/leagueRoles";
import { ROLE_LEVEL, isStaffRole } from "@/lib/roles";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// The two leagues every case below is told apart by. A = the league that
// already existed (the containment migration's target); B = one created later.
const A = "leagueAAA111";
const B = "leagueBBB222";

// ── 1. The map itself ───────────────────────────────────────────────────────

check("an absent map reads as no memberships", normalizeLeagueRoles(undefined), {});
check("a null map reads as no memberships", normalizeLeagueRoles(null), {});
// An ARRAY is not a map. Firestore can hand one back after a bad import, and
// Object.entries on it would produce numeric "league ids" nobody can ever match.
check("an array is not a role map", normalizeLeagueRoles(["owner"]), {});
check("unknown roles collapse to player", normalizeLeagueRoles({ [A]: "sysadmin" }), { [A]: "player" });
check("known roles survive", normalizeLeagueRoles({ [A]: "owner", [B]: "moderator" }),
  { [A]: "owner", [B]: "moderator" });

// Keys that can't be written back to Firestore are dropped rather than stored
// and then failing on the next update.
ok("an ordinary auto-id is a usable key", isLeagueKey(A));
for (const bad of ["", null, undefined, "has.dot", "has/slash", "__reserved", "has space", "a[0]"]) {
  ok(`${JSON.stringify(bad)} is refused as a league key`, !isLeagueKey(bad));
}
check("unusable keys are dropped from the map",
  normalizeLeagueRoles({ [A]: "admin", "bad.key": "owner" }), { [A]: "admin" });

check("leagueIdsFor lists every membership", leagueIdsFor({ [LEAGUE_ROLES_FIELD]: { [B]: "player", [A]: "owner" } }), [A, B]);
check("leagueIdsFor of an unmigrated account is empty", leagueIdsFor({ role: "owner" }), []);

// ── 2. Isolation: standing in A buys nothing in B ───────────────────────────

const ownerOfA = { role: "owner", [LEAGUE_ROLES_FIELD]: { [A]: "owner" } };
const adminOfA = { role: "admin", [LEAGUE_ROLES_FIELD]: { [A]: "admin" } };
const bothLeagues = { [LEAGUE_ROLES_FIELD]: { [A]: "owner", [B]: "player" } };

check("owner of A is owner in A", leagueRoleFor(ownerOfA, A, { legacyLeagueId: A }), "owner");
check("owner of A is a PLAYER in B", leagueRoleFor(ownerOfA, B, { legacyLeagueId: A }), "player");
check("admin of A is a PLAYER in B", leagueRoleFor(adminOfA, B, { legacyLeagueId: A }), "player");
ok("owner of A does not clear the staff check in B", !isStaffRole(leagueRoleFor(ownerOfA, B, { legacyLeagueId: A })));
check("a per-league map answers each league on its own terms", [
  leagueRoleFor(bothLeagues, A, { legacyLeagueId: A }),
  leagueRoleFor(bothLeagues, B, { legacyLeagueId: A }),
], ["owner", "player"]);

// Membership — what the admin roster lists — is a different question from being
// staff, and a Player membership is still a membership.
ok("owner of A is a member of A", isLeagueMember(ownerOfA, A, { legacyLeagueId: A }));
ok("owner of A is NOT a member of B", !isLeagueMember(ownerOfA, B, { legacyLeagueId: A }));
ok("a Player membership still counts as membership",
  isLeagueMember(bothLeagues, B, { legacyLeagueId: A }));

// The legacy global `role` field must never leak sideways once a map exists.
// This is the whole isolation rule in one case: somebody stamped "owner" back
// when that meant the whole app, now recorded as a player of B.
const demoted = { role: "owner", [LEAGUE_ROLES_FIELD]: { [A]: "owner", [B]: "player" } };
check("the legacy global role can't override a league's own answer",
  leagueRoleFor(demoted, B, { legacyLeagueId: A }), "player");

// ── 3. No lockout: the legacy fallback, and its limits ──────────────────────

// An account written before any of this existed: no map at all.
const unmigratedOwner = { role: "owner" };
const unmigratedPlayer = { role: "player" };

ok("an unmigrated account has no map", !hasLeagueRoles(unmigratedOwner));
check("an unmigrated Owner still owns the LEGACY league",
  leagueRoleFor(unmigratedOwner, A, { legacyLeagueId: A }), "owner");
ok("…and is listed as one of its members", isLeagueMember(unmigratedOwner, A, { legacyLeagueId: A }));
// …but only there. A league created after the fact starts empty on purpose.
check("an unmigrated Owner is a player in a NEWER league",
  leagueRoleFor(unmigratedOwner, B, { legacyLeagueId: A }), "player");
ok("…and is not one of its members", !isLeagueMember(unmigratedOwner, B, { legacyLeagueId: A }));

// A request that names no league at all (pre-migration, or a direct API call)
// gets exactly the answer the app gave before leagues existed.
check("an unscoped request still reads the legacy role", leagueRoleFor(unmigratedOwner, ""), "owner");
check("an unscoped request on a plain account is a player", leagueRoleFor(unmigratedPlayer, ""), "player");

// The fallback keys on the FIELD BEING ABSENT, not on the map being empty.
// Somebody deliberately removed from every league must NOT come back to life
// through the role they used to hold globally.
const removedFromEverywhere = { role: "owner", [LEAGUE_ROLES_FIELD]: {} };
ok("an emptied map still counts as migrated", hasLeagueRoles(removedFromEverywhere));
check("an account removed from every league does not resurrect as Owner",
  leagueRoleFor(removedFromEverywhere, A, { legacyLeagueId: A }), "player");
ok("…and is not a member of the legacy league either",
  !isLeagueMember(removedFromEverywhere, A, { legacyLeagueId: A }));

// If the legacy league can't be resolved at all, the fallback simply doesn't
// fire — it never guesses a league.
check("no legacy league means no fallback", leagueRoleFor(unmigratedOwner, A, { legacyLeagueId: null }), "player");

// ── 4. The migration: additive, idempotent, and it never demotes ────────────

check("the migration copies the legacy role into the legacy league",
  seedLeagueRoles(unmigratedOwner, A), { [A]: "owner" });
check("an account with no role at all migrates as a player",
  seedLeagueRoles({ display_name: "Nobody" }, A), { [A]: "player" });
check("re-running the migration is a no-op", seedLeagueRoles(ownerOfA, A), null);
// The one that matters most: a second run must not overwrite a role an admin
// has set since the first.
const demotedSinceMigration = { role: "owner", [LEAGUE_ROLES_FIELD]: { [A]: "player" } };
check("a role changed after migrating is left alone", seedLeagueRoles(demotedSinceMigration, A), null);
// Memberships of other leagues survive the backfill untouched.
check("migrating carries every existing membership through",
  seedLeagueRoles({ role: "admin", [LEAGUE_ROLES_FIELD]: { [B]: "moderator" } }, A),
  { [B]: "moderator", [A]: "admin" });
check("an unusable legacy league id is refused rather than written",
  seedLeagueRoles(unmigratedOwner, "bad.id"), null);

// ── 5. Writing one league's role without touching the others ───────────────

check("a role patch names exactly one league",
  leagueRolePatch(A, "moderator"), { [LEAGUE_ROLES_FIELD]: { [A]: "moderator" } });
check("a role patch normalizes what it is given",
  leagueRolePatch(A, "wizard"), { [LEAGUE_ROLES_FIELD]: { [A]: "player" } });
check("an unusable league id produces no patch at all", leagueRolePatch("bad.id", "owner"), null);

check("setting one league's role keeps the rest",
  withLeagueRole(bothLeagues, B, "admin"), { [A]: "owner", [B]: "admin" });
check("removing a league drops only that key",
  withoutLeague(bothLeagues, B), { [A]: "owner" });
check("removing a league you aren't in changes nothing",
  withoutLeague(ownerOfA, B), { [A]: "owner" });
// withoutLeague must not mutate the document it was handed — the caller still
// needs the original to work out whether this was the last league.
check("withoutLeague leaves its input alone", bothLeagues[LEAGUE_ROLES_FIELD], { [A]: "owner", [B]: "player" });

check("directLeagueRole says nothing rather than 'player' when unknown",
  directLeagueRole(ownerOfA, B), null);
check("directLeagueRole with no league at all is null", directLeagueRole(ownerOfA, ""), null);

// ── 6. The gate's decision ─────────────────────────────────────────────────
//
// The five outcomes AdminGate renders, decided here so the rules can be pinned
// without mounting anything.

const staffHere = {
  signedIn: true, isAdmin: true, roleLevel: ROLE_LEVEL.admin,
  roleLeagueId: A, activeLeagueId: A,
};

check("staff of the league on screen are let in", adminGateVerdict(staffHere), "allow");
check("a signed-out visitor is asked to sign in",
  adminGateVerdict({ ...staffHere, signedIn: false }), "signed-out");
check("nothing is decided while still loading",
  adminGateVerdict({ ...staffHere, loading: true }), "loading");
check("nothing is decided while the league is still settling",
  adminGateVerdict({ ...staffHere, leagueSettling: true }), "loading");

// The contextual check, stated twice because it can fail in two directions.
check("an Admin of A is refused on B's page",
  adminGateVerdict({ signedIn: true, isAdmin: false, roleLevel: 0, roleLeagueId: B, activeLeagueId: B }),
  "not-staff");
check("a role answered for another league is never acted on",
  adminGateVerdict({ ...staffHere, roleLeagueId: A, activeLeagueId: B }), "stale");
check("a profile lagging behind a switch is never acted on",
  adminGateVerdict({ ...staffHere, roleStale: true }), "stale");
// Staleness outranks the pass: this is the leak the gate exists to stop.
ok("a stale answer is never 'allow'",
  adminGateVerdict({ ...staffHere, roleStale: true }) !== "allow");

// The senior-role floor still applies, within the league.
check("a Statistician is under the Moderator floor",
  adminGateVerdict({ ...staffHere, roleLevel: ROLE_LEVEL.statistician, minLevel: ROLE_LEVEL.moderator }),
  "below-min");
check("a Moderator clears the Moderator floor",
  adminGateVerdict({ ...staffHere, roleLevel: ROLE_LEVEL.moderator, minLevel: ROLE_LEVEL.moderator }),
  "allow");
// …and the floor is checked against THIS league's rank, so an Owner of another
// league gets no head start.
check("the floor is judged on this league's rank",
  adminGateVerdict({
    signedIn: true, isAdmin: false, roleLevel: ROLE_LEVEL.player,
    roleLeagueId: B, activeLeagueId: B, minLevel: ROLE_LEVEL.moderator,
  }),
  "below-min");

// A pre-migration install names no league anywhere; the gate must still work.
check("an unscoped install still lets its staff in",
  adminGateVerdict({ signedIn: true, isAdmin: true, roleLevel: ROLE_LEVEL.owner, roleLeagueId: "", activeLeagueId: "" }),
  "allow");

// ── 7. The gate mounts ─────────────────────────────────────────────────────
//
// A render assertion, for the same reason the League Setup suite has one: the
// gate's imports are only resolved when it renders, and a missing one would take
// down every admin page behind the error boundary. Mounted with no providers, so
// the contexts fall back to their defaults (loading, signed out) — enough to
// prove the module loads and renders.
n += 1;
let html;
try {
  html = renderToStaticMarkup(<AdminGate><p>secret</p></AdminGate>);
} catch (err) {
  assert.fail(`AdminGate failed to mount: ${err.message}`);
}
ok("a gate that hasn't resolved shows no admin content", !html.includes("secret"));

console.log(`leagueIsolation: ${n} checks passed`);
