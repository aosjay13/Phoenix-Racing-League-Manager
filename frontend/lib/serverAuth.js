import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase";
import { normalizeRole, isStaffRole, roleLevel } from "@/lib/roles";

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
// These accounts always resolve to the top "owner" role.
export function isEnvAdmin(email) {
  return !!email && envAdminEmails().includes(String(email).toLowerCase());
}

// The effective staff role for a request user: env-var admins are always
// "owner"; otherwise the role stored on their user doc (defaulting to "player").
export async function getUserRole(user) {
  if (!user) return null;
  if (isEnvAdmin(user.email)) return "owner";
  const doc = await db().collection("users").doc(user.uid).get();
  return doc.exists ? normalizeRole(doc.data().role || "player") : "player";
}

// "Has league-admin access" — true for any of the four staff roles (owner,
// admin, moderator, statistician). This is what gates the AdminGate / withAdmin
// league routes, all of which share the same baseline powers.
export async function isAdmin(user) {
  if (!user) return false;
  return isStaffRole(await getUserRole(user));
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
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

export function unverified() {
  return NextResponse.json(
    { error: "Verify your email address to continue.", code: "email-unverified" },
    { status: 403 },
  );
}

// Wraps a handler that requires an authenticated admin.
export function withAdmin(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    if (!(await isAdmin(user))) return forbidden();
    return handler(request, ctx, user);
  };
}

// Wraps a handler that requires a staff role AT OR ABOVE a given level — for
// the routes where "any staff" is too wide but "owner only" is too narrow. The
// pending-approvals count is one: it's for the people who action the queue
// (Moderator and up), not for a Statistician who only reads stats.
export function withRole(minLevel, handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    const role = await getUserRole(user);
    if (roleLevel(role) < minLevel) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    return handler(request, ctx, user, role);
  };
}

// Wraps a handler that requires the top-level Owner role. Owner is the only
// role permitted to create/rename/delete leagues and run the containment
// migration; Admins, Moderators, and Statisticians are rejected here even
// though they clear withAdmin. Env-var (ADMIN_EMAILS) accounts are always
// Owner and verification-exempt, so the league owner can never lock themselves
// out of league management.
export function withOwner(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    if ((await getUserRole(user)) !== "owner") {
      return NextResponse.json({ error: "Owner access required" }, { status: 403 });
    }
    return handler(request, ctx, user);
  };
}

// Wraps a handler that requires any authenticated (and email-verified) user.
export function withUser(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    return handler(request, ctx, user);
  };
}
