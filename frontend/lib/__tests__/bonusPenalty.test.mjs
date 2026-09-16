// Bonus points and penalty points, from the row that stores them to the
// championship table that adds them up.
//
// These are the numbers a league argues about. A finishing position is not in
// dispute — everyone watched the race — but "he got the fastest lap bonus and
// I didn't" and "that penalty came off twice" are, and they are the two the
// app has to be able to defend line by line. There are five separate ways a
// result can gain or lose points on top of its finishing position, and they
// arrive from different places:
//
//   • the FLAG bonuses — fastest lap, most laps led, led a lap, halfway
//     leader, hard charger — ticked on the grid (or derived from the numbers)
//     and paid at whatever rate the season, class or points template sets
//   • `bonus_points`, a free figure typed on the row
//   • `penalty_points`, the same in the other direction
//   • `points_adjustment`, the signed per-result correction — what a
//     SimRacerHub import carries a penalty across in
//   • the entry's own `points_adjustment`, a season-long correction applied
//     once to the championship total rather than to any one race
//
// What is checked here:
//
//   1. Each one is paid, once, at the right rate, and only when it applies.
//   2. The itemised breakdown the grid shows (explainPoints) ADDS UP TO the
//      total the standings use (pointsFor). This is the one that matters: the
//      breakdown is how a driver checks a total, so a term missing from it —
//      or counted in it but not in the total — is the app telling two stories.
//   3. The rows that score differently on purpose stay that way: a DNS scores
//      nothing at all, and a provisional entry scores its flat figure.
//   4. A blank, a null, an empty string or a number typed as text never
//      produces NaN — one NaN anywhere poisons a whole championship column.
//   5. And the whole path end to end: rows in, standings out, with every
//      bonus and penalty landing exactly once.
import assert from "node:assert";
import {
  calculateStandings, decorateRaceBonuses, explainPoints, pointsFor, resolveSeasonConfig,
} from "../standings.js";
import { resultDoc } from "../resultsWrite.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// A season paying a different rate for every bonus, so a bonus credited under
// the wrong name shows up as the wrong number rather than passing by luck.
const config = resolveSeasonConfig({
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80 }),
  qual_points: JSON.stringify({ 1: 10, 2: 5 }),
  bonus_points: { best_lap: 3, most_laps_led: 7, lead_a_lap: 1, halfway_point: 5, hard_charger: 11 },
}, null);

const race = (extra = {}) => ({ race_id: "r1", entry_id: "e1", session: "Race", session_type: "race", finish_pos: 2, ...extra });
const qual = (extra = {}) => ({ race_id: "r1", entry_id: "e1", session: "Qualifying", session_type: "qualifying", finish_pos: 1, ...extra });

// THE invariant: what the grid itemises is what the standings count.
const sum = parts => parts.reduce((a, p) => a + Number(p.value || 0), 0);
function agrees(label, result, cfg = config) {
  const total = pointsFor(result, cfg);
  const itemised = sum(explainPoints(result, cfg));
  n++;
  assert.strictEqual(itemised, total,
    `${label}: the breakdown must add up to the total — breakdown ${itemised}, total ${total}`);
  return total;
}

// ── 1. Each flag bonus, paid once and at its own rate ─────────────────────

check("a plain P2 is the finishing points alone", pointsFor(race(), config), 90);
check("fastest lap pays its own rate", pointsFor(race({ fastest_lap: true }), config), 93);
check("most laps led pays its own rate", pointsFor(race({ most_laps_led: true }), config), 97);
check("leading a lap pays off the Led column", pointsFor(race({ laps_led: 1 }), config), 91);
check("…however many laps that was", pointsFor(race({ laps_led: 40 }), config), 91);
check("…and leading none pays nothing", pointsFor(race({ laps_led: 0 }), config), 90);
check("the halfway leader pays its own rate", pointsFor(race({ halfway_leader: true }), config), 95);
check("the hard charger pays its own rate", pointsFor(race({ hard_charger: true }), config), 101);

