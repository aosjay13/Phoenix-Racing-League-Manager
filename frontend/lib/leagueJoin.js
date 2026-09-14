// League discovery and join approvals.
//
// An authentication account is global; standing in a league is a row in
// Firestore (`users.league_roles` — see lib/leagueRoles.js). Until this existed
// the second was handed out automatically: opening a league, or signing in
// while looking at one, quietly wrote a Player membership for it. That made
// isolation a polite fiction. Every account on the installation drifted into
// every league it ever glanced at, which put strangers on user rosters, in
// driver-link pickers and in "who's in this league" counts, and there was no
// moment at which anybody decided to let them in.
//
// So joining a league is now a REQUEST, and it works exactly like a series
// sign-up: the player asks, a row sits in `league_join_requests` with
// status="pending", and nothing about their standing changes until staff OF
// THAT LEAGUE approve it. Approving writes the Player membership; denying
// records why.
//
//   league_join_requests/<id> = {
//     league_id, league_name,
//     uid, user_name, user_email, user_photo,
//     status: "pending" | "approved" | "denied",
//     message,                  // what the player said when they asked
//     created_at, resolved_at, resolved_by, resolved_by_name, reason,
//   }
//
// This file is the pure half — statuses, who may approve what, and what the
// discovery page should show for each league — so the page, the API routes and
// the admin panel all apply one set of rules and it can be tested without
// Firestore. The Firestore half is lib/leagueJoinServer.js.

import { ROLE_LEVEL, normalizeRole, roleLevel } from "@/lib/roles";
import { normalizeLeagueRoles } from "@/lib/leagueRoles";

export const JOIN_COLLECTION = "league_join_requests";

export const JOIN_PENDING = "pending";
export const JOIN_APPROVED = "approved";
export const JOIN_DENIED = "denied";
export const JOIN_STATUSES = [JOIN_PENDING, JOIN_APPROVED, JOIN_DENIED];

// Who works this queue. The same floor as the series sign-up queue
// (lib/pendingSignupAlerts.js): Moderator and up. A Statistician reads a
// league's numbers but doesn't decide who is in it.
//
// Declared here rather than imported from pendingSignupAlerts because that file
// is a client module and these rules are enforced on the server.
export const JOIN_APPROVAL_MIN_LEVEL = ROLE_LEVEL.moderator;

// How long a player's message can be, and how long a denial reason can be.
export const JOIN_MESSAGE_MAX = 300;

export function normalizeJoinStatus(status) {
  return JOIN_STATUSES.includes(status) ? status : JOIN_PENDING;
}

export function isPendingJoin(req) {
  return normalizeJoinStatus(req?.status) === JOIN_PENDING;
}

// ── Who may approve which league's requests ────────────────────────────────
//
// THE critical rule of this feature. A League Admin sees the requests for the
// league(s) they are staff of, and nothing else — a Moderator of League B must
// never see, let alone approve, somebody asking to join League A. The
// application Owner is the one exception and sees every league's queue.
//
// The set is computed from the account's OWN role map rather than from the
// league it happens to be viewing, because the queue is inherently
// cross-league: an Admin of two leagues works both from one screen.

// Every league in a { leagueId: role } map where the role is at or above
// `minLevel`. Sorted, so output is stable.
export function adminLeagueIdsFromRoles(leagueRoles, minLevel = JOIN_APPROVAL_MIN_LEVEL) {
  const map = normalizeLeagueRoles(leagueRoles);
  return Object.keys(map)
    .filter(id => roleLevel(map[id]) >= minLevel)
    .sort();
}

// Is this account allowed to see a league join queue at all? Used to decide
// whether the browser even asks for the count — a plain player's browser never
// calls the admin API.
export function canApproveLeagueJoins({
  leagueRoles = {}, roleLevel: activeLevel = 0, isGlobalOwner = false,
} = {}) {
  if (isGlobalOwner) return true;
  // The active league's level is included because an account that predates the
  // role map holds its standing through the legacy fallback, which shows up as
  // a level here and as nothing at all in the map.
  if ((activeLevel ?? 0) >= JOIN_APPROVAL_MIN_LEVEL) return true;
  return adminLeagueIdsFromRoles(leagueRoles).length > 0;
}

// Does a scope ({ all, ids }) cover this league? `all` is the application
// Owner; otherwise the league has to be one they are staff of.
export function scopeCoversLeague(scope, leagueId) {
  if (!leagueId) return false;
  if (scope?.all) return true;
  return (scope?.ids || []).includes(leagueId);
}

// ── What the discovery page shows for one league ───────────────────────────
//
// Five states, and each one has a different button:
//
//   member   already in — no join button at all, the role they hold instead
//   pending  asked, nobody has decided yet — "Requested", not pressable
//   denied   asked and was turned down — they may ask again
//   open     never asked — "Join League"
//
// A league whose request was APPROVED is simply a member; the approval wrote
// the membership, so the request row is history.
export const MEMBER = "member";
export const PENDING = "pending";
export const DENIED = "denied";
export const OPEN = "open";

