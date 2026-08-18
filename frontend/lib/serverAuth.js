import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase";
import { normalizeRole, isStaffRole, roleLevel } from "@/lib/roles";
import { directLeagueRole, hasLeagueRoles, isLeagueMember } from "@/lib/leagueRoles";

// The active league for a request. The client stamps it as an `X-League-Id`
// header (see lib/api.js), with a `league_id` query-param fallback for direct
// links. Empty string means "no league selected" — e.g. before the containment
// migration has run — in which case reads fall back to the whole (unscoped)
// collection so nothing looks lost. See scopeByLeague below.
export function getRequestLeagueId(request) {
  const header = request.headers.get("x-league-id");
  if (header) return header.trim();
  try {
    return new URL(request.url).searchParams.get("league_id") || "";
  } catch {
    return "";
  }
}

// Constrain a Firestore collection query to one league. A falsy leagueId leaves
// the query untouched (legacy/unscoped) so pre-migration data still shows.
export function scopeByLeague(query, leagueId) {
  return leagueId ? query.where("league_id", "==", leagueId) : query;
}

// Does a document belong to the active league? A doc with no `league_id` is
// legacy (the containment migration hasn't stamped it yet) and belongs to
// everyone — refusing those would break a league mid-migration. A request that
// names no league isn't scoped either, so it sees everything as before.
export function docInLeague(data, leagueId) {
  if (!leagueId) return true;
  const owner = data?.league_id;
  return owner == null || owner === leagueId;
}

export async function getRequestUser(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    return decoded;
  } catch {
    return null;
  }
}

export function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Owners granted via the ADMIN_EMAILS env var are permanent — their role can't
// be revoked or lowered from the dashboard, so the UI flags them as locked.
// These accounts always resolve to the top "owner" role, IN EVERY LEAGUE. That
// is deliberate and it is the app's lockout escape hatch: per-league roles mean
// a mistake in one league's role map could otherwise leave a league with no
// staff at all, and the env-var owner is the person who can always fix it.
export function isEnvAdmin(email) {
  return !!email && envAdminEmails().includes(String(email).toLowerCase());
}

// ── The legacy league ───────────────────────────────────────────────────────
//
// The oldest league is the one the containment migration stamps existing data
// into, so it is also where an account's pre-multi-league `role` still counts
// (see lib/leagueRoles.js). Resolving it costs one read of a collection with a
// handful of documents in it, and only accounts that haven't been migrated ever
// ask, so it is memoized for a minute rather than cached forever — a freshly
// created first league has to be noticed.
const LEGACY_LEAGUE_TTL_MS = 60_000;
let legacyLeagueCache = { id: null, at: 0 };

export async function legacyLeagueId() {
  const now = Date.now();
  if (legacyLeagueCache.id !== null && now - legacyLeagueCache.at < LEGACY_LEAGUE_TTL_MS) {
    return legacyLeagueCache.id;
  }
  let id = "";
  try {
    const snap = await db().collection("leagues").get();
    const docs = snap.docs.map(d => ({ id: d.id, created_at: d.data().created_at || "" }));
    docs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    id = docs[0]?.id || "";
  } catch {
    id = "";      // unreadable: no fallback fires, env admins still get through
  }
  legacyLeagueCache = { id, at: now };
  return id;
}

// Test/seam hook: forget the memoized legacy league (used after a migration
// creates the first league, so the very next request sees it).
export function forgetLegacyLeague() {
  legacyLeagueCache = { id: null, at: 0 };
}

// Resolve a stored user document's role IN ONE LEAGUE, applying the legacy
// fallback for accounts written before `league_roles` existed. Split out from
// getUserRole so callers that already hold the document (the admin roster, for
// one) don't re-read it per row.
export async function resolveLeagueRole(data, leagueId) {
  if (!data) return "player";
  if (!leagueId) return normalizeRole(data.role || "player");
  const direct = directLeagueRole(data, leagueId);
  if (direct != null) return direct;
  if (hasLeagueRoles(data)) return "player";     // migrated: the map is the truth
  return leagueId === (await legacyLeagueId())
    ? normalizeRole(data.role || "player")
    : "player";
}

// The effective staff role for a request user IN THE GIVEN LEAGUE: env-var
// admins are always "owner"; otherwise the role their `league_roles` map records
// for that league (defaulting to "player" — an account with no entry for a
// league is unaffiliated with it).
export async function getUserRole(user, leagueId = "") {
  if (!user) return null;
  if (isEnvAdmin(user.email)) return "owner";
  const doc = await db().collection("users").doc(user.uid).get();
  if (!doc.exists) return "player";
  return resolveLeagueRole(doc.data(), leagueId);
}

// Same, resolving the league straight off the request. This is what a route
// handler wants nine times out of ten.
export async function getRequestRole(request, user) {
  return getUserRole(user, getRequestLeagueId(request));
}

