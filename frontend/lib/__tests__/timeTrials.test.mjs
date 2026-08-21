// Time Trials & Placements. The invariants that matter:
//
//   1. a driver's fastest lap is derived from their laps, never marked by hand,
//      so the bolded lap and the Best Time column can't disagree;
//   2. "Best Average Time" means the same thing on every sheet, because the
//      session says which laps it averages;
//   3. a driver with no lap is never "the fastest" and never blocks the order;
//   4. auto-placement splits the ranked field evenly, quickest divisions first,
//      and never invents a placement for somebody who didn't set a time;
//   5. building a roster from a placement UPDATES a driver already on it rather
//      than duplicating them, so the button is safe to press twice;
//   6. an export to qualifying puts pole on the fastest lap and leaves out
//      anyone the target roster doesn't have, loudly;
//   7. a league whose divisions are SERIES can place into them instead: the
//      series a driver is sorted into decides which season's roster they join,
//      one run builds every one of those rosters, and being placed into a
//      series is a placement in itself — no class required.
import assert from "node:assert";
import {
  AVERAGE_ALL_LAPS, LAPS_UNLIMITED, MAX_LAPS_CAP,
  autoAssignClasses, autoAssignClassesWithinSeries, autoAssignSeries, averageLabel,
  bestAverage, bestLap, entryIndex, groupByAssignedClass, groupByTargetSeason,
  lapSeconds, matchEntry, normalizeAverageLaps, normalizeLaps, normalizeMaxLaps, placedOrder,
  planQualifyingExport, planRosterBuild, planRosterRun, rankEntries, splitEvenly, summarizeEntries,
  summarizeEntry, targetSeasonFor, trialMatchesScope,
} from "../timeTrials.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const near = (label, got, want, tol = 1e-6) => {
  n++;
  assert.ok(got != null && Math.abs(got - want) < tol, `${label}: got ${got}, want ~${want}`);
};

// ── 1. Session settings ───────────────────────────────────────────────────
check("no lap cap by default", normalizeMaxLaps(undefined), LAPS_UNLIMITED);
check("a blank cap is unlimited", normalizeMaxLaps(""), LAPS_UNLIMITED);
check("zero is unlimited", normalizeMaxLaps(0), LAPS_UNLIMITED);
check("a negative cap is unlimited", normalizeMaxLaps(-4), LAPS_UNLIMITED);
check("a real cap survives", normalizeMaxLaps("5"), 5);
check("a fractional cap floors", normalizeMaxLaps(5.9), 5);
check("a typo can't render ten thousand inputs", normalizeMaxLaps(100000), MAX_LAPS_CAP);

check("averaging every lap by default", normalizeAverageLaps(undefined), AVERAGE_ALL_LAPS);
check("a 1-lap average is just the best lap, so it means 'all'", normalizeAverageLaps(1), AVERAGE_ALL_LAPS);
check("a real window survives", normalizeAverageLaps(3), 3);
check("the window can't exceed the session's own lap cap", normalizeAverageLaps(5, 3), 3);
check("an unlimited session doesn't cap the window", normalizeAverageLaps(5, 0), 5);
check("the column names itself", averageLabel(0), "Best Average Time");
check("…and names the window when there is one", averageLabel(3), "Best 3-Lap Avg");

// ── 2. Laps ───────────────────────────────────────────────────────────────
check("laps are stored as typed", normalizeLaps(["1:23.456", "1:22.100"]), ["1:23.456", "1:22.100"]);
check("the empty inputs at the bottom aren't laps", normalizeLaps(["1:23.456", "", ""]), ["1:23.456"]);
check("a missing lap in the middle keeps the numbering",
  normalizeLaps(["1:23.456", "", "1:21.000"]), ["1:23.456", "", "1:21.000"]);
check("laps are trimmed", normalizeLaps([" 1:23.456 "]), ["1:23.456"]);
check("a cap truncates the sheet", normalizeLaps(["1", "2", "3", "4"], 2), ["1", "2"]);
check("nothing at all is no laps", normalizeLaps(undefined), []);

// A lap is a time somebody actually turned. The clock parser has to be
// permissive enough for any timing screen, so this is where the line is drawn —
// and both of these look like data rather than like errors, which is what makes
// them worth catching.
check("zero is not a lap", lapSeconds("00:00.000"), null);
check("…nor is a bare zero", lapSeconds("0"), null);
check("…nor 0:00", lapSeconds("0:00"), null);
check("Infinity is not a lap", lapSeconds("Infinity"), null);
check("…nor an overflowing exponent", lapSeconds("1e400"), null);
check("a real lap is a real lap", lapSeconds("1:23.456"), 83.456);
check("gibberish is not a lap", lapSeconds("abc"), null);
check("blank is not a lap", lapSeconds(""), null);

