import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  getRequestUser, isEnvAdmin, isGlobalOwner, isVerified, legacyLeagueId, unauthorized, unverified,
} from "@/lib/serverAuth";
import { normalizeRole, roleLevel } from "@/lib/roles";
import { LEAGUE_ROLES_FIELD, hasLeagueRoles, normalizeLeagueRoles } from "@/lib/leagueRoles";
import {
  JOIN_APPROVAL_MIN_LEVEL, JOIN_COLLECTION, JOIN_MESSAGE_MAX, JOIN_PENDING,
  adminLeagueIdsFromRoles,
  scopeCoversLeague,
} from "@/lib/leagueJoin";

// The Firestore half of league join approvals. The rules themselves are pure
// and live in lib/leagueJoin.js; this resolves them against the database.

// ── Which leagues' requests may this account decide? ──────────────────────
//
// Answered from the account's OWN role map, not from the league it is currently
// looking at, because the queue spans leagues: an Admin of two of them works
// both from one screen, and an Admin of one must not see the other's queue just
// by switching the league menu.
//
//   { all: true }              the application Owner — every league
//   { all: false, ids: [...] } staff (Moderator+) of exactly these leagues
//
// The legacy fallback applies here for the same reason it applies everywhere
// else (see lib/leagueRoles.js): an account written before the role map existed
// carries its standing as a global role that only counts inside the legacy
// (oldest) league, and refusing it would lock the existing league's staff out
// of their own queue.
export async function joinApprovalScope(user) {
  if (!user) return { all: false, ids: [] };
  if (isEnvAdmin(user.email)) return { all: true, ids: [] };
  // The owner of the whole application (an ADMIN_EMAILS account, or the owner of
  // the legacy league) approves for every league — that is the "App Owner sees
  // all" half of the rule.
  if (await isGlobalOwner(user)) return { all: true, ids: [] };

  const doc = await db().collection("users").doc(user.uid).get();
  const data = doc.exists ? doc.data() : {};
  const ids = adminLeagueIdsFromRoles(data[LEAGUE_ROLES_FIELD], JOIN_APPROVAL_MIN_LEVEL);

  if (!hasLeagueRoles(data) && roleLevel(normalizeRole(data.role)) >= JOIN_APPROVAL_MIN_LEVEL) {
    const legacy = await legacyLeagueId();
    if (legacy && !ids.includes(legacy)) ids.push(legacy);
  }
  return { all: false, ids: ids.sort() };
}

// Wraps a handler that works the league join queue. Unlike withAdmin this does
// NOT gate on the active league: the scope it hands the handler is the set of
// leagues the account is staff of, and every row the handler touches is checked
// against it.
export function withJoinApprover(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!(await isVerified(user))) return unverified();
    const scope = await joinApprovalScope(user);
    if (!scope.all && !scope.ids.length) {
      return NextResponse.json(
        { error: "You don't run a league, so there are no join requests for you to decide." },
        { status: 403 },
      );
    }
    return handler(request, ctx, user, scope);
  };
}

// Every request in one status that this scope is allowed to see.
//
// Read by status and filtered in memory rather than with a `league_id in [...]`
// clause: Firestore caps that at thirty values, the collection is one row per
// person per league they have asked to join, and the filter is the permission
// boundary — doing it here means one code path decides it for the list, the
// count and the approval alike.
export async function joinRequestsInScope(scope, status = JOIN_PENDING) {
  const snap = await db().collection(JOIN_COLLECTION).where("status", "==", status).get();
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => scopeCoversLeague(scope, r.league_id));
  // Oldest first: whoever has been waiting longest is dealt with first.
  rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return rows;
}

// The name of a league, for stamping onto a request so the queue reads properly
// even after a league is renamed or removed. Returns null when it doesn't exist,
// which is the caller's cue to refuse.
export async function leagueSummary(leagueId) {
  if (!leagueId) return null;
  const doc = await db().collection("leagues").doc(leagueId).get();
  if (!doc.exists) return null;
  return { id: doc.id, name: doc.data()?.name || "League" };
}

// The pending request this account already has for one league, if any. One
// person may only have one open request per league — pressing the button twice
// must not put two rows in an admin's queue.
export async function pendingJoinRequest(uid, leagueId) {
  const snap = await db().collection(JOIN_COLLECTION)
    .where("uid", "==", uid)
    .where("league_id", "==", leagueId)
    .where("status", "==", JOIN_PENDING)
    .get();
  const doc = snap.docs[0];
  return doc ? { id: doc.id, ...doc.data() } : null;
}

// ── Filing a request ───────────────────────────────────────────────────────
//
// Shared by the two places a request can be born: the discovery page's Join
// button, and sign-up itself (an account created on a league's own page asks to
// join that league, so its admins see the newcomer straight away rather than
// having to be told about them).
//
// Idempotent by design: an account with a request already waiting for this
// league gets that row back rather than a second one. Refusals are returned as
// { error, status } so the caller can answer with whatever shape its route uses.
export async function fileJoinRequest({ user, leagueId, message = "", profile = null }) {
  const league = await leagueSummary(leagueId);
  if (!league) return { error: "League not found", status: 404 };

  const existing = await pendingJoinRequest(user.uid, leagueId);
  if (existing) return { request: existing, created: false };

  let data = profile;
  if (!data) {
    const doc = await db().collection("users").doc(user.uid).get();
    data = doc.exists ? doc.data() : {};
  }

  const doc = {
    status: JOIN_PENDING,
    league_id: league.id,
    // Stamped rather than joined at read time, so the queue still reads
    // properly for a league that has since been renamed.
    league_name: league.name,
    uid: user.uid,
    user_name: data.display_name || user.name || user.email || "Unknown",
    user_email: data.email || user.email || null,
    user_photo: data.photo_url || user.picture || null,
    message: String(message || "").slice(0, JOIN_MESSAGE_MAX),
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    resolved_by_name: null,
    reason: null,
  };
  const ref = await db().collection(JOIN_COLLECTION).add(doc);
  return { request: { id: ref.id, ...doc }, created: true };
}