// All of them at once: 90 + 3 + 7 + 1 + 5 + 11. The driver who led every lap
// from pole to flag, which is the row where a double-count would hide.
check("every bonus at once, each paid once", pointsFor(race({
  fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true, hard_charger: true,
}), config), 117);
agrees("every bonus at once", race({
  fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true, hard_charger: true,
}));

// A bonus the season doesn't pay for is not a bonus, however it is ticked.
{
  const noBonuses = resolveSeasonConfig({
    race_points: JSON.stringify({ 1: 100, 2: 90 }), qual_points: JSON.stringify({ 1: 10 }), bonus_points: {},
  }, null);
  check("a season that pays no bonuses pays none", pointsFor(race({
    fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true, hard_charger: true,
  }), noBonuses), 90);
  check("…and itemises none", explainPoints(race({ fastest_lap: true }), noBonuses).length, 1);
}

// Most laps led has two sources: the box an admin ticked, and the figure
// derived from the Led column when nobody ticked one. An admin's answer wins.
{
  const rows = decorateRaceBonuses([
    { race_id: "r1", session: "Race", entry_id: "e1", finish_pos: 1, laps_led: 30 },
    { race_id: "r1", session: "Race", entry_id: "e2", finish_pos: 2, laps_led: 10 },
  ]);
  check("whoever led the most is credited without a box being ticked",
    rows.map(r => r.is_most_laps_led), [true, false]);
  const overridden = decorateRaceBonuses([
    { race_id: "r1", session: "Race", entry_id: "e1", finish_pos: 1, laps_led: 30, most_laps_led: false },
    { race_id: "r1", session: "Race", entry_id: "e2", finish_pos: 2, laps_led: 10, most_laps_led: true },
  ]);
  check("an admin's own answer wins over the arithmetic",
    overridden.map(r => r.is_most_laps_led), [false, true]);
  check("…and is what gets paid",
    pointsFor({ ...overridden[1], session_type: "race", finish_pos: 2 }, config), 90 + 7 + 1);
  // A session nobody led is nobody's bonus.
  check("a session with no laps led credits nobody", decorateRaceBonuses([
    { race_id: "r1", session: "Race", entry_id: "e1", finish_pos: 1, laps_led: 0 },
  ])[0].is_most_laps_led, false);
  // Two sessions of one event are scored apart: the heat winner's 20 laps
  // must not take the feature's bonus off the driver who led it.
  const twoSessions = decorateRaceBonuses([
    { race_id: "r1", session: "Heat 1", entry_id: "e1", finish_pos: 1, laps_led: 20 },
    { race_id: "r1", session: "Feature", entry_id: "e2", finish_pos: 1, laps_led: 5 },
  ]);
  check("each session has its own most-laps-led", twoSessions.map(r => r.is_most_laps_led), [true, true]);
}

// ── 2. The typed figures: bonus, penalty and the adjustment ───────────────

check("bonus points are added", pointsFor(race({ bonus_points: 12 }), config), 102);
check("penalty points are taken off", pointsFor(race({ penalty_points: 12 }), config), 78);
check("both at once net out", pointsFor(race({ bonus_points: 12, penalty_points: 5 }), config), 97);
check("an adjustment is signed", pointsFor(race({ points_adjustment: -25 }), config), 65);
check("…and a positive one adds", pointsFor(race({ points_adjustment: 25 }), config), 115);
check("all three together, each once",
  pointsFor(race({ bonus_points: 12, penalty_points: 5, points_adjustment: -2 }), config), 95);

// Leagues pay in halves, and a penalty is not always whole.
check("a half-point bonus survives", pointsFor(race({ bonus_points: 2.5 }), config), 92.5);
check("a half-point penalty survives", pointsFor(race({ penalty_points: 0.5 }), config), 89.5);

// A penalty entered as a NEGATIVE in the penalty box would add points if the
// sign were applied twice. It is subtracted, so it adds — the behaviour to
// pin down either way, since it is the shape a mis-entry takes.
check("the penalty box subtracts whatever is in it", pointsFor(race({ penalty_points: -10 }), config), 100);