// The zero case is the dangerous one: it would win Best Time outright and stand
// as the venue's track record, unbeatable, from one slip of the keyboard.
check("a mistyped zero can't take Best Time",
  bestLap(["00:00.000", "1:21.900"]), { lap: 2, seconds: 81.9, time: "1:21.900" });
check("…and a sheet of nothing but zeros has no best lap at all",
  bestLap(["0", "00:00.000"]), null);
check("a zero doesn't drag the average down either",
  bestAverage(["00:00.000", "10.000", "14.000"]).count, 2);
check("an Infinity lap never reaches the Best Time column",
  bestLap(["Infinity", "1:21.900"]).time, "1:21.900");
check("a rejected lap keeps its text so it can be seen and corrected",
  summarizeEntry({ laps: ["00:00.000", "1:21.900"] }).laps, ["00:00.000", "1:21.900"]);
check("…and is not counted as a timed lap",
  summarizeEntry({ laps: ["00:00.000", "1:21.900"] }).laps_timed, 1);

check("the fastest lap is found, not marked",
  bestLap(["1:23.456", "1:21.900", "1:22.500"]),
  { lap: 2, seconds: 81.9, time: "1:21.900" });
check("a tie keeps the lap that set it first",
  bestLap(["1:21.900", "1:21.900"]).lap, 1);
check("unreadable laps are ignored, not fatal",
  bestLap(["banana", "1:21.900"]), { lap: 2, seconds: 81.9, time: "1:21.900" });
check("no readable lap is no best lap", bestLap(["", "nonsense"]), null);

// Every-lap average: the consistency measure, where one scruffy lap counts.
near("every lap averages", bestAverage(["10.000", "12.000", "14.000"]).seconds, 12);
check("…and says how many it counted", bestAverage(["10.000", "12.000", "14.000"]).count, 3);
check("blank laps don't drag the average down", bestAverage(["10.000", "", "14.000"]).count, 2);

// Best N-consecutive: the time-attack measure.
near("the best 2-lap run wins", bestAverage(["20.000", "10.000", "11.000", "30.000"], 2).seconds, 10.5);
check("…and names the laps it came from",
  [bestAverage(["20.000", "10.000", "11.000", "30.000"], 2).from,
    bestAverage(["20.000", "10.000", "11.000", "30.000"], 2).to], [2, 3]);
check("too few laps for the window is no average",
  bestAverage(["10.000", "11.000"], 3), null);
check("a run can't jump a lap that wasn't completed",
  bestAverage(["10.000", "", "10.000"], 2), null);
near("…but a run either side of the gap still counts",
  bestAverage(["10.000", "", "20.000", "20.000"], 2).seconds, 20);
check("no laps at all is no average", bestAverage([]), null);

// ── 3. The sheet ──────────────────────────────────────────────────────────
const sheet = [
  { id: "a", name: "Ana", laps: ["1:30.000", "1:28.000", "1:29.000"] },
  { id: "b", name: "Ben", laps: ["1:27.500", "1:35.000"] },
  { id: "c", name: "Cal", laps: [] },
  { id: "d", name: "Dee", laps: ["1:29.500", "1:29.500", "1:29.500"] },
];
const summarized = summarizeEntries(sheet);

check("the summary carries the lap the highlight goes on",
  summarized.map(r => r.best_lap), [2, 1, null, 1]);
check("…and how many timed laps each driver ran",
  summarized.map(r => r.laps_timed), [3, 2, 0, 3]);

check("best time orders the sheet",
  rankEntries(summarized, { key: "best" }).map(r => r.name), ["Ben", "Ana", "Dee", "Cal"]);
check("the average tells a different story",
  rankEntries(summarized, { key: "average" }).map(r => r.name), ["Ana", "Dee", "Ben", "Cal"]);
check("a driver with no lap sorts last even reversed",
  rankEntries(summarized, { key: "best", asc: false }).map(r => r.name), ["Dee", "Ana", "Ben", "Cal"]);
check("only drivers who set a time are placed",
  placedOrder(summarized).map(r => `${r.position}:${r.name}`), ["1:Ben", "2:Ana", "3:Dee"]);

