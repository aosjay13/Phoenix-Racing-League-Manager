// A class championship must name the drivers racing in it.
//
// A class table is built from two different answers to "is this in the class?":
//
//   • the RESULTS are narrowed by the class each result RECORDS (classOfResult)
//     — the stamp put on the row when it was saved, which is what keeps a class
//     championship historically exact;
//   • the ROSTER is narrowed by the classes an entry is in TODAY.
//
// Those two answers are allowed to disagree, by design, and they routinely do:
//
//   1. a "<class> only" round stamps its class on every result it saves, and an
//      unclassified driver is deliberately still eligible to be entered in one;
//   2. a per-class session stamps the class being entered on every row, so a
//      mis-set dropdown can't leak a driver into another class's grid;
//   3. a driver re-classed after they raced keeps the class on the races they
//      already ran — that is the whole point of stamping it.
//
// When they disagreed, the results came through and the roster didn't, so the
// driver arrived in their own class championship with no name, no number, no
// team and no points adjustment: a row reading "Unknown" holding real points,
// and the same driver missing outright from the class's Stats and Records.
//
// The rule these tests hold to: the results decide WHO IS IN the table, the
// season's whole roster decides WHAT THEY ARE CALLED. Never the other way
// round, and never both from the same filter.
import assert from "node:assert";
import { standingsFromBundle } from "../standingsCompute.js";
import { statsFromBundle } from "../statsCompute.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// One season of PC Wreckfest running two classes. Round 1 is pinned to Pro
// ("<class> only"), Round 2 is shared and entered per class.
const season = {
  id: "s1", name: "Season 1", game_id: "g1", series_id: "sr1", status: "completed",
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70 }),
  qual_points: "{}", bonus_points: {},
};

const bundle = {
  scope: "season", league_id: null, game_id: "g1", series_id: "sr1", season_id: "s1",
  seasons: [season],
  series: [{ id: "sr1", game_id: "g1", name: "Marathon Series" }],
  games: [{ id: "g1", name: "PC Wreckfest" }],
  tracks: [], teams: [], team_seasons: [], drivers: [], account_names: {}, points_templates: [],
  time_trials: [], time_trial_entries: [],
  classes: [
    { id: "pro", season_id: "s1", name: "Pro", sort_order: 1 },
    { id: "am", season_id: "s1", name: "Amateur", sort_order: 2 },
  ],
  races: [
    { id: "r1", season_id: "s1", name: "Round 1", date: "2025-01-01", sessions: ["Race"], class_id: "pro" },
    { id: "r2", season_id: "s1", name: "Round 2", date: "2025-01-08", sessions: ["Race"] },
  ],
  entries: [
    // On the Pro roster, and raced Pro. The uncomplicated case.
    { id: "e1", season_id: "s1", name: "Ana", number: "1", class_ids: ["pro"], class_id: "pro" },
    // Never assigned a class — entered in the Pro-only round anyway, which
    // entriesEligibleForRace explicitly allows.
    { id: "e2", season_id: "s1", name: "Bo", number: "2" },
    // Raced Pro, then moved to Amateur. Carries a penalty, so the adjustment
    // has to travel with the name.
    { id: "e3", season_id: "s1", name: "Cy", number: "3", class_ids: ["am"], class_id: "am",
      points_adjustment: -25, adjustment_note: "Race 1 penalty" },
    // Amateur throughout, and never scored in Pro.
    { id: "e4", season_id: "s1", name: "Di", number: "4", class_ids: ["am"], class_id: "am" },
  ],
  results: [
    // Round 1 — the round's own class is stamped on every row it saved.
    { id: "x1", season_id: "s1", race_id: "r1", entry_id: "e2", session: "Race", session_type: "race", finish_pos: 1, class_id: "pro" },
    { id: "x2", season_id: "s1", race_id: "r1", entry_id: "e1", session: "Race", session_type: "race", finish_pos: 2, class_id: "pro" },
    { id: "x3", season_id: "s1", race_id: "r1", entry_id: "e3", session: "Race", session_type: "race", finish_pos: 3, class_id: "pro" },
    // Round 2 — Pro's session, saved under the Pro scope.
    { id: "x4", season_id: "s1", race_id: "r2", entry_id: "e1", session: "Race", session_type: "race", finish_pos: 1, class_id: "pro" },
    { id: "x5", season_id: "s1", race_id: "r2", entry_id: "e2", session: "Race", session_type: "race", finish_pos: 2, class_id: "pro" },
    // Round 2 — Amateur's session.
    { id: "x6", season_id: "s1", race_id: "r2", entry_id: "e4", session: "Race", session_type: "race", finish_pos: 1, class_id: "am" },
    { id: "x7", season_id: "s1", race_id: "r2", entry_id: "e3", session: "Race", session_type: "race", finish_pos: 2, class_id: "am" },
  ],
};

