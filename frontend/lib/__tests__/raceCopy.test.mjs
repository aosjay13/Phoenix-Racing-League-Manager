// Copying a race into another season is a translation, not a duplication: a
// result points at a roster entry, and roster entries — like classes — belong to
// exactly one season. The invariants that matter:
//
//   1. a driver's results land on THAT driver in the target season, however
//      they're identified there (driver profile, linked account, or name);
//   2. what the race scored survives the trip intact — every session, position,
//      time, flag and points template;
//   3. nothing carries an id that means something different in the new season:
//      classes are re-matched by name, and anything unmatched degrades to
//      unclassified rather than landing in the wrong championship;
//   4. derived numbers (Skill Rating, Strength of Field) are never copied —
//      they're replayed from the target game's own timeline.
import assert from "node:assert/strict";
import {
  COPIED_RACE_FIELDS, COPIED_RESULT_FIELDS,
  copyRaceDoc, copyResultDocs, mapClassId, mapClassesByName,
  newEntryForDriver, nextRoundNumber, planEntryMap,
} from "../raceCopy.js";
import { UNCLASSIFIED } from "../classFilter.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Classes are matched by name, not id ────────────────────────────────

const srcClasses = [
  { id: "s-pro", name: "Pro" },
  { id: "s-am", name: "Amateur" },
  { id: "s-truck", name: "Trucks" },
];
const tgtClasses = [
  { id: "t-am", name: "amateur" },   // same class, different case + id
  { id: "t-pro", name: "Pro " },     // …and stray whitespace
];
const classMap = mapClassesByName(srcClasses, tgtClasses);

check("Pro maps to the target season's Pro", classMap["s-pro"], "t-pro");
check("class names match case- and space-insensitively", classMap["s-am"], "t-am");
check("a class the target doesn't run maps to nothing", classMap["s-truck"], undefined);
check("an unmapped class id becomes unclassified", mapClassId("s-truck", classMap), "");
check("a blank class stays blank", mapClassId("", classMap), "");
check("no classes either side is simply an empty map", mapClassesByName([], []), {});

// ── 2. Drivers are matched the way the rest of the app matches them ───────

const sourceEntries = [
  { id: "s1", name: "Ana Diaz", number: "7", driver_id: "dA" },
  { id: "s2", name: "Bo Chen", driver_id: "dB", user_id: "uB" },
  { id: "s3", name: "Cyd Okafor", number: "44" },            // name-only match
  { id: "s4", name: "Dee Novak", number: "3", driver_id: "dD" }, // not on the target roster
  { id: "s5", name: "", number: "" },                        // no identity at all
];
const targetEntries = [
  { id: "t1", name: "A. Diaz", driver_id: "dA" },     // same profile, different name
  { id: "t2", name: "Bo Chen Jr", user_id: "uB" },    // same linked account
  { id: "t3", name: "cyd okafor" },                   // same name, different case
];
const { map: entryMap, missing } = planEntryMap(sourceEntries, targetEntries);

check("matched by global driver profile", entryMap.s1, "t1");
check("matched by linked account when the name changed", entryMap.s2, "t2");
check("matched by name when that's all there is", entryMap.s3, "t3");
check("a driver not on the target roster is reported, not mapped", entryMap.s4, undefined);
check("…and comes back as missing", missing.map(e => e.id), ["s4"]);
ok("an entry with no name and no identity is neither mapped nor creatable",
  !entryMap.s5 && !missing.some(e => e.id === "s5"));

// Two source entries for one person (the pre-multi-class duplicate rosters)
// both resolve to the single target entry rather than one of them going missing.
const dupes = planEntryMap(
  [{ id: "sA", name: "Ana Diaz", driver_id: "dA" }, { id: "sB", name: "Ana Diaz", driver_id: "dA" }],
  [{ id: "tA", name: "Ana Diaz", driver_id: "dA" }]
);
check("duplicate source entries both map to the one target entry",
  [dupes.map.sA, dupes.map.sB, dupes.missing.length], ["tA", "tA", 0]);

// A driver being added to the target roster keeps their identity and number,
// gains the TRANSLATED classes, and never carries a team from the old season.
const created = newEntryForDriver(
  { id: "s4", name: "Dee Novak", number: "03", driver_id: "dD", team_id: "old-team", class_id: "s-pro" },
  ["t-pro"]
);
check("a created driver keeps name, number and profile",
  [created.name, created.number, created.driver_id], ["Dee Novak", "03", "dD"]);