// ── 4. Placements ─────────────────────────────────────────────────────────
check("an even field splits evenly",
  autoAssignClasses(summarized, ["pro", "am"]), { b: "pro", a: "pro", d: "am" });
check("the remainder lands on the quicker division",
  autoAssignClasses(summarizeEntries([
    { id: "1", name: "One", laps: ["10.000"] },
    { id: "2", name: "Two", laps: ["11.000"] },
    { id: "3", name: "Three", laps: ["12.000"] },
    { id: "4", name: "Four", laps: ["13.000"] },
    { id: "5", name: "Five", laps: ["14.000"] },
  ]), ["a", "b"]),
  { 1: "a", 2: "a", 3: "a", 4: "b", 5: "b" });
check("somebody who never set a lap isn't placed by the machine",
  autoAssignClasses(summarized, ["pro", "am"]).c, undefined);
check("no divisions, no placement", autoAssignClasses(summarized, []), {});
check("the sheet groups by the division each driver ended up in",
  [...groupByAssignedClass(summarizeEntries([
    { id: "a", name: "Ana", laps: ["10.000"], assigned_class_id: "pro" },
    { id: "b", name: "Ben", laps: ["11.000"], assigned_class_id: "am" },
    { id: "c", name: "Cal", laps: ["9.000"], assigned_class_id: "pro" },
  ])).entries()].map(([cls, rows]) => [cls, rows.map(r => r.name)]),
  [["pro", ["Cal", "Ana"]], ["am", ["Ben"]]]);

// ── 5. Roster generation ──────────────────────────────────────────────────
const placed = [
  { id: "1", name: "Ana", driver_id: "drv-ana", assigned_class_id: "pro" },
  { id: "2", name: "Ben", driver_id: "drv-ben", assigned_class_id: "am" },
  { id: "3", name: "Cal", assigned_class_id: "" },
];
const roster = [
  { id: "e1", name: "Ana", driver_id: "drv-ana", class_id: "am" },
];
const plan = planRosterBuild(placed, roster, { requireClass: true });
check("a driver already on the roster is moved, not duplicated",
  plan.update, [{ id: "e1", name: "Ana", class_id: "pro", class_ids: ["pro"] }]);
check("a new driver joins in the division they were placed in",
  plan.create.map(c => [c.name, c.class_id]), [["Ben", "am"]]);
check("an unplaced driver is left alone on a placement night",
  plan.skipped.map(s => s.name), ["Cal"]);
// Who now has a roster spot, which is the question the Placements Queue asks
// when it decides who to stop waiting for — not "who was written".
check("everyone the run puts on a roster is reported",
  plan.placed.map(r => r.name), ["Ana", "Ben"]);
check("and the driver it left alone is not",
  plan.placed.some(r => r.name === "Cal"), false);

check("re-running writes nothing the second time",
  planRosterBuild(placed, [
    { id: "e1", name: "Ana", driver_id: "drv-ana", class_id: "pro" },
    { id: "e2", name: "Ben", driver_id: "drv-ben", class_id: "am" },
  ], { requireClass: true }),
  { create: [], update: [], skipped: [
    { name: "Ana", reason: "already in that class" },
    { name: "Ben", reason: "already in that class" },
    { name: "Cal", reason: "no class assigned" },
  // Writing nothing is not the same as placing nobody: Ana and Ben end this run
  // on the roster, in the division the trial put them in, and that is what the
  // Placements Queue clears against (see lib/placementQueue.js).
  ], placed: [placed[0], placed[1]] });

check("an ordinary trial can still push its field on unclassified",
  planRosterBuild([{ id: "3", name: "Cal" }], []).create.map(c => [c.name, c.class_id]),
  [["Cal", ""]]);
check("the same person twice on one sheet is one roster change",
  planRosterBuild([
    { id: "1", name: "Ana", driver_id: "drv-ana", assigned_class_id: "pro" },
    { id: "2", name: "Ana", driver_id: "drv-ana", assigned_class_id: "am" },
  ], []).create.length, 1);
check("a nameless row can't become a roster spot",
  planRosterBuild([{ id: "x" }], []).skipped, [{ name: "", reason: "no name" }]);
check("a driver on the roster under a series alias still matches by account",
  planRosterBuild(
    [{ id: "1", name: "Ana", user_id: "u1", assigned_class_id: "pro" }],
    [{ id: "e1", name: "AnaRacer", user_id: "u1", class_id: "" }],
  ).update, [{ id: "e1", name: "AnaRacer", class_id: "pro", class_ids: ["pro"] }]);

