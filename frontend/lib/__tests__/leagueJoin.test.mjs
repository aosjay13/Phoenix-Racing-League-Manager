// League discovery and join approvals.
//
// Two promises, and the second is the one that fails quietly:
//
//   1. DISCOVERY IS HONEST. A card says where you actually stand with a league,
//      and the button offers the one thing available from that state — so
//      nobody is invited to apply for a league they are already in, and nobody
//      is told "Requested" about a request that was turned down weeks ago.
//   2. APPROVAL IS SCOPED. A League Admin may only ever see and decide requests
//      for the league(s) they run. A wrong answer here doesn't throw: it hands
//      one league's applicants to another league's staff, which is exactly the
//      cross-league leak per-league roles exist to prevent. So the scope rules
//      get the most cases below, including every "must NOT" case.

import assert from "node:assert/strict";
import {
  DENIED, JOIN_APPROVAL_MIN_LEVEL, JOIN_APPROVED, JOIN_DENIED, JOIN_LANDING, JOIN_PENDING,
  LANDING_EXEMPT, MEMBER, OPEN, PENDING,
  adminLeagueIdsFromRoles, canApproveLeagueJoins, discoverableLeagues, groupJoinRequests,
  joinButton, joinQueueTitle, joinStateNote, landingRedirect, latestRequestFor, leagueJoinState,
  normalizeJoinStatus, scopeCoversLeague, waitingFor,
} from "@/lib/leagueJoin";
import { ROLE_LEVEL } from "@/lib/roles";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// A = the league that already existed; B = one created later; C = a third,
// which is where "an admin of two leagues" stops being the same as "all".
const A = "leagueAAA111";
const B = "leagueBBB222";
const C = "leagueCCC333";