const standings = params => standingsFromBundle(bundle, { seasonId: "s1", ...params }).body;
const stats = params => statsFromBundle(bundle, { scope: "season", seasonId: "s1", ...params }).body;

// ── 1. The class table names everyone it ranks ─────────────────────────────
//
// Bo was never put in a class and Cy has since been moved to Amateur, but both
// have results stamped Pro, so both are ranked in Pro — under their own names.
const pro = standings({ classId: "pro" });
check("every driver scoring in Pro is named",
  pro.drivers.map(r => `${r.rank} ${r.driver_name} ${r.adjusted_points}`),
  ["1 Ana 190", "2 Bo 190", "3 Cy 55"]);
check("nobody arrives as \"Unknown\"", pro.drivers.filter(r => r.driver_name === "Unknown"), []);
check("their car numbers come with their names",
  pro.drivers.map(r => r.driver_number), ["1", "2", "3"]);

// THE POINT of carrying the roster rather than the class's slice of it: an
// entry is where a manual adjustment lives, so losing the entry loses the
// penalty — silently, and only in the class table. Cy's 80 for P3 is docked 25.
check("a penalty follows its driver into the class table",
  pro.drivers.find(r => r.driver_name === "Cy").points_adjustment, -25);
check("and is applied, not merely reported",
  pro.drivers.find(r => r.driver_name === "Cy").adjusted_points, 55);

// The class column still reads off the roster, which is what it describes: Cy
// is an Amateur driver today, listed in Pro because that's where these results
// were recorded.
check("the class column shows where the driver is now",
  pro.drivers.map(r => r.class_name), ["Pro", null, "Amateur"]);

// ── 2. Ranking the results, not the roster ─────────────────────────────────
//
// Di is on the Pro-eligible roster of nothing and scored nothing in Pro, so
// being named is not the same as being included.
check("a driver with no Pro results stays out of Pro",
  pro.drivers.some(r => r.driver_name === "Di"), false);
check("and Amateur ranks its own",
  standings({ classId: "am" }).drivers.map(r => `${r.driver_name} ${r.adjusted_points}`),
  ["Di 100", "Cy 65"]);

// ── 3. The champion is a person ────────────────────────────────────────────
//
// A crown decided on totals that dropped a penalty is the wrong crown, so this
// checks the name AND that the adjustment counted: Ana and Bo tie on 190 and
// Ana takes it on the tie-breaker chain, while Cy's docked total keeps him out.
check("each class crowns a named champion",
  standings({}).champions.map(c => `${c.kind}:${c.class_name ?? ""} ${c.driver_name}`),
  ["class:Pro Ana", "class:Amateur Di", "overall: Ana"]);

// ── 4. Stats and Records agree with the standings ──────────────────────────
//
// The Stats page dropped these drivers instead of mis-naming them, which is the
// same fault wearing a different face: the class standings ranked a row the
// class stats had no line for at all.
check("the class's stats cover the same field as its standings",
  stats({ classId: "pro" }).rows.map(r => `${r.driver_name} ${r.starts}`).sort(),
  ["Ana 2", "Bo 2", "Cy 1"]);
check("and Amateur likewise",
  stats({ classId: "am" }).rows.map(r => `${r.driver_name} ${r.starts}`).sort(),
  ["Cy 1", "Di 1"]);

// ── 5. Nothing above the class changed ─────────────────────────────────────
//
// The combined table never filtered its roster, so the fix has to leave it
// exactly where it was.
check("the season table is untouched",
  standings({}).drivers.map(r => `${r.driver_name} ${r.adjusted_points}`),
  ["Ana 190", "Bo 190", "Cy 145", "Di 100"]);
check("as are the season's stats",
  stats({}).rows.map(r => `${r.driver_name} ${r.starts}`).sort(),
  ["Ana 2", "Bo 2", "Cy 2", "Di 1"]);

console.log(`classIdentity: ${n} checks passed — a class names every driver it ranks`);