// On a qualifying row: the typed figures apply, the racing bonuses never do.
check("qualifying takes its typed bonus", pointsFor(qual({ bonus_points: 4 }), config), 14);
check("qualifying takes its typed penalty", pointsFor(qual({ penalty_points: 4 }), config), 6);
check("qualifying takes its adjustment", pointsFor(qual({ points_adjustment: -3 }), config), 7);
check("qualifying pays no racing bonus, however ticked", pointsFor(qual({
  fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true, hard_charger: true,
}), config), 10);

// ── 3. The rows that score differently on purpose ─────────────────────────

// A driver who never took the green flag scores nothing — not their bonus, not
// their penalty, and not their adjustment. A no-show that has to cost them
// something is an entry-level adjustment, not a scored result.
for (const dns of [{ status: "dns" }, { status: "DNS" }]) {
  check(`a ${dns.status} scores nothing at all`, pointsFor(race({
    ...dns, fastest_lap: true, bonus_points: 50, penalty_points: 10, points_adjustment: 25,
  }), config), 0);
}
agrees("a DNS", race({ status: "dns", bonus_points: 50, penalty_points: 10 }));

// A DNF raced — they are classified, and everything they earned counts.
check("a DNF is scored like any other finisher",
  pointsFor(race({ status: "dnf", laps_led: 3, bonus_points: 2 }), config), 90 + 1 + 2);

// A provisional entry has no finishing position to be scored off, so its flat
// figure IS its points — plus an adjustment, which is how a penalty reaches it.
check("a provisional entry scores its flat figure",
  pointsFor(race({ provisional: true, manual_points: 10 }), config), 10);
check("…plus an adjustment", pointsFor(race({ provisional: true, manual_points: 10, points_adjustment: -4 }), config), 6);
check("…and not the finishing points it never earned",
  pointsFor(race({ provisional: true, manual_points: 10, fastest_lap: true }), config), 10);
agrees("a provisional entry", race({ provisional: true, manual_points: 10, points_adjustment: -4 }));

// ── 3b. A points figure set on the row wins over the structure ────────────
//
// This is how a season imported from SimRacerHub gets a championship table
// here that agrees with the one already on that site: its scale, its bonuses,
// its penalties and its stage points are one figure per driver that no
// structure here can reproduce, so the figure itself is written onto the row.
// Same mechanism a provisional entry has always used, no longer gated on being
// one.
check("a figure set on the row is what the row scores",
  pointsFor(race({ manual_points: 75 }), config), 75);
check("…whatever the structure would have paid for that position",
  pointsFor(race({ finish_pos: 1, manual_points: 75 }), config), 75);
check("…and whatever bonuses are ticked on it",
  pointsFor(race({ manual_points: 75, fastest_lap: true, laps_led: 40, hard_charger: true }), config), 75);
check("…with a later adjustment still applying on top",
  pointsFor(race({ manual_points: 75, points_adjustment: -10 }), config), 65);
check("a figure of zero is a figure, not a blank",
  pointsFor(race({ manual_points: 0 }), config), 0);
// Clearing the cell is the way back: an empty string is no figure at all, and
// the row returns to being scored by the league's own structure.
check("clearing it hands the row back to the structure",
  pointsFor(race({ manual_points: "" }), config), 90);
check("…and so does never having had one", pointsFor(race({ manual_points: null }), config), 90);
// Qualifying takes one too — SimRacerHub pays for a grid slot and that has to
// come across as readily as a race result.
check("a qualifying row takes one as well", pointsFor(qual({ manual_points: 4 }), config), 4);
// A DNS still scores nothing: they never took the green flag, and no figure on
// the row changes that.
check("a DNS scores nothing even with a figure on it",
  pointsFor(race({ status: "dns", manual_points: 75 }), config), 0);
