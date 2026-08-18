// Per-league membership and roles.
//
// A role used to be one global string on the account (`users.role`), which made
// "admin" mean admin of the WHOLE APPLICATION. The moment a second league
// exists that is wrong: the person who runs League A has no business editing
// League B's seasons, and League B's moderator has no business seeing League
// A's account roster. So the account now carries a MAP instead:
//
//   users/<uid> = {
//     ...profile fields...,
//     role: "admin",                                  <- legacy, read-only now
//     league_roles: { "<leagueA>": "owner",
//                     "<leagueB>": "player" },
//   }
//
// A league that isn't a key of that map is a league this account has NO
// standing in at all - not a player of it, not visible on its user roster, and
// certainly not staff. That is the whole isolation rule, and everything else
// here exists to apply it without ever locking somebody out of the league they
// already run.
//
// -- The legacy fallback, and why it is narrow -------------------------------
//
// Accounts written before this existed have no `league_roles` at all. Refusing
// them everything would lock every existing league owner out of their own
// league the moment this shipped, so an UNMIGRATED account still resolves its
// old global `role` - but only inside the LEGACY league (the oldest one, the
// containment migration's target). In every other league it reads as a plain
// player. That keeps the current league exactly as it is while giving a second
// league the clean slate it is supposed to have.
//
// The fallback is keyed on the FIELD BEING ABSENT, not on the map being empty:
// once an account has been migrated (or has had a role set in any league) its
// map is the whole truth, so an account deliberately removed from every league
// can't come back to life through its old global role.
//
// `lib/serverAuth.js` owns the async half (looking the legacy league up);
// everything in this file is pure, so it can be unit-tested without Firestore.

import { normalizeRole } from "@/lib/roles";

// The field on the user document holding the map.
export const LEAGUE_ROLES_FIELD = "league_roles";

// Firestore map keys may not be empty and may not contain the characters that
// make up a field path, and keys starting with "__" are reserved. League ids
// are ordinary Firestore auto-ids so this never trips in practice - it is here
// so a hand-written or imported id can never produce a document that cannot be
// written back.
const BAD_KEY_CHARS = /[.$/[\]#*`~ ]/;

export function isLeagueKey(id) {
  const key = String(id ?? "");
  return !!key && key.length <= 1500 && !key.startsWith("__") && !BAD_KEY_CHARS.test(key);
}

// Coerce whatever is stored into a clean { leagueId: role } object. Unknown
// roles collapse to "player" (same rule as normalizeRole), unusable keys are
// dropped, and anything that isn't a plain object reads as "no memberships".
export function normalizeLeagueRoles(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, role] of Object.entries(raw)) {
    const key = String(id ?? "").trim();
    if (!isLeagueKey(key)) continue;
    out[key] = normalizeRole(role);
  }
  return out;
}

// Has this account ever been given per-league standing? True as soon as the
// field exists, even when it is empty - see the note above about why an empty
// map must NOT fall back to the legacy global role.
export function hasLeagueRoles(data) {
  const raw = data?.[LEAGUE_ROLES_FIELD];
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

// The role this account holds in one league from the map alone, or null when
// the map says nothing about that league. Null is the caller's cue to decide
// between the legacy fallback and "unaffiliated" - it is never "player".
export function directLeagueRole(data, leagueId) {
  if (!leagueId) return null;
  const map = normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD]);
  return Object.prototype.hasOwnProperty.call(map, leagueId) ? map[leagueId] : null;
}

// Is this account a member of the league at all? Membership is what the admin
// roster lists and what "unaffiliated" means the absence of - it is not the
// same question as "are they staff": a Player membership is still a membership.
export function isLeagueMember(data, leagueId, { legacyLeagueId = null } = {}) {
  if (!leagueId) return false;
  if (directLeagueRole(data, leagueId) != null) return true;
  // Un-migrated accounts belong to the legacy league, which is where all their
  // history already is.
  return !hasLeagueRoles(data) && !!legacyLeagueId && leagueId === legacyLeagueId;
}