// ── 5b. A whole roster run ────────────────────────────────────────────────
//
// planRosterRun is the layer the "Complete Session" dialog draws its preview
// from AND the plan it posts, so this covers the part planRosterBuild doesn't:
// which seasons are targets at all, and what happens when a row has no roster
// to go to. A league whose divisions are SERIES builds several rosters in one
// run, and each is planned against its own season's entries — planning them
// against a single pooled roster would "move" a driver between seasons that
// never shared one.
const runTrial = {
  is_placement: true,
  class_ids: ["pro", "am"],
  series_seasons: { "ser-pro": "s-pro" },
};
const runRows = [
  { id: "r1", name: "Ana", driver_id: "drv-ana", assigned_class_id: "pro" },
  { id: "r2", name: "Ben", driver_id: "drv-ben", assigned_class_id: "am" },
  { id: "r3", name: "Cal", driver_id: "drv-cal", assigned_series_id: "ser-pro" },
  { id: "r4", name: "Dee", assigned_class_id: "" },
];
const run = planRosterRun({
  trial: runTrial,
  rows: runRows,
  trialSeasonId: "s-main",
  seasonBySeries: runTrial.series_seasons,
  seasonNameById: { "s-main": "Main Season", "s-pro": "Pro Season" },
  existingBySeason: {
    "s-main": [{ id: "e-ana", name: "Ana", driver_id: "drv-ana", class_id: "am" }],
    "s-pro": [],
  },
});
check("a series placement builds its own season's roster, not the trial's",
  run.seasons.map(p => [p.season_id, p.season_name]),
  [["s-main", "Main Season"], ["s-pro", "Pro Season"]]);
check("each roster is planned against its OWN season's entries",
  run.seasons.map(p => [p.create.map(c => c.name), p.update.map(u => u.id)]),
  [[["Ben"], ["e-ana"]], [["Cal"], []]]);
check("the totals add the rosters up", [run.created, run.updated], [2, 1]);
// A driver sorted into a SERIES has been placed — the series is their division
// — so they need no class. One left with neither is the only one skipped.
check("only the driver with no division at all is left alone",
  run.skipped.map(s => [s.name, s.reason]), [["Dee", "no class assigned"]]);

// A row placed into a series that names no season, on a trial with no season of
// its own, has nowhere to go. It is reported, never written.
const homeless = planRosterRun({
  trial: { is_placement: true, class_ids: ["pro"] },
  rows: [{ id: "r1", name: "Ana", assigned_series_id: "ser-none", assigned_class_id: "pro" }],
  trialSeasonId: "",
  seasonBySeries: {},
  existingBySeason: {},
});
check("with no season anywhere, the run refuses and says which question to answer",
  homeless.error, "Pick the season whose roster this should build.");
check("…and a trial that HAS a season but no rows bound for one says so instead",
  planRosterRun({ trial: {}, rows: [], trialSeasonId: "s-main", existingBySeason: {} }).error,
  "Nobody on this sheet has a roster to go to yet.");
// The trial's own season is the fallback for anyone a series can't place, so a
// row is only homeless when there is no trial season EITHER — the case a
// placement night run before its season exists actually hits.
check("with the trial's season set, a series that names none still lands there",
  planRosterRun({
    trial: { is_placement: true, class_ids: ["pro"] },
    rows: [{ id: "r2", name: "Zed", assigned_series_id: "ser-none", assigned_class_id: "pro" }],
    trialSeasonId: "s-main",
    seasonBySeries: {},
    existingBySeason: { "s-main": [] },
  }).seasons.map(p => [p.season_id, p.create.map(c => c.name)]),
  [["s-main", ["Zed"]]]);
check("a row bound nowhere is reported alongside the rosters that did build",
  planRosterRun({
    trial: { is_placement: true, class_ids: ["pro"] },
    rows: [
      { id: "r1", name: "Ana", assigned_series_id: "ser-pro", assigned_class_id: "pro" },
      { id: "r2", name: "Zed", assigned_series_id: "ser-none", assigned_class_id: "pro" },
    ],
    trialSeasonId: "",
    seasonBySeries: { "ser-pro": "s-pro" },
    existingBySeason: { "s-pro": [] },
  }).skipped,
  [{ name: "Zed", reason: "no season to place them in" }]);