// The breakdown says where the number came from, and says it differently for
// the two things that arrive this way.
check("the breakdown names an imported figure",
  explainPoints(race({ manual_points: 75 }), config).map(p => p.label), ["Points set on this row"]);
check("…and still calls a provisional entry what it is",
  explainPoints(race({ provisional: true, manual_points: 10 }), config).map(p => p.label), ["Provisional entry"]);
agrees("a row scored on its own figure", race({ manual_points: 75 }));
agrees("…with an adjustment", race({ manual_points: 75, points_adjustment: -10 }));
agrees("…on a qualifying row", qual({ manual_points: 4, points_adjustment: 1 }));
// Junk in that field must not become NaN any more than in the others.
check("junk in the figure reads as nothing",
  pointsFor(race({ manual_points: "x" }), config), 0);

// ── 4. The breakdown adds up to the total, on every shape of row ──────────
//
// The grid shows a driver WHY they got a number. If the itemisation and the
// total ever disagree, one of the two screens is lying, and there is no way to
// tell which from the outside.
const shapes = {
  "a plain finish": race(),
  "a win with the fastest lap": race({ finish_pos: 1, fastest_lap: true }),
  "a win leading every lap": race({ finish_pos: 1, fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true }),
  "a charge through the field": race({ hard_charger: true, laps_led: 2 }),
  "a typed bonus": race({ bonus_points: 12 }),
  "a typed penalty": race({ penalty_points: 12 }),
  "a bonus and a penalty": race({ bonus_points: 12, penalty_points: 5 }),
  "an adjustment": race({ points_adjustment: -25 }),
  "everything at once": race({
    finish_pos: 1, fastest_lap: true, most_laps_led: true, laps_led: 40, halfway_leader: true,
    hard_charger: true, bonus_points: 12, penalty_points: 5, points_adjustment: -2,
  }),
  "a pole": qual(),
  "a grid slot with a penalty": qual({ finish_pos: 2, penalty_points: 3 }),
  "a pole with a bonus and an adjustment": qual({ bonus_points: 4, points_adjustment: -1 }),
  "an unscored position": race({ finish_pos: 40 }),
};
for (const [label, row] of Object.entries(shapes)) agrees(label, row);

// The breakdown names them, so a driver reading it can see which is which.
{
  const labels = explainPoints(race({ bonus_points: 12, penalty_points: 5, points_adjustment: -2 }), config)
    .map(p => p.label);
  check("the breakdown names each term", labels, ["P2 finish", "Bonus points", "Penalty points", "Adjustment"]);
  const values = explainPoints(race({ bonus_points: 12, penalty_points: 5, points_adjustment: -2 }), config)
    .map(p => p.value);
  check("…and a penalty is shown as the negative it is", values, [90, 12, -5, -2]);
  // Nothing typed, nothing listed — an empty "Bonus points 0" line is noise.
  check("a term worth nothing isn't listed",
    explainPoints(race(), config).map(p => p.label), ["P2 finish"]);
}

// ── 5. A blank is zero, never NaN ─────────────────────────────────────────
//
// One NaN anywhere turns a whole championship column into NaN, and it is
// unrecoverable on screen — so every way a figure can arrive empty is checked.
for (const blank of [undefined, null, "", "  "]) {
  const label = JSON.stringify(blank);
  check(`a bonus of ${label} is zero`, pointsFor(race({ bonus_points: blank }), config), 90);
  check(`a penalty of ${label} is zero`, pointsFor(race({ penalty_points: blank }), config), 90);
  check(`an adjustment of ${label} is zero`, pointsFor(race({ points_adjustment: blank }), config), 90);
}
// A grid puts what was typed in the box on the row, and that is a string.
check("a bonus typed as text still counts", pointsFor(race({ bonus_points: "12" }), config), 102);
check("a penalty typed as text still counts", pointsFor(race({ penalty_points: "12" }), config), 78);
check("an adjustment typed as text still counts", pointsFor(race({ points_adjustment: "-5" }), config), 85);
// Nothing in the app can type a non-numeric figure into these — the Adj box is
// a number input, and bonus_points / penalty_points have no box at all — but
// the API and a restored backup can. One NaN does not stay where it lands: it
// spreads through the driver's session total, their championship row, the team
// table and the gap to the leader, leaving a column of "NaN" that no screen can
// attribute and no input can clear. So a figure that isn't a number reads as
// nothing, which is the answer a blank already gives.
for (const junk of ["x", "12abc", {}, NaN, Infinity, -Infinity]) {
  const label = String(junk);
  check(`a bonus of ${label} reads as nothing`, pointsFor(race({ bonus_points: junk }), config), 90);
  check(`a penalty of ${label} reads as nothing`, pointsFor(race({ penalty_points: junk }), config), 90);
  check(`an adjustment of ${label} reads as nothing`, pointsFor(race({ points_adjustment: junk }), config), 90);
}
check("all three at once still score the finish alone",
  pointsFor(race({ bonus_points: "x", penalty_points: {}, points_adjustment: NaN }), config), 90);