check("leading zeros on a car number survive", created.number, "03");
check("classes carry over already translated", [created.class_id, created.class_ids], ["t-pro", ["t-pro"]]);
check("the old season's team never comes with them", created.team_id, "");
check("a driver whose class didn't map arrives unclassified",
  newEntryForDriver({ id: "s9", name: "Eli Ray" }, []).class_id, "");

// ── 3. The race document ─────────────────────────────────────────────────

const race = {
  id: "r1", season_id: "old", round_number: 4,
  name: "Daytona Duel", track: "Daytona", track_id: "trk1", date: "2024-02-18",
  car: "Next Gen", sessions: ["Race"], length_type: "laps", total_laps: 100,
  heat_format: true, heats: ["Heat 1", "Heat 2"], consolations: ["B-Main"], feature_name: "A-Main Feature",
  session_points: { Race: "tpl-race" },
  heat_points_template_id: "tpl-heat", consolation_points_template_id: "tpl-bmain",
  session_points_by_class: { "s-pro": { Race: "tpl-pro" }, "s-truck": { Race: "tpl-truck" }, [UNCLASSIFIED]: { Race: "tpl-none" } },
  session_stats: { "Heat 1": false },
  class_id: "s-pro",
  strength_of_field: 1720,
  created_at: "2024-01-01", created_by: "admin1", league_id: "lg1",
};
const copied = copyRaceDoc(race, {
  season_id: "new", round_number: 9, class_id: mapClassId(race.class_id, classMap), classMap,
});

check("the copy belongs to the target season", copied.season_id, "new");
check("…on the round it was given", copied.round_number, 9);
check("the event itself carries over", [copied.name, copied.track, copied.total_laps], ["Daytona Duel", "Daytona", 100]);
check("heat-racing structure carries over",
  [copied.heat_format, copied.heats, copied.consolations], [true, ["Heat 1", "Heat 2"], ["B-Main"]]);
check("per-session points systems carry over (templates are global)", copied.session_points, { Race: "tpl-race" });
check("the event's heat / consolation default templates carry over",
  [copied.heat_points_template_id, copied.consolation_points_template_id], ["tpl-heat", "tpl-bmain"]);
check("a class-pinned round follows its class by name", copied.class_id, "t-pro");
check("per-class points systems are re-keyed to the target's class ids",
  copied.session_points_by_class, { "t-pro": { Race: "tpl-pro" }, [UNCLASSIFIED]: { Race: "tpl-none" } });
ok("Strength of Field is never copied — it describes the old season's field",
  copied.strength_of_field === undefined && !COPIED_RACE_FIELDS.includes("strength_of_field"));
ok("audit fields are not copied", copied.created_at === undefined && copied.created_by === undefined && copied.league_id === undefined);
ok("the source's own ids are not copied", copied.id === undefined);

check("a rename overrides the copied name", copyRaceDoc(race, { season_id: "new", round_number: 1, name: " Rematch " }).name, "Rematch");
check("a blank rename keeps the original", copyRaceDoc(race, { season_id: "new", round_number: 1, name: "  " }).name, "Daytona Duel");
check("a new date overrides the original", copyRaceDoc(race, { season_id: "new", round_number: 1, date: "2025-02-16" }).date, "2025-02-16");
check("no new date keeps the original", copyRaceDoc(race, { season_id: "new", round_number: 1 }).date, "2024-02-18");
// A race date is a bare calendar date in every timezone — a legacy timestamp on
// the source is normalized rather than carried, so the copy can't display a day
// early out west (see lib/raceDate.js).
check("a legacy timestamp date is stored as a bare calendar date",
  copyRaceDoc({ ...race, date: "2024-02-18T00:00:00.000Z" }, { season_id: "new", round_number: 1 }).date, "2024-02-18");
check("a re-date is normalized the same way",
  copyRaceDoc(race, { season_id: "new", round_number: 1, date: "2025-02-16T12:00:00Z" }).date, "2025-02-16");
ok("a dateless race stays dateless",
  copyRaceDoc({ ...race, date: undefined }, { season_id: "new", round_number: 1 }).date === undefined);
check("a round pinned to an unrunnable class becomes a shared round",
  copyRaceDoc(race, { season_id: "new", round_number: 1, class_id: mapClassId("s-truck", classMap), classMap }).class_id, "");
ok("a per-class points map with nothing left to key on is dropped entirely",
  copyRaceDoc({ ...race, session_points_by_class: { "s-truck": { Race: "t" } } },
    { season_id: "new", round_number: 1, classMap }).session_points_by_class === undefined);

check("a copy lands one past the target season's last round",
  nextRoundNumber([{ round_number: 3 }, { round_number: 11 }, { round_number: "7" }]), 12);
