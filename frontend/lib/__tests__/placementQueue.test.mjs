// The Placements Queue: listed, pooled, and cleared.
//
// A driver approved for a placement-graded tier is in the strangest state the
// app has: acknowledged, out of the approvals queue, off the badge, and on no
// roster at all. Three things have to be true of them or they are simply lost,
// and each of the three is a way this feature fails silently:
//
//   1. they are LISTED, with what they signed up for, and the list narrows to
//      the season an admin is about to run;
//   2. a placement session can POOL them — everybody waiting on any of the
//      divisions that session sorts into, in one press, and pressing it twice
//      doesn't double anybody;
//   3. completing that session CLEARS the people it placed, and nobody else.
//
// The failure that matters most is at each end: pooling too widely (every
// waiting driver in the league dragged onto one unrelated sheet) and clearing
// too widely (a driver who was never placed quietly dropped off the list that
// exists to remember them).

import assert from "node:assert/strict";
import {
  applyQueueFilters, hasDestinations, importFromQueuePlan, queueFilterOptions,
  queueIdentityKeys, queueRowMatchesDestinations, queueRowToSheetRow, queueRowsPlacedBy,
  matchingQueueRows, trialDestinations, waitingFor,
} from "../placementQueue.js";
import { planRosterBuild } from "../timeTrials.js";
import { APPROVED_FOR_PLACEMENTS } from "../signupQueue.js";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepStrictEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// A registration in the queue, as the collection stores it.
const waiting = (over = {}) => ({
  id: "q1", status: APPROVED_FOR_PLACEMENTS, kind: "signup",
  uid: "u1", driver_id: "d1", name: "Ana",
  game_id: "g1", game_name: "iRacing",
  series_id: "gold", series_name: "Gold Series",
  season_id: "gold-s4", season_name: "Season 4",
  class_ids: [], class_names: [], number: "24", car: "GT3",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

// ── 1. What a session's destinations are ───────────────────────────────────
const trial = {
  season_id: "own-season",
  class_ids: ["pro", "am"],
  series_ids: ["gold", "silver"],
  series_seasons: { gold: "gold-s4", silver: "silver-s4" },
};
const dest = trialDestinations(trial);
check("every ticked series is a destination", dest.series_ids, ["gold", "silver"]);
check("so is the season behind each of them, and the session's own",
  dest.season_ids.sort(), ["gold-s4", "own-season", "silver-s4"]);
check("and every division ticked inside this season", dest.class_ids, ["pro", "am"]);
ok("a session with destinations knows it", hasDestinations(dest));

// The guard the whole pooling feature rests on. "Nothing ticked" must never be
// read as "no filter, take everybody" — that would drag the entire league's
// waiting drivers onto one unrelated sheet on a single click.
const empty = trialDestinations({});
ok("a session with nothing ticked has no destinations", !hasDestinations(empty));
ok("...and therefore matches nobody at all",
  !queueRowMatchesDestinations(waiting(), empty));
check("...not even in bulk", matchingQueueRows([waiting(), waiting({ id: "q2" })], empty), []);
ok("a trial with only a season still has a destination",
  hasDestinations(trialDestinations({ season_id: "s1" })));

// ── 2. Who belongs on this session's sheet ─────────────────────────────────
//
// Generous across the three ways a sign-up names where it was going: an admin
// who ticks "Gold Series" means everybody waiting on Gold, however their
// registration happens to describe it.
ok("someone who signed up for a ticked series is pooled",
  queueRowMatchesDestinations(waiting({ series_id: "gold", season_id: "other" }), dest));
ok("someone who signed up for a ticked season is pooled",
  queueRowMatchesDestinations(waiting({ series_id: "unknown", season_id: "silver-s4" }), dest));
ok("someone who asked for a ticked division is pooled",
  queueRowMatchesDestinations(
    waiting({ series_id: "unknown", season_id: "unknown", class_ids: ["am"] }), dest));
ok("someone waiting on a different series entirely is not",
  !queueRowMatchesDestinations(
    waiting({ series_id: "bronze", season_id: "bronze-s1", class_ids: ["rookie"] }), dest));
// A number change is a driver already racing. One should never reach this
// state, and if one did it must not be poured onto a placement sheet.
ok("a number change is never pooled",
  !queueRowMatchesDestinations(waiting({ kind: "number_change" }), dest));
ok("a missing row doesn't throw", !queueRowMatchesDestinations(undefined, dest));

// ── 3. Pooling them onto the sheet ─────────────────────────────────────────
const queue = [
  waiting({ id: "q1", uid: "u1", driver_id: "d1", name: "Ana", series_id: "gold" }),
  waiting({ id: "q2", uid: "u2", driver_id: "d2", name: "Ben", series_id: "silver", season_id: "silver-s4" }),
  waiting({ id: "q3", uid: "u3", driver_id: "d3", name: "Cal", series_id: "bronze", season_id: "bronze-s1" }),
];

const pooled = importFromQueuePlan(queue, [], dest);
check("the whole field for these divisions arrives at once",
  pooled.add.map(r => r.name), ["Ana", "Ben"]);
check("and nobody else does", pooled.already, []);
ok("Cal, who is waiting on another series, is left where he is",
  !pooled.add.some(r => r.name === "Cal"));

// The point of the pool, stated as itself: two series, one sheet. That is what
// lets a placement night rank the whole field against itself before splitting
// it, instead of running a session per division.
check("drivers from DIFFERENT destination series pool into one session",
  [...new Set(pooled.add.map(r => queue.find(q => q.id === r.signup_request_id).series_id))].sort(),
  ["gold", "silver"]);

// They arrive unplaced — which division they belong in is the question the
// night exists to answer, and pre-filling it would open the board fully sorted.
const seeded = queueRowToSheetRow(waiting({ class_ids: ["pro"], class_names: ["Pro"] }));
check("an imported driver arrives in no division", seeded.assigned_class_id, "");
check("and in no series", seeded.assigned_series_id, "");
check("they bring their identity", [seeded.driver_id, seeded.user_id, seeded.name], ["d1", "u1", "Ana"]);
check("and the number they asked for", seeded.number, "24");
check("and a thread back to the registration", seeded.signup_request_id, "q1");

// Pressing it twice is the normal way to use it — import, approve two more
// registrations, import again — so a second press must add only the new people.
const second = importFromQueuePlan(queue, pooled.add, dest);
check("importing again adds nobody twice", second.add, []);
check("and says who was already there", second.already.sort(), ["Ana", "Ben"]);

// Matched however the sheet happens to name them: a driver typed in by hand off
// the game's timing screen has a name and nothing else.
check("a driver already on the sheet by name alone is not imported again",
  importFromQueuePlan(queue, [{ name: "ana" }], dest).add.map(r => r.name), ["Ben"]);
check("...nor one matched by their account",
  importFromQueuePlan(queue, [{ user_id: "u2" }], dest).add.map(r => r.name), ["Ana"]);
// Two registrations for one person (two seasons, both being placed tonight) are
// one driver on the sheet, not two rows racing each other.
check("one person waiting twice is one row",
  importFromQueuePlan([
    waiting({ id: "a", driver_id: "d9", name: "Dee", series_id: "gold" }),
    waiting({ id: "b", driver_id: "d9", name: "Dee", series_id: "silver" }),
  ], [], dest).add.length, 1);
check("a session with nowhere to send people imports nobody",
  importFromQueuePlan(queue, [], empty).add, []);

// ── 4. Clearing the queue once the roster is built ─────────────────────────
//
// Read against what the roster run actually did (planRosterBuild's `placed`),
// so the two can't disagree about who ended the night racing.
const sheet = [
  { id: "1", name: "Ana", driver_id: "d1", user_id: "u1", assigned_class_id: "pro" },
  { id: "2", name: "Ben", driver_id: "d2", user_id: "u2", assigned_class_id: "am" },
  // On the sheet, never placed — nobody dropped a card on him.
  { id: "3", name: "Eve", driver_id: "d5", user_id: "u5", assigned_class_id: "" },
];
const built = planRosterBuild(sheet, [], { requireClass: true });
check("the run reports who got a roster spot", built.placed.map(r => r.name), ["Ana", "Ben"]);

const cleared = queueRowsPlacedBy(queue, built.placed, dest);
check("the drivers this session placed stop waiting", cleared.map(r => r.name), ["Ana", "Ben"]);

// The two failures this is written to prevent, in order of how quiet they are.
const eveWaiting = waiting({ id: "q4", uid: "u5", driver_id: "d5", name: "Eve", series_id: "gold" });
ok("a driver who was on the sheet but never placed keeps waiting",
  !queueRowsPlacedBy([eveWaiting], built.placed, dest).length);
ok("a driver waiting on another series is untouched, even if placed tonight",
  !queueRowsPlacedBy(
    [waiting({ id: "q5", driver_id: "d1", name: "Ana", series_id: "bronze", season_id: "bronze-s1" })],
    built.placed, dest).length);
check("a run that placed nobody clears nobody", queueRowsPlacedBy(queue, [], dest), []);
check("and a session with no destinations clears nobody",
  queueRowsPlacedBy(queue, built.placed, empty), []);

// Cleared by PERSON, not by the import link: an admin who typed a waiting
// driver onto the sheet by hand has still placed them, and the queue must not
// go on claiming otherwise.
check("a hand-typed driver is cleared too",
  queueRowsPlacedBy(
    [waiting({ id: "q6", driver_id: "", uid: "", name: "Ben" })],
    [{ name: "ben", assigned_class_id: "am" }], dest).map(r => r.id),
  ["q6"]);
// …and a row that names nobody matches nobody, rather than everybody.
check("a nameless queue row is not cleared by a nameless sheet row",
  queueRowsPlacedBy([waiting({ id: "q7", driver_id: "", uid: "", name: "" })], [{ name: "" }], dest), []);
check("a nameless row has no identity keys", queueIdentityKeys({ }), []);
check("a queue row is identified by driver, account and name",
  queueIdentityKeys(waiting()), ["d:d1", "u:u1", "n:ana"]);

// ── 5. The roster's filters ────────────────────────────────────────────────
const mixed = [
  waiting({ id: "1", game_id: "g1", game_name: "iRacing", series_id: "gold", series_name: "Gold", season_id: "g-s4", season_name: "S4" }),
  waiting({ id: "2", game_id: "g1", game_name: "iRacing", series_id: "silver", series_name: "Silver", season_id: "s-s4", season_name: "S4" }),
  waiting({ id: "3", game_id: "g2", game_name: "ACC", series_id: "acc-pro", series_name: "ACC Pro", season_id: "acc-s1", season_name: "S1" }),
];
check("every game anybody is waiting on is offered",
  queueFilterOptions(mixed).games.map(g => g.name), ["ACC", "iRacing"]);
check("the series menu narrows to the chosen game",
  queueFilterOptions(mixed, { game_id: "g1" }).series.map(s => s.name), ["Gold", "Silver"]);
check("and the season menu to the chosen series",
  queueFilterOptions(mixed, { game_id: "g1", series_id: "silver" }).seasons.map(s => s.id), ["s-s4"]);
check("filtering by season answers 'who is waiting for THIS season'",
  applyQueueFilters(mixed, { season_id: "g-s4" }).map(r => r.id), ["1"]);
check("filtering by game keeps its whole field",
  applyQueueFilters(mixed, { game_id: "g1" }).map(r => r.id), ["1", "2"]);
check("no filters is the whole queue", applyQueueFilters(mixed, {}).length, 3);
check("a filter nobody matches shows nothing rather than everything",
  applyQueueFilters(mixed, { season_id: "nope" }), []);

// ── 6. How long they've been waiting ───────────────────────────────────────
//
// The question this roster answers is "how long has this person been owed a
// session?", so the column is a duration rather than a timestamp.
const now = Date.parse("2026-08-14T12:00:00.000Z");
check("today reads as today", waitingFor("2026-08-14T01:00:00.000Z", now), "today");
check("yesterday reads as yesterday", waitingFor("2026-08-13T01:00:00.000Z", now), "yesterday");
check("a fortnight reads in days", waitingFor("2026-07-31T12:00:00.000Z", now), "14 days ago");
check("a missing date doesn't throw", waitingFor(undefined, now), "at some point");

console.log(`placementQueue: ${n} assertions passed`);