check("a provisional entry's flat figure is guarded too",
  pointsFor(race({ provisional: true, manual_points: "x" }), config), 0);
check("so is the Led column a bonus is paid off",
  pointsFor(race({ laps_led: "x" }), config), 90);
// A bonus RATE that isn't a number is the same hazard one level up — it comes
// out of a season's stored JSON, not off the row.
{
  const bentCfg = resolveSeasonConfig({
    race_points: JSON.stringify({ 2: 90 }), qual_points: "{}",
    bonus_points: { best_lap: "x", hard_charger: 11 },
  }, null);
  check("a bent bonus rate pays nothing, and the sound ones still pay",
    pointsFor(race({ fastest_lap: true, hard_charger: true }), bentCfg), 101);
}
// The breakdown has to agree with the total on a bent row too, or the grid
// explains a number the standings don't hold.
agrees("a row carrying junk", race({ bonus_points: "x", penalty_points: {}, points_adjustment: NaN }));
ok("no shape of junk produces NaN anywhere",
  [undefined, null, "", "  ", "x", "12abc", {}, [], NaN, Infinity].every(v =>
    Number.isFinite(pointsFor(race({ bonus_points: v, penalty_points: v, points_adjustment: v, laps_led: v }), config))));

// ── 6. What actually gets STORED ──────────────────────────────────────────
//
// The scorer above is only right about a row the writer stored correctly. Every
// result — typed in by hand or imported in bulk — is built by one module, so
// this is where a bonus typed "12" becomes the number 12 (see lib/resultsWrite).
{
  const stored = resultDoc(
    { entry_id: "e1", finish_pos: "2", bonus_points: "12", penalty_points: "5", points_adjustment: "-2" },
    { race_id: "r1", season_id: "s1", session: "Race", sessionType: "race", classByEntry: {}, now: "now", uid: "u1" },
  );
  check("a bonus is stored as a number", stored.bonus_points, 12);
  check("a penalty is stored as a number", stored.penalty_points, 5);
  check("an adjustment is stored as a number", stored.points_adjustment, -2);
  check("…and scores what it says", pointsFor({ ...stored, session_type: "race" }, config), 95);

  // A row that names none of them stores zeros, not undefined — a missing
  // field would read as a blank cell everywhere that shows one.
  const bare = resultDoc(
    { entry_id: "e1", finish_pos: 2 },
    { race_id: "r1", season_id: "s1", session: "Race", sessionType: "race", classByEntry: {}, now: "now", uid: "u1" },
  );
  check("a row with no bonus stores a zero", [bare.bonus_points, bare.penalty_points, bare.points_adjustment], [0, 0, 0]);
  check("…and a provisional's flat points stay null until set", bare.manual_points, null);

  // What a SimRacerHub import carries across: its penalties and its own
  // bonuses, as one signed adjustment, leaving the finishing points to the
  // league's own structure. A negative one has to survive the trip.
  const imported = resultDoc(
    { entry_id: "e1", finish_pos: 2, points_adjustment: -14 },
    { race_id: "r1", season_id: "s1", session: "Race", sessionType: "race", classByEntry: {}, now: "now", uid: "u1" },
  );
  check("an imported penalty is stored signed", imported.points_adjustment, -14);
  check("…and is taken off the scored points", pointsFor({ ...imported, session_type: "race" }, config), 76);

  // The scorer refuses to READ a NaN; this refuses to WRITE one, so it can
  // never reach the database from an API call or a restored backup.
  const junk = resultDoc(
    { entry_id: "e1", finish_pos: 2, bonus_points: "x", penalty_points: {}, points_adjustment: "not a number", laps_led: "x" },
    { race_id: "r1", season_id: "s1", session: "Race", sessionType: "race", classByEntry: {}, now: "now", uid: "u1" },
  );
  check("junk is never stored as a points figure",
    [junk.bonus_points, junk.penalty_points, junk.points_adjustment, junk.laps_led], [0, 0, 0, 0]);
  ok("nothing the writer stores is NaN",
    Object.values(junk).every(v => typeof v !== "number" || Number.isFinite(v)));
}