// Resolve an account's role in one league, applying the legacy fallback. The
// caller supplies `legacyLeagueId` (the oldest league) - pass null when it
// isn't known and the fallback simply doesn't fire.
//
// `leagueId` empty means the request named no league (pre-migration, or a
// direct API call): the legacy global role answers, which is what the whole app
// did before leagues existed.
export function leagueRoleFor(data, leagueId, { legacyLeagueId = null } = {}) {
  if (!data) return "player";
  if (!leagueId) return normalizeRole(data.role || "player");
  const direct = directLeagueRole(data, leagueId);
  if (direct != null) return direct;
  if (hasLeagueRoles(data)) return "player";          // migrated: the map is the truth
  return legacyLeagueId && leagueId === legacyLeagueId
    ? normalizeRole(data.role || "player")
    : "player";
}

// Every league this account has standing in, lowest id first for stable output.
export function leagueIdsFor(data) {
  return Object.keys(normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD])).sort();
}

// The map with one league's role set. Returns a NEW object; the caller writes
// it (or just the one key - see leagueRolePatch) rather than mutating in place.
export function withLeagueRole(data, leagueId, role) {
  const map = normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD]);
  if (!isLeagueKey(leagueId)) return map;
  return { ...map, [leagueId]: normalizeRole(role) };
}

// The map with one league's membership removed entirely - "no longer in this
// league", which is different from being demoted to Player in it.
export function withoutLeague(data, leagueId) {
  const map = normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD]);
  delete map[leagueId];
  return map;
}

// A Firestore `set(..., { merge: true })` payload that writes ONE league's role
// and leaves every other key of the map untouched. Merge does a deep merge of
// map fields, so this never has to read-modify-write the whole map (two admins
// promoting people in two leagues at once can't clobber each other).
export function leagueRolePatch(leagueId, role) {
  if (!isLeagueKey(leagueId)) return null;
  return { [LEAGUE_ROLES_FIELD]: { [leagueId]: normalizeRole(role) } };
}

// What the containment migration writes onto one existing account: its legacy
// global role, recorded against the legacy league, and nothing else. Returns
// null when there is nothing to do - the account is already migrated, or the
// league id is unusable - so the migration stays additive-only and idempotent.
export function seedLeagueRoles(data, legacyLeagueId) {
  if (!isLeagueKey(legacyLeagueId)) return null;
  if (directLeagueRole(data, legacyLeagueId) != null) return null;
  const role = normalizeRole(data?.role || "player");
  return { ...normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD]), [legacyLeagueId]: role };
}

// ── The gate's decision, as a value ────────────────────────────────────────
//
// components/AdminGate.jsx renders one of five things, and which one is a
// question of league standing rather than of markup - so it is answered here,
// where it can be tested without mounting anything.
//
//   "loading"    still resolving; render nothing that implies an answer
//   "signed-out" no account at all
//   "stale"      the role on hand answers for a DIFFERENT league than the one on
//                screen, because a switch is in flight. Renders as loading, and
//                is a verdict of its own so it can't be mistaken for a pass.
//   "below-min"  staff here, but under the floor this page asks for
//   "not-staff"  not staff in THIS league (they may well be in another)
//   "allow"      staff here, at or above the floor
export function adminGateVerdict({
  loading = false, leagueSettling = false, signedIn = false, isAdmin = false,
  roleLevel = 0, roleStale = false, roleLeagueId = "", activeLeagueId = "",
  minLevel = null,
} = {}) {
  if (loading || leagueSettling) return "loading";
  if (!signedIn) return "signed-out";
  // Two orders of arrival, one answer: the profile lagging behind a switch
  // (roleStale), and the league settling after the profile.
  if (roleStale) return "stale";
  if (activeLeagueId && roleLeagueId && roleLeagueId !== activeLeagueId) return "stale";
  if (minLevel != null && roleLevel < minLevel) return "below-min";
  if (!isAdmin) return "not-staff";
  return "allow";
}