// ── 6. Export to Qualifying ───────────────────────────────────────────────
const index = entryIndex([
  { id: "e-ana", name: "Ana", driver_id: "drv-ana" },
  { id: "e-ben", name: "Ben" },
]);
check("a roster entry is found by driver id", matchEntry({ driver_id: "drv-ana" }, index).id, "e-ana");
check("…or by name when there is no id", matchEntry({ name: "ben" }, index).id, "e-ben");
check("a near miss is a different person", matchEntry({ name: "Benny" }, index), null);

const exported = planQualifyingExport(
  summarizeEntries([
    { id: "a", name: "Ana", driver_id: "drv-ana", laps: ["1:30.000", "1:28.000"] },
    { id: "b", name: "Ben", laps: ["1:27.500"] },
    { id: "c", name: "Cal", laps: ["1:20.000"] },
    { id: "d", name: "Dee", laps: [] },
  ]),
  row => matchEntry(row, index)?.id || "",
);
check("pole goes to the fastest lap on the roster",
  exported.grid.map(g => [g.finish_pos, g.entry_id, g.qual_time]),
  [[1, "e-ben", "1:27.500"], [2, "e-ana", "1:28.000"]]);
check("a driver the roster doesn't have is named, not dropped silently",
  exported.unmatched, ["Cal"]);
check("a driver with no lap is left off the grid entirely",
  exported.grid.some(g => g.name === "Dee"), false);

const byAverage = planQualifyingExport(
  summarizeEntries([
    { id: "a", name: "Ana", driver_id: "drv-ana", laps: ["1:28.000", "1:28.000"] },
    { id: "b", name: "Ben", laps: ["1:27.500", "1:40.000"] },
  ]),
  row => matchEntry(row, index)?.id || "",
  { key: "average" },
);
check("ordering by average changes who's on pole",
  byAverage.grid.map(g => g.entry_id), ["e-ana", "e-ben"]);
check("…but the lap filed is still the driver's fastest of the session",
  byAverage.grid.map(g => g.fastest_lap_time), ["1:28.000", "1:27.500"]);

// A trial with no laps at all exports nothing rather than an empty grid of
// names — there is no qualifying order to be had.
check("nobody has run, so there is no grid",
  planQualifyingExport(summarizeEntries([{ id: "a", name: "Ana", laps: [] }]), () => "e1").grid, []);

// ── 7. Series placement ───────────────────────────────────────────────────
//
// Plenty of leagues run their divisions as separate SERIES rather than as
// classes inside one season. The split itself is the same even split; what
// changes is where the roster lands, because a roster belongs to a season.
const seriesSheet = summarizeEntries([
  { id: "a", name: "Ana", driver_id: "drv-ana", laps: ["10.000"] },
  { id: "b", name: "Ben", driver_id: "drv-ben", laps: ["11.000"] },
  { id: "c", name: "Cal", driver_id: "drv-cal", laps: ["12.000"] },
  { id: "d", name: "Dee", driver_id: "drv-dee", laps: ["13.000"] },
]);

check("the field splits into series exactly as it splits into classes",
  autoAssignSeries(seriesSheet, ["pro-series", "am-series"]),
  { a: "pro-series", b: "pro-series", c: "am-series", d: "am-series" });
check("classes and series share one split", splitEvenly(seriesSheet, ["x", "y"]),
  autoAssignSeries(seriesSheet, ["x", "y"]));

// A series decides which season's roster a driver joins, so it decides which
// classes they may be given: divisions split WITHIN each series, over that
// series' own drivers and its own season's classes.
const placedIntoSeries = seriesSheet.map(r => ({
  ...r, assigned_series_id: ["a", "b"].includes(r.id) ? "pro-series" : "am-series",
}));
check("divisions split inside each series, not across the whole field",
  autoAssignClassesWithinSeries(placedIntoSeries, sid => ({
    "pro-series": ["pro-1", "pro-2"],
    "am-series": ["am-1", "am-2"],
  }[sid] || [])),
  { a: "pro-1", b: "pro-2", c: "am-1", d: "am-2" });
check("a series with no divisions of its own simply places nobody",
  autoAssignClassesWithinSeries(placedIntoSeries, sid => (sid === "pro-series" ? ["pro-1"] : [])),
  { a: "pro-1", b: "pro-1" });

// Where each row's roster entry is written.
const routing = { trialSeasonId: "s-open", seasonBySeries: { "pro-series": "s-pro", "am-series": "s-am" } };
check("a driver placed into a series joins that series' season",
  targetSeasonFor({ assigned_series_id: "pro-series" }, routing), "s-pro");
check("everyone else joins the trial's own season",
  targetSeasonFor({}, routing), "s-open");