// ── 7. End to end: rows in, championship out ──────────────────────────────
//
// Every bonus and penalty above, landing exactly once in a season table.
{
  const entries = [
    { id: "e1", name: "Ana" },
    { id: "e2", name: "Bo" },
    // Bo's team-mate carries a season-long correction on the entry itself —
    // applied once to the total, never to a race.
    { id: "e3", name: "Cass", points_adjustment: -30, adjustment_note: "Round 1 conduct" },
  ];
  const rows = decorateRaceBonuses([
    // Ana: pole 10. Race win 100 + FL 3 + MLL 7 + led 1 + halfway 5 = 116.
    qual({ entry_id: "e1", finish_pos: 1 }),
    race({ entry_id: "e1", finish_pos: 1, fastest_lap: true, laps_led: 40, halfway_leader: true }),
    // Bo: P2 qual 5, less a 2-point qualifying penalty = 3.
    //     P2 race 90 + hard charger 11 + bonus 4 - penalty 6 - adjustment 1 = 98.
    qual({ entry_id: "e2", finish_pos: 2, penalty_points: 2 }),
    race({ entry_id: "e2", finish_pos: 2, hard_charger: true, laps_led: 0, bonus_points: 4, penalty_points: 6, points_adjustment: -1 }),
    // Cass: P3 80, no bonuses, then the entry-level 30 off the season total.
    race({ entry_id: "e3", finish_pos: 3 }),
  ]);
  const table = calculateStandings(rows, entries, [], config, {}, []);
  const by = Object.fromEntries(table.rows.map(r => [r.entry_id, r]));

  check("Ana's earned points", by.e1.points, 126);
  check("Bo's earned points", by.e2.points, 101);
  check("Cass's earned points", by.e3.points, 80);

  check("a season-long correction comes off the total once", by.e3.adjusted_points, 50);
  check("…and is reported so it can be queried", [by.e3.points_adjustment, by.e3.adjustment_note], [-30, "Round 1 conduct"]);
  check("an entry with no correction is untouched", [by.e1.adjusted_points, by.e2.adjusted_points], [126, 101]);

  // THE invariant, on the whole table: a championship total is the sum of the
  // Points column on every session that driver ran — so it can be checked by
  // hand from what is on screen.
  for (const entry of entries) {
    const onScreen = rows.filter(r => r.entry_id === entry.id).reduce((a, r) => a + pointsFor(r, config), 0);
    const expected = onScreen + Number(entry.points_adjustment || 0);
    n++;
    assert.strictEqual(by[entry.id].adjusted_points, expected,
      `${entry.name}'s total must be the sum of their grids: table ${by[entry.id].adjusted_points}, grids ${expected}`);
  }

  check("and the order follows the adjusted totals", table.rows.map(r => r.driver_name), ["Ana", "Bo", "Cass"]);
}

console.log(`bonusPenalty: ${n} checks passed`);