const req = (leagueId, status, extra = {}) => ({
  id: `${leagueId}-${status}`, league_id: leagueId, status, created_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

// ── 1. Statuses ─────────────────────────────────────────────────────────────

check("pending is pending", normalizeJoinStatus("pending"), JOIN_PENDING);
check("approved survives", normalizeJoinStatus("approved"), JOIN_APPROVED);
check("denied survives", normalizeJoinStatus("denied"), JOIN_DENIED);
// Anything unrecognised reads as still-waiting rather than as decided: the
// safe direction is "somebody still has to look at this".
check("an unknown status reads as pending", normalizeJoinStatus("maybe"), JOIN_PENDING);
check("a missing status reads as pending", normalizeJoinStatus(undefined), JOIN_PENDING);

// ── 2. Where a player stands with one league ───────────────────────────────

check("no standing and no request is open",
  leagueJoinState({ leagueId: A, leagueRoles: {}, requests: [] }), OPEN);
check("a role in the league is membership",
  leagueJoinState({ leagueId: A, leagueRoles: { [A]: "player" }, requests: [] }), MEMBER);
// Staff standing is membership too — the card must not offer an Owner a button
// to apply for their own league.
check("an owner is a member",
  leagueJoinState({ leagueId: A, leagueRoles: { [A]: "owner" }, requests: [] }), MEMBER);
check("a pending request is pending",
  leagueJoinState({ leagueId: A, requests: [req(A, JOIN_PENDING)] }), PENDING);
check("a denied request is denied",
  leagueJoinState({ leagueId: A, requests: [req(A, JOIN_DENIED)] }), DENIED);
// Membership wins over the request that produced it: once the key is written
// the row is history, and reading it would leave them "pending" forever.
check("membership beats the request that granted it",
  leagueJoinState({ leagueId: A, leagueRoles: { [A]: "player" }, requests: [req(A, JOIN_APPROVED)] }),
  MEMBER);
// An approval with no membership behind it (removed from the league since)
// reads as open again rather than as a limbo with no way back in.
check("an approval without standing reopens",
  leagueJoinState({ leagueId: A, requests: [req(A, JOIN_APPROVED)] }), OPEN);
// Another league's request says nothing about this one.
check("a request for another league doesn't count",
  leagueJoinState({ leagueId: A, requests: [req(B, JOIN_PENDING)] }), OPEN);

// The NEWEST request decides, so asking again after a denial reads as pending
// rather than as still-denied.
const askedAgain = [
  req(A, JOIN_DENIED, { created_at: "2026-01-01T00:00:00.000Z" }),
  req(A, JOIN_PENDING, { created_at: "2026-03-01T00:00:00.000Z" }),
];
check("the newest request wins", latestRequestFor(askedAgain, A).status, JOIN_PENDING);
check("asking again after a denial is pending",
  leagueJoinState({ leagueId: A, requests: askedAgain }), PENDING);

// ── 3. The button ──────────────────────────────────────────────────────────

ok("a member can't press join", joinButton(MEMBER).disabled);
ok("a pending request can't be re-sent", joinButton(PENDING).disabled);
ok("a denial can be appealed", !joinButton(DENIED).disabled);
ok("an untouched league can be joined", !joinButton(OPEN).disabled);
check("the open button says what it does", joinButton(OPEN).label, "Join League");
check("a member's button says they're in", joinButton(MEMBER).label, "Joined");

// A denial reason is shown to the person it was about — that is the whole
// reason resolved rows are returned to them at all.
check("a denial reason reaches the player",
  joinStateNote({ state: DENIED, request: { reason: "Full for this season." } }),
  "Turned down: Full for this season.");
ok("a denial with no reason still says so",
  joinStateNote({ state: DENIED, request: {} }).length > 0);
check("an open league says nothing", joinStateNote({ state: OPEN }), "");

// ── 4. The discovery list ──────────────────────────────────────────────────

const leagues = [
  { id: C, name: "Cobra Cup" },
  { id: A, name: "Apex Racing" },
  { id: B, name: "Bandit Series" },
];

const rows = discoverableLeagues({
  leagues,
  leagueRoles: { [A]: "admin" },
  requests: [req(B, JOIN_PENDING)],
  signupLeagueId: C,
});
// The league they signed up on leads, then the ones they're in, then the rest.
check("the sign-up league comes first", rows.map(r => r.id), [C, A, B]);
check("each row carries its state", rows.map(r => r.state), [OPEN, MEMBER, PENDING]);
check("a member's role travels with the row", rows[1].role, "admin");
check("a non-member has no role", rows[0].role, null);
// Without a sign-up league it is members first, then by name.
check("otherwise members lead, then alphabetical",
  discoverableLeagues({ leagues, leagueRoles: { [B]: "player" } }).map(r => r.id),
  [B, A, C]);
check("a league with no id is dropped",
  discoverableLeagues({ leagues: [{ name: "Nameless" }, { id: A, name: "Apex" }] }).map(r => r.id),
  [A]);

// ── 5. WHO MAY DECIDE — the isolation rule ─────────────────────────────────

check("the approval floor is Moderator", JOIN_APPROVAL_MIN_LEVEL, ROLE_LEVEL.moderator);

// Only leagues at or above the floor, and only those.
check("staff leagues are collected",
  adminLeagueIdsFromRoles({ [A]: "admin", [B]: "player", [C]: "moderator" }),
  [A, C].sort());
// A Statistician clears the general staff gate and does NOT work this queue —
// the same floor the series sign-up queue uses.
check("a statistician runs no queue", adminLeagueIdsFromRoles({ [A]: "statistician" }), []);
check("a player runs no queue", adminLeagueIdsFromRoles({ [A]: "player" }), []);
check("an absent map runs no queue", adminLeagueIdsFromRoles(undefined), []);
// An owner of one league is not an approver of another. This is the case the
// whole feature turns on.
ok("an owner of A does not run B", !adminLeagueIdsFromRoles({ [A]: "owner" }).includes(B));

// Whether the browser asks for a count at all.
ok("an admin of some league may see a queue",
  canApproveLeagueJoins({ leagueRoles: { [B]: "admin" } }));
ok("the application owner may see every queue",
  canApproveLeagueJoins({ leagueRoles: {}, isGlobalOwner: true }));
// An account that predates the role map holds its standing through the legacy
// fallback, which shows up as a level and as nothing at all in the map.
ok("a legacy moderator isn't locked out",
  canApproveLeagueJoins({ leagueRoles: {}, roleLevel: ROLE_LEVEL.moderator }));
ok("a plain player asks for nothing", !canApproveLeagueJoins({ leagueRoles: { [A]: "player" } }));
ok("a statistician asks for nothing",
  !canApproveLeagueJoins({ leagueRoles: { [A]: "statistician" }, roleLevel: ROLE_LEVEL.statistician }));
ok("an account with nothing at all asks for nothing", !canApproveLeagueJoins({}));

// And which rows that scope actually covers. Every "must not" here is a leak.
const ownerScope = { all: true, ids: [] };
const adminScope = { all: false, ids: [A, C] };
ok("the app owner covers any league", scopeCoversLeague(ownerScope, B));
ok("a league admin covers their own league", scopeCoversLeague(adminScope, A));
ok("…and their second league", scopeCoversLeague(adminScope, C));
ok("a league admin does NOT cover another league", !scopeCoversLeague(adminScope, B));
ok("a row with no league is covered by nobody", !scopeCoversLeague(ownerScope, ""));
ok("an empty scope covers nothing", !scopeCoversLeague({ all: false, ids: [] }, A));

// ── 6. The queue, grouped by league ────────────────────────────────────────

const grouped = groupJoinRequests([
  { id: "3", league_id: B, created_at: "2026-02-01T00:00:00.000Z" },
  { id: "1", league_id: A, created_at: "2026-03-01T00:00:00.000Z" },
  { id: "2", league_id: A, created_at: "2026-01-01T00:00:00.000Z" },
]);
check("one group per league", [...grouped.keys()], [B, A]);
// Oldest first inside a league: whoever has been waiting longest is dealt with
// first, same as the sign-up queue.
check("oldest waits first", grouped.get(A).map(r => r.id), ["2", "1"]);

check("an empty queue says nothing is waiting", joinQueueTitle(0), "No league join requests waiting");
check("one request reads singular", joinQueueTitle(1), "1 league join request waiting for approval");
check("several read plural", joinQueueTitle(4), "4 league join requests waiting for approval");

const now = Date.parse("2026-03-10T00:00:00.000Z");
check("today is today", waitingFor("2026-03-10T06:00:00.000Z", now), "today");
check("one day is singular", waitingFor("2026-03-09T00:00:00.000Z", now), "1 day");
check("more days are plural", waitingFor("2026-03-01T00:00:00.000Z", now), "9 days");
check("an unparseable date says nothing", waitingFor("whenever", now), "");

// ── 7. Where an unaffiliated account lands ─────────────────────────────────

const settled = { loading: false, signedIn: true, leagueReady: true, leagueCount: 2 };

check("a member is left where they are",
  landingRedirect({ ...settled, unaffiliated: false, pathname: "/standings" }), null);
check("an account in no league is sent to the join page",
  landingRedirect({ ...settled, unaffiliated: true, pathname: "/standings" }), JOIN_LANDING);
check("…including from the dashboard",
  landingRedirect({ ...settled, unaffiliated: true, pathname: "/" }), JOIN_LANDING);
// Never bounce the page they're being sent to, or the ones they legitimately
// need while they wait.
check("the join page itself isn't bounced",
  landingRedirect({ ...settled, unaffiliated: true, pathname: JOIN_LANDING }), null);
for (const exempt of LANDING_EXEMPT) {
  check(`${exempt} is exempt`,
    landingRedirect({ ...settled, unaffiliated: true, pathname: exempt }), null);
  check(`${exempt}'s own sub-pages are exempt`,
    landingRedirect({ ...settled, unaffiliated: true, pathname: `${exempt}/anything` }), null);
}
// A path that merely starts with the same letters is not an exempt page.
check("a lookalike path is not exempt",
  landingRedirect({ ...settled, unaffiliated: true, pathname: "/accounts" }), JOIN_LANDING);

// Nothing is decided from an unsettled answer: bouncing an ordinary member for
// a moment reads as the app losing their league.
check("a loading profile decides nothing",
  landingRedirect({ ...settled, loading: true, unaffiliated: true, pathname: "/" }), null);
check("an unsettled league list decides nothing",
  landingRedirect({ ...settled, leagueReady: false, unaffiliated: true, pathname: "/" }), null);
check("a signed-out visitor is left alone",
  landingRedirect({ ...settled, signedIn: false, unaffiliated: true, pathname: "/" }), null);
// Nothing to join: a pre-migration install. An empty join page is worse than
// the Dashboard.
check("no leagues means no redirect",
  landingRedirect({ ...settled, leagueCount: 0, unaffiliated: true, pathname: "/" }), null);

console.log(`leagueJoin: ${n} assertions passed`);