check("…and opens an empty season at round 1", nextRoundNumber([]), 1);

// ── 4. The results ───────────────────────────────────────────────────────

const results = [
  {
    id: "res1", race_id: "r1", season_id: "old", entry_id: "s1", class_id: "s-pro",
    session: "A-Main Feature", session_type: "feature", finish_pos: 1, start_pos: 3,
    race_time: "1:32:04.221", interval: null, qual_time: "0:48.113", fastest_lap_time: "0:47.902",
    laps: 100, laps_led: 62, incidents: 2,
    fastest_lap: true, halfway_leader: true, hard_charger: false, most_laps_led: true,
    provisional: false, manual_points: null, points_adjustment: -5, bonus_points: 0, penalty_points: 0,
    status: "finished", points_template_id: "tpl-race",
    takedowns: 3, survival_bonus: true, most_lethal: true,
    sr_delta: 14.2, created_at: "2024-02-19", created_by: "admin1",
  },
  // A provisional entry — points only, no finishing stats.
  { id: "res2", race_id: "r1", season_id: "old", entry_id: "s2", class_id: "s-am", session: "A-Main Feature", session_type: "feature", finish_pos: 21, provisional: true, manual_points: 12, status: "finished" },
  // Raced in a class the target season doesn't run.
  { id: "res3", race_id: "r1", season_id: "old", entry_id: "s3", class_id: "s-truck", session: "A-Main Feature", session_type: "feature", finish_pos: 5 },
  // A driver who isn't on the target roster and wasn't created.
  { id: "res4", race_id: "r1", season_id: "old", entry_id: "s4", class_id: "s-pro", session: "A-Main Feature", session_type: "feature", finish_pos: 8 },
];
const { rows, skipped } = copyResultDocs(results, {
  race_id: "newRace", season_id: "new", entryMap, classMap,
});

check("only the drivers that mapped are written", rows.length, 3);
check("the rest are reported so the admin can be told who", skipped.map(r => r.entry_id), ["s4"]);
check("each row points at the new race and season",
  [...new Set(rows.map(r => `${r.race_id}/${r.season_id}`))], ["newRace/new"]);
check("results follow their driver to the target season's entry", rows[0].entry_id, "t1");
check("…and their class to the target season's class", rows[0].class_id, "t-pro");
check("a class the target doesn't run copies over unclassified", rows[2].class_id, "");

check("the whole result carries over intact", {
  session: rows[0].session, session_type: rows[0].session_type,
  finish_pos: rows[0].finish_pos, start_pos: rows[0].start_pos,
  race_time: rows[0].race_time, qual_time: rows[0].qual_time, fastest_lap_time: rows[0].fastest_lap_time,
  laps: rows[0].laps, laps_led: rows[0].laps_led, incidents: rows[0].incidents,
  fastest_lap: rows[0].fastest_lap, halfway_leader: rows[0].halfway_leader, most_laps_led: rows[0].most_laps_led,
  points_adjustment: rows[0].points_adjustment, points_template_id: rows[0].points_template_id,
  status: rows[0].status,
}, {
  session: "A-Main Feature", session_type: "feature",
  finish_pos: 1, start_pos: 3,
  race_time: "1:32:04.221", qual_time: "0:48.113", fastest_lap_time: "0:47.902",
  laps: 100, laps_led: 62, incidents: 2,
  fastest_lap: true, halfway_leader: true, most_laps_led: true,
  points_adjustment: -5, points_template_id: "tpl-race",
  status: "finished",
});
check("derby stats carry over",
  [rows[0].takedowns, rows[0].survival_bonus, rows[0].most_lethal], [3, true, true]);
check("a provisional entry stays provisional, on its own flat points",
  [rows[1].provisional, rows[1].manual_points], [true, 12]);
ok("Skill Rating deltas are never copied — the target game replays its own",
  rows[0].sr_delta === undefined && !COPIED_RESULT_FIELDS.includes("sr_delta"));
ok("the source's own id and audit fields are not copied",
  rows[0].id === undefined && rows[0].created_at === undefined && rows[0].created_by === undefined);

// Copying the event without its results is a legitimate, empty copy.
check("no results in means no rows out", copyResultDocs([], { race_id: "x", season_id: "y" }).rows, []);
// With nobody mapped, every result is reported rather than silently vanishing.
check("an unmatched roster skips every result rather than losing it",
  copyResultDocs(results, { race_id: "x", season_id: "y", entryMap: {} }).skipped.length, results.length);

console.log(`all ${n} checks passed — a copied race lands on the right drivers, classes and season`);