check("a series naming no season leaves the driver nowhere",
  targetSeasonFor({ assigned_series_id: "ghost" }, { seasonBySeries: {} }), "");
check("one run builds one roster per target season",
  [...groupByTargetSeason(placedIntoSeries, routing).entries()]
    .map(([seasonId, group]) => [seasonId, group.map(r => r.name)]),
  [["s-pro", ["Ana", "Ben"]], ["s-am", ["Cal", "Dee"]]]);

// Being placed into a series IS a placement — the series is the division — so
// such a driver joins its roster whether or not they also drew a class inside
// it. On a class-only night an unplaced driver is still left alone.
const requireClass = row => !row.assigned_series_id;
check("a series placement with no class still builds a roster spot",
  planRosterBuild(
    [{ id: "1", name: "Ana", driver_id: "drv-ana", assigned_series_id: "pro-series" }],
    [], { requireClass },
  ).create.map(c => [c.name, c.class_id]),
  [["Ana", ""]]);
check("…while a driver placed into nothing at all is still left alone",
  planRosterBuild([{ id: "2", name: "Ben", driver_id: "drv-ben" }], [], { requireClass }).skipped,
  [{ name: "Ben", reason: "no class assigned" }]);
check("a boolean rule still works for every row, as before",
  planRosterBuild([{ id: "2", name: "Ben" }], [], { requireClass: true }).skipped,
  [{ name: "Ben", reason: "no class assigned" }]);

// A driver already on the series' roster is moved into their new division
// there, matched against THAT season's entries rather than another season's.
check("the plan is made against the roster the driver is actually joining",
  planRosterBuild(
    [{ id: "1", name: "Ana", driver_id: "drv-ana", assigned_series_id: "pro-series", assigned_class_id: "pro-1" }],
    [{ id: "e-pro", name: "Ana", driver_id: "drv-ana", class_id: "pro-2" }],
    { requireClass },
  ).update,
  [{ id: "e-pro", name: "Ana", class_id: "pro-1", class_ids: ["pro-1"] }]);

// ── 8. Which sessions the hub shows ───────────────────────────────────────
//
// A trial is not a race. A placement night routinely predates the season it
// feeds, and a night sorting into several series belongs to all of them — so
// "names nothing at this level" has to read as in-scope, or the hub hides the
// very sessions the feature exists for.
const attached = { game_id: "g1", series_id: "s1", season_id: "sn1" };
const floating = { name: "Placement Night" };

check("an attached trial shows in its own scope",
  trialMatchesScope(attached, { gameId: "g1", seriesId: "s1", seasonId: "sn1" }), true);
check("…and not in another series'",
  trialMatchesScope(attached, { gameId: "g1", seriesId: "s2" }), false);
check("…and not in another season's",
  trialMatchesScope(attached, { seasonId: "sn2" }), false);
check("a free-floating placement night is never hidden by a scope",
  trialMatchesScope(floating, { gameId: "g1", seriesId: "s1", seasonId: "sn1" }), true);
check("a trial with no season still shows inside a season",
  trialMatchesScope({ game_id: "g1", series_id: "s1" }, { gameId: "g1", seasonId: "sn9" }), true);
check("no scope at all shows everything", trialMatchesScope(attached, {}), true);

// A night placing into several series belongs to each of them, and to each
// season those build rosters in — not only to the one it was created under.
const multi = {
  game_id: "g1", series_id: "s1", season_id: "sn1",
  series_ids: ["pro", "am"],
  series_seasons: { pro: "sn-pro", am: "sn-am" },
};
check("a placement night shows under a series it places into",
  trialMatchesScope(multi, { seriesId: "pro" }), true);
check("…and under the season that series builds",
  trialMatchesScope(multi, { seasonId: "sn-am" }), true);
check("…and still under the series it was created in",
  trialMatchesScope(multi, { seriesId: "s1" }), true);
check("…but not under a series it has nothing to do with",
  trialMatchesScope(multi, { seriesId: "gt" }), false);

// summarizeEntry leaves the row it was given intact apart from its own columns,
// so the sheet can carry whatever else it needs (division, notes, ids).
check("the summary decorates rather than replaces",
  summarizeEntry({ id: "a", name: "Ana", assigned_class_id: "pro", laps: ["10.000"] }).assigned_class_id, "pro");
check("…including the series a driver was placed into",
  summarizeEntry({ id: "a", name: "Ana", assigned_series_id: "pro-series", laps: ["10.000"] }).assigned_series_id,
  "pro-series");

console.log(`timeTrials: ${n} checks passed`);