// The newest request this account has made for one league, whatever its state.
export function latestRequestFor(requests, leagueId) {
  return (requests || [])
    .filter(r => r?.league_id === leagueId)
    .sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")))[0] || null;
}

export function leagueJoinState({ leagueId, leagueRoles = {}, requests = [] } = {}) {
  if (!leagueId) return OPEN;
  const map = normalizeLeagueRoles(leagueRoles);
  if (Object.prototype.hasOwnProperty.call(map, leagueId)) return MEMBER;
  const req = latestRequestFor(requests, leagueId);
  if (!req) return OPEN;
  const status = normalizeJoinStatus(req.status);
  if (status === JOIN_PENDING) return PENDING;
  // An approval that didn't leave a membership behind (the account was removed
  // from the league afterwards) reads as open again rather than as a permanent
  // "approved" limbo with no way back in.
  return status === JOIN_DENIED ? DENIED : OPEN;
}

// Every league in the app, annotated for the discovery page. Ordered so the one
// a player most likely wants is first: the league they signed up on, then the
// ones they already belong to, then everything else by name.
export function discoverableLeagues({
  leagues = [], leagueRoles = {}, requests = [], signupLeagueId = "",
} = {}) {
  const map = normalizeLeagueRoles(leagueRoles);
  const rows = (leagues || [])
    .filter(l => l && l.id)
    .map(l => ({
      ...l,
      state: leagueJoinState({ leagueId: l.id, leagueRoles: map, requests }),
      role: map[l.id] ? normalizeRole(map[l.id]) : null,
      request: latestRequestFor(requests, l.id),
    }));
  const rank = row => (row.id && row.id === signupLeagueId ? 0 : row.state === MEMBER ? 1 : 2);
  return rows.sort((a, b) =>
    rank(a) - rank(b) || String(a.name || "").localeCompare(String(b.name || "")));
}

// The button's text and whether it can be pressed.
export function joinButton(state) {
  switch (state) {
    case MEMBER: return { label: "Joined", disabled: true, title: "You already belong to this league" };
    case PENDING: return {
      label: "Requested",
      disabled: true,
      title: "Your request is waiting on this league's admins",
    };
    case DENIED: return {
      label: "Ask Again",
      disabled: false,
      title: "This league turned down your last request — you can ask again",
    };
    default: return { label: "Join League", disabled: false, title: "Ask this league's admins to let you in" };
  }
}

// One line under the league's name saying where the player stands with it.
export function joinStateNote(row) {
  switch (row?.state) {
    case MEMBER: return "You're in this league.";
    case PENDING: return "Request sent — waiting on this league's admins.";
    case DENIED: return row?.request?.reason
      ? `Turned down: ${row.request.reason}`
      : "Your last request was turned down.";
    default: return "";
  }
}

// ── The landing page for an account that belongs to nowhere ────────────────
//
// Membership is no longer automatic, so a brand-new account genuinely belongs
// to no league: every roster, standing and selection in the app is somebody
// else's. Dropping them on the Dashboard would show them a league they can read
// and cannot take part in, with nothing saying why. So they land on /leagues
// instead, which is the one page that is theirs to act on.
//
// Kept to a redirect rather than a wall: they may still read the league's public
// pages if they navigate there themselves, and the pages below stay reachable
// because they are the ones an unaffiliated account legitimately needs.
export const JOIN_LANDING = "/leagues";

export const LANDING_EXEMPT = [
  JOIN_LANDING,
  "/login",
  "/account",   // sign-in, password, "which leagues am I in"
  "/profile",   // their own name and picture
  "/recover",
];

// Where this navigation should actually end up, or null to leave it alone.
// Pure, so the redirect's conditions are testable without a router.
export function landingRedirect({
  pathname = "/", loading = true, signedIn = false, unaffiliated = false,
  leagueReady = true, leagueCount = 0,
} = {}) {
  if (loading || !leagueReady) return null;       // don't act on an unsettled answer
  if (!signedIn || !unaffiliated) return null;
  // Nothing to join: a pre-migration install, or one whose leagues are
  // unreadable. Sending them to an empty page would be worse than the Dashboard.
  if (!leagueCount) return null;
  const path = String(pathname || "/");
  if (LANDING_EXEMPT.some(p => path === p || path.startsWith(`${p}/`))) return null;
  return JOIN_LANDING;
}

// ── Admin panel copy ───────────────────────────────────────────────────────

export function joinQueueTitle(count) {
  if (!count) return "No league join requests waiting";
  return `${count} league join request${count === 1 ? "" : "s"} waiting for approval`;
}

// Group a queue into { leagueId: rows }, oldest first inside each league, so a
// staff member of two leagues works one league at a time.
export function groupJoinRequests(rows = []) {
  const out = new Map();
  for (const r of rows) {
    const key = r?.league_id || "";
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  for (const list of out.values()) {
    list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  }
  return out;
}

// How long somebody has been waiting, in the plainest words that fit a row.
export function waitingFor(createdAt, now = Date.now()) {
  const then = Date.parse(createdAt || "");
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