// Is this account a member of the league at all (any role, Player included)?
// Env admins always are. Used by the admin roster and by the routes that must
// refuse to act on somebody who simply isn't in this league.
export async function isLeagueMemberUid(uid, leagueId, { email = null } = {}) {
  if (isEnvAdmin(email)) return true;
  if (!leagueId) return true;
  const doc = await db().collection("users").doc(uid).get();
  if (!doc.exists) return false;
  return isLeagueMember(doc.data(), leagueId, { legacyLeagueId: await legacyLeagueId() });
}

// "Has league-admin access IN THIS LEAGUE" — true for any of the four staff
// roles (owner, admin, moderator, statistician). This is what gates the
// AdminGate / withAdmin league routes, all of which share the same baseline
// powers. Staff in League A are plain players in League B.
export async function isAdmin(user, leagueId = "") {
  if (!user) return false;
  return isStaffRole(await getUserRole(user, leagueId));
}

// The whole-application Owner — the only role allowed to touch things that are
// not one league's property: the containment migration, and the backup/restore
// of every league's data at once.
//
// Per-league roles made this distinction necessary. "Owner" now means owner OF A
// LEAGUE, and the owner of a league somebody spun up this morning must not be
// able to restore the entire database over the top of every other league. So a
// global owner is an ADMIN_EMAILS account, or the owner of the legacy (oldest)
// league — which on a single-league install is exactly the person who was the
// Owner before this existed, so nothing they could do yesterday is refused
// today.
export async function isGlobalOwner(user) {
  if (!user) return false;
  if (isEnvAdmin(user.email)) return true;
  const legacy = await legacyLeagueId();
  // No leagues at all yet (a brand-new install, pre-migration): fall back to the
  // stored global role so the first Owner can run the migration that creates
  // the first league.
  if (!legacy) return (await getUserRole(user)) === "owner";
  return (await getUserRole(user, legacy)) === "owner";
}

// An account may use the app only once its email is verified. Permanent env-var
// admins are exempt so the league owner can never lock themselves out (e.g. if
// verification email delivery ever breaks).
export function isVerified(user) {
  return !!user && (user.email_verified === true || isEnvAdmin(user.email));
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Admin access required for this league" }, { status: 403 });
}

export function unverified() {
  return NextResponse.json(
    { error: "Verify your email address to continue.", code: "email-unverified" },
    { status: 403 },
  );
}

// ── Route wrappers ──────────────────────────────────────────────────────────
//
// Every one of these resolves the ACTIVE LEAGUE from the request first and
// answers the role question against it, so "is this user an Admin?" is never
// asked in the abstract. Handlers receive `(request, ctx, user, role, leagueId)`
// — the extra two arguments are additive, so a handler that only reads `user`
// is unaffected.

// Wraps a handler that requires an authenticated admin OF THE ACTIVE LEAGUE.
export function withAdmin(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    const leagueId = getRequestLeagueId(request);
    const role = await getUserRole(user, leagueId);
    if (!isStaffRole(role)) return forbidden();
    return handler(request, ctx, user, role, leagueId);
  };
}

// Wraps a handler that requires a staff role AT OR ABOVE a given level IN THE
// ACTIVE LEAGUE — for the routes where "any staff" is too wide but "owner only"
// is too narrow. The pending-approvals count is one: it's for the people who
// action the queue (Moderator and up), not for a Statistician who only reads
// stats.
export function withRole(minLevel, handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    const leagueId = getRequestLeagueId(request);
    const role = await getUserRole(user, leagueId);
    if (roleLevel(role) < minLevel) {
      return NextResponse.json({ error: "Insufficient permissions for this league" }, { status: 403 });
    }
    return handler(request, ctx, user, role, leagueId);
  };
}

// Wraps a handler that requires the top-level Owner role IN THE ACTIVE LEAGUE.
// Owner is the only role permitted to create/rename/delete leagues; Admins,
// Moderators, and Statisticians are rejected here even though they clear
// withAdmin. Env-var (ADMIN_EMAILS) accounts are always Owner and
// verification-exempt, so the league owner can never lock themselves out of
// league management.
export function withOwner(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    const leagueId = getRequestLeagueId(request);
    const role = await getUserRole(user, leagueId);
    if (role !== "owner") {
      return NextResponse.json({ error: "Owner access required for this league" }, { status: 403 });
    }
    return handler(request, ctx, user, role, leagueId);
  };
}

// Wraps a handler that acts on the WHOLE APPLICATION rather than on one league
// — the containment migration and backup/restore. See isGlobalOwner.
export function withGlobalOwner(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    if (!(await isGlobalOwner(user))) {
      return NextResponse.json(
        { error: "This action is for the application Owner only." },
        { status: 403 },
      );
    }
    return handler(request, ctx, user, "owner", getRequestLeagueId(request));
  };
}

// Wraps a handler that requires any authenticated (and email-verified) user.
// Player-facing routes are the app's hot path, so this deliberately does NOT
// resolve a role (that would cost a document read nothing here uses) — the
// fourth argument is the ACTIVE LEAGUE, which is what these handlers actually
// scope on. A player route that also needs a role calls getUserRole itself.
export function withUser(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    return handler(request, ctx, user, getRequestLeagueId(request));
  };
}
