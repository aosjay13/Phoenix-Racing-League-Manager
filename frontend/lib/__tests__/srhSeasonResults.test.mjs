// A season's results, imported in one press.
//
// The single-race importer hands a statistician a table and lets them decide:
// which grid this session belongs in, which roster place that name is, whether
// this row is a finisher or a driver who was simply paid. A whole-season import
// has nobody to ask. It makes those same decisions sixty times over without
// stopping, and a season is either right afterwards or wrong in a way that only
// shows up in a championship table weeks later.
//
// So this covers the decisions themselves:
//
//   1. WHERE EACH SESSION GOES. SimRacerHub's second heat is this event's
//      second heat; its consolation is the consolation; its feature is the
//      A-Main. A session the event doesn't have yet is added under
//      SimRacerHub's own name for it, and an event that never ran heats is not
//      turned into a heat weekend because a league capitalises "FEATURE".
//   2. WHO EACH DRIVER IS. Matched against every name a driver answers to, and
//      a name that matches nobody is LEFT OUT and reported — never guessed at,
//      and never silently dropped.
//   3. WHAT A ROW BECOMES. A provisional entry carries flat points and no
//      finishing position; a finisher carries its numbers and, in the Adj
//      column, only the part of SimRacerHub's points this app cannot work out
//      for itself. The league's own structure still pays for the position.
//   4. THE FLAGS. Hard Charger and Most Laps Led are derived from the numbers
//      exactly as the grid derives them while an admin types, so a session
//      imported in bulk scores identically to the same session entered by hand.
//   5. THE LINKS. One season link fills in a link per round, paired by round
//      number where the numbering agrees and down the page where it doesn't.
//   6. THE PEOPLE THE ROSTER HASN'T GOT. The same driver missing from nine
//      rounds is ONE person to put right, not nine warnings — and which rounds
//      they were missing from is what says which rounds to run again. Answering
//      one opens the next, so the list gets WORKED rather than displayed, and
//      "which one is next" has to be right or the run stalls or loops.
import assert from "node:assert";
import { parseSrhPage, srhSegmentTable } from "../srhImport.js";
import {
  matchScheduleToRaces, nextUnanswered, planRace, planSessions, sessionRows, unmatchedRoster,
} from "../srhSeasonResults.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// A session as parseSrhPage yields one, which is all planSessions reads.
const seg = (key, name, type, driver_count = 10) => ({ key, name, type, driver_count });

// ── 1. Where each session goes ─────────────────────────────────────────────

// A heat night on an event that has never been told it is one. Everything on
// the page has somewhere to go, and the event grows the sessions to hold it.
const heatNight = planSessions({}, [
  seg("p", "Practice", "practice"),
  seg("q", "Qualifying", "qualifying"),
  seg("h1", "Heat 1", "heat"),
  seg("h2", "Heat 2", "heat"),
  seg("b", "B-Main", "consolation"),
  seg("f", "Feature", "feature"),
]);
check("practice is not a session this app keeps", heatNight.sessions.map(s => s.srh_name).includes("Practice"), false);
check("every other session lands somewhere", heatNight.sessions.map(s => s.session),
  ["Qualifying", "Heat 1", "Heat 2", "B-Main", "A-Main Feature"]);
check("…in the grid of its own kind", heatNight.sessions.map(s => s.session_type),
  ["qualifying", "heat", "heat", "consolation", "feature"]);
check("the event is switched into heat format to hold them", heatNight.race_update.heat_format, true);
check("…gaining the heats it ran", heatNight.race_update.heats, ["Heat 1", "Heat 2"]);
check("…and the consolation", heatNight.race_update.consolations, ["B-Main"]);
check("…under a feature it can be told apart by", heatNight.race_update.feature_name, "A-Main Feature");
check("and it says which of them are new", heatNight.sessions.filter(s => s.new).map(s => s.session),
  ["Heat 1", "Heat 2", "B-Main"]);

// The same night on an event that already runs heats, and calls them something
// of its own. A league's names are what its drivers call the sessions, so they
// are kept: SimRacerHub's second heat is this event's second heat whatever
// either of them calls it.
const named = planSessions(
  { heat_format: true, heats: ["Dash A", "Dash B"], consolations: ["Last Chance"], feature_name: "The 50" },
  [seg("h1", "Heat 1", "heat"), seg("h2", "Heat 2", "heat"), seg("b", "Consolation", "consolation"), seg("f", "Feature", "feature")],
);
check("an event's own session names are kept", named.sessions.map(s => s.session),
  ["Dash A", "Dash B", "Last Chance", "The 50"]);
check("…and nothing is written to it", named.race_update, null);
check("…because none of them are new", named.sessions.some(s => s.new), false);

// A third heat on an event that declares two: the two it has, plus one named
// after what SimRacerHub calls it.
const extraHeat = planSessions(
  { heat_format: true, heats: ["Heat 1", "Heat 2"], feature_name: "A-Main Feature" },
  [seg("h1", "Heat 1", "heat"), seg("h2", "Heat 2", "heat"), seg("h3", "Heat 3", "heat"), seg("f", "Feature", "feature")],
);
check("a heat the event doesn't have yet is added", extraHeat.race_update.heats, ["Heat 1", "Heat 2", "Heat 3"]);
check("…under SimRacerHub's own name for it", extraHeat.sessions.filter(s => s.new).map(s => s.session), ["Heat 3"]);
check("…and the event is not switched into a format it is already in", "heat_format" in extraHeat.race_update, false);

// A league that simply calls its one race "FEATURE". Turning that into a heat
// weekend would put a tab in front of every session of the event for a
// structure it never ran.
const plainNight = planSessions({}, [seg("q", "Qualifying", "qualifying"), seg("f", "Feature", "feature")]);
check("a lone feature is the event's Race", plainNight.sessions.map(s => [s.session, s.session_type]),
  [["Qualifying", "qualifying"], ["Race", "race"]]);
check("…and the event is left a plain one", plainNight.race_update, null);
check("…which it is", plainNight.heat_night, false);

// Two races on one card, on an event that only declares one.
const twoRaces = planSessions({ sessions: ["Race"] }, [seg("r1", "Race 1", "race"), seg("r2", "Race 2", "race")]);
check("a second race is added to the event's sessions", twoRaces.race_update.sessions, ["Race", "Race 2"]);
check("…with the first still in the session it has", twoRaces.sessions.map(s => s.session), ["Race", "Race 2"]);

// An event already in heat format keeps its structure even when the page shows
// one race: a feature dropped into a standard Race session would be stored
// somewhere the results screen has no tab for.
const heatFormatOneRace = planSessions(
  { heat_format: true, heats: ["Heat 1"], feature_name: "A-Main Feature" },
  [seg("f", "Feature", "feature")],
);
check("a heat-format event's race is still its feature", heatFormatOneRace.sessions.map(s => s.session), ["A-Main Feature"]);

// One grid each. A page with two of something the event holds one of imports
// the first and says why the other went nowhere, rather than overwriting one
// with the other.
const twoQuals = planSessions({}, [seg("q1", "Qualifying", "qualifying"), seg("q2", "Qualifying 2", "qualifying")]);
check("the second qualifying session is not imported over the first", twoQuals.sessions.map(s => s.srh_name), ["Qualifying"]);
check("…and is reported", twoQuals.skipped.map(s => s.srh_name), ["Qualifying 2"]);
ok("…with a reason an admin can act on", /one Qualifying grid/.test(twoQuals.skipped[0].reason));

// A name the event already uses is not silently reused for a different session.
const clash = planSessions(
  { heat_format: true, heats: ["Heat 1"], consolations: [] },
  [seg("h1", "Heat 1", "heat"), seg("h2", "Heat 1", "heat")],
);
check("a second session named the same gets a name of its own", clash.race_update.heats, ["Heat 1", "Heat 1 2"]);

check("a page with nothing on it plans nothing", planSessions({}, []).sessions, []);

// ── 2 & 3. Who each driver is, and what their row becomes ──────────────────

// A feature: a winner, a car a lap down, and a driver SimRacerHub paid without
// them racing.
const featureSeg = {
  type: "feature",
  drivers: {},
  results: [
    { race_participant_id: "1", race_id: "9003", driver_id: "11", driver_number: "23", qualify_pos: "9", qualify_time: "90.2236", num_laps: "14", laps_led: "10", finish_pos: "1", status: "Running", intv: "0", intv_str: "-", fastest_lap_time: "90.3687", incidents: "6", provisional: "N", elapsed_time: "12864949", tpts: 75, name: "Anderson, Nathan" },
    { race_participant_id: "2", race_id: "9003", driver_id: "12", driver_number: "909", qualify_pos: "1", qualify_time: "89.8022", num_laps: "13", laps_led: "4", finish_pos: "2", status: "Running", intv: 9999.0001, intv_str: "-1L", fastest_lap_time: "89.6849", incidents: "0", provisional: "N", elapsed_time: "12866653", tpts: 70, name: "Rose, Mia" },
    { race_participant_id: "3", race_id: "9003", driver_id: "13", driver_number: "", qualify_pos: "0", qualify_time: "0", num_laps: "0", laps_led: "0", finish_pos: "", status: "Provisional", intv_str: "-120L", fastest_lap_time: "0", incidents: "0", provisional: "Y", tpts: 10, name: "Burchett, Brian" },
    { race_participant_id: "4", race_id: "9003", driver_id: "14", driver_number: "7", qualify_pos: "3", qualify_time: "91.5", num_laps: "14", laps_led: "0", finish_pos: "3", status: "Running", intv_str: "-2.100", fastest_lap_time: "91.9", incidents: "2", provisional: "N", elapsed_time: "12900000", tpts: 65, name: "Nobody, Aname" },
  ],
};
const roster = [
  { id: "eA", name: "Nathan Anderson", aliases: ["N Anderson"] },
  { id: "eB", name: "Mia Rose", aliases: [] },
  { id: "eC", name: "Brian Burchett", aliases: [] },
];

const built = sessionRows(srhSegmentTable(featureSeg), roster, { sessionType: "feature" });
check("a name nobody on the roster answers to is left out", built.unmatched, ["Aname Nobody"]);
check("…and everyone else is imported", built.rows.length, 3);

const winner = built.rows.find(r => r.entry_id === "eA");
check("the winner is matched by the name they race under", winner.finish_pos, 1);
check("…with the grid they started from", winner.start_pos, 9);
check("…their laps", [winner.laps, winner.laps_led], [14, 10]);
check("…their incidents", winner.incidents, 6);
check("…and their best lap as a clock time", winner.fastest_lap_time, "1:30.369");
check("a lap deficit is written the way the grid writes one", built.rows.find(r => r.entry_id === "eB").interval, "1L");

// Points. SimRacerHub pays in parts; this app pays for the finishing position
// out of the league's own structure, so only what it cannot work out for itself
// crosses over. Nothing here pays a finisher their SimRacerHub total.
check("a finisher's points are not imported", "points" in winner, false);
check("…only what this app can't derive", winner.points_adjustment, 0);

// A driver who was paid without racing has no finishing position to be scored
// off, so the flat value IS their points — and they are parked behind the
// field where they can never collide with a real result.
const prov = built.rows.find(r => r.provisional);
check("a provisional entry carries its flat points", prov.manual_points, 10);
check("…and is parked behind the field", prov.finish_pos, 3);
check("…having raced nothing", [prov.laps, prov.laps_led, prov.incidents], [0, 0, 0]);
check("the session says how many there were", [built.matched, built.provisional], [3, 1]);

// ── 3b. Taking SimRacerHub's own points ────────────────────────────────────
//
// A league already scored on SimRacerHub has a championship table there, and
// the only way this app's table agrees with it row for row is to take the
// figure it paid rather than re-derive one. Its scale, its bonuses, its
// penalties and its stage points are one number per driver that no structure
// here can reproduce.
{
  const taken = sessionRows(srhSegmentTable(featureSeg), roster, { sessionType: "feature", takeSrhPoints: true });
  const winner2 = taken.rows.find(r => r.entry_id === "eA");
  check("the row carries what SimRacerHub paid", winner2.manual_points, 75);
  check("…and the driver behind carries theirs", taken.rows.find(r => r.entry_id === "eB").manual_points, 70);
  // THE double-count. SimRacerHub's total already contains its penalties and
  // its own bonuses, so carrying them into Adj as well would pay every penalty
  // twice — the one mistake that would make the two tables disagree in the
  // very rounds this was meant to fix.
  check("and nothing goes to Adj as well", winner2.points_adjustment, 0);
  ok("…on every row", taken.rows.every(r => !r.points_adjustment));
  // The finishing order, the laps and the flags are all still imported: taking
  // the points doesn't make it a points-only import.
  check("the rest of the row is imported as always",
    [winner2.finish_pos, winner2.laps, winner2.laps_led], [1, 14, 10]);

  // Off — the default for the library, since the route is what turns it on —
  // the older rule applies: the league's structure scores the position and
  // only what it cannot derive rides across in Adj.
  const derived = sessionRows(srhSegmentTable(featureSeg), roster, { sessionType: "feature" });
  check("left off, no figure is written", derived.rows.find(r => r.entry_id === "eA").manual_points, undefined);
  check("…and Adj carries what it always did", derived.rows.find(r => r.entry_id === "eA").points_adjustment, 0);

  // A provisional entry was always scored this way, and still is — its flat
  // figure is what SimRacerHub paid it either way.
  check("a provisional entry is unaffected",
    taken.rows.find(r => r.provisional).manual_points,
    derived.rows.find(r => r.provisional).manual_points);

  // Qualifying too: SimRacerHub pays for a grid slot and it has to come across.
  const takenQual = sessionRows(srhSegmentTable({ ...featureSeg, type: "qualifying" }), roster,
    { sessionType: "qualifying", takeSrhPoints: true });
  check("a qualifying row carries its figure", takenQual.rows.find(r => r.entry_id === "eA").manual_points, 75);
}

// ── 4. The flags ───────────────────────────────────────────────────────────
//
// Fastest Lap comes from the source. Hard Charger and Most Laps Led are worked
// out from the numbers, exactly as the grid works them out while an admin
// types — so an imported session and a hand-entered one flag the same cars.
check("the quickest lap of the field is flagged", built.rows.filter(r => r.fastest_lap).map(r => r.entry_id), ["eB"]);
check("whoever led the most laps is flagged", built.rows.filter(r => r.most_laps_led).map(r => r.entry_id), ["eA"]);
check("…and whoever gained the most places", built.rows.filter(r => r.hard_charger).map(r => r.entry_id), ["eA"]);

// Qualifying. The lap a driver set IS their qualifying time, and there is no
// Provisional Entries section on a qualifying sheet to park anyone in.
const qualSeg = { ...featureSeg, type: "qualifying" };
const qual = sessionRows(srhSegmentTable(qualSeg), roster, { sessionType: "qualifying" });
check("a qualifying lap is stored as a qualifying time", qual.rows.find(r => r.entry_id === "eA").qual_time, "1:30.369");
check("…and not as a race best lap", qual.rows.find(r => r.entry_id === "eA").fastest_lap_time, "");
check("a qualifying sheet has no provisional entries", qual.rows.filter(r => r.provisional).length, 0);

// Two rows matching one roster place. The better finishing position is kept —
// a silently dropped win is the one mistake a bulk import must not make
// quietly — and the other is called out.
const twice = sessionRows(
  srhSegmentTable({ type: "race", drivers: {}, results: [
    { race_id: "1", finish_pos: "1", num_laps: "10", laps_led: "10", incidents: "0", status: "Running", provisional: "N", fastest_lap_time: "90.0", name: "Rose, Mia", tpts: 50 },
    { race_id: "1", finish_pos: "4", num_laps: "10", laps_led: "0", incidents: "0", status: "Running", provisional: "N", fastest_lap_time: "92.0", name: "Mia Rose", tpts: 30 },
  ] }),
  roster, { sessionType: "race" },
);
check("one roster place gets one row", twice.rows.length, 1);
check("…the better finish of the two", twice.rows[0].finish_pos, 1);
ok("…and the other is said out loud", twice.warnings.length === 1 && /appears twice/.test(twice.warnings[0]));

// ── A whole page → one event's plan ────────────────────────────────────────

const page = `<!DOCTYPE html><html><body>
<script language='javascript'>race_id=["9001","9002","9003"];</script>
<ul class='nav nav-tabs mb5'>
<li class='nav-item'><button class='nav-link' data-bs-toggle='tab' data-bs-target='#tab_9001'>HEAT 1</button></li>
<li class='nav-item'><button class='nav-link' data-bs-toggle='tab' data-bs-target='#tab_9002'>CONSOLATION</button></li>
<li class='nav-item'><button class='nav-link active' data-bs-toggle='tab' data-bs-target='#tab_9003'>FEATURE</button></li>
</ul>
<div class='tab-content'>
<div id='tab_9001' class='tab-pane fade'>
<h2 class='heading-session-name m-0'>HEAT 1</h2>
<div id='driver_table_9001'></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9001')).render(React.createElement(ResultsTable, {
  rps: [{"race_participant_id":"5","race_id":"9001","driver_id":"11","num_laps":"10","laps_led":"0","finish_pos":"2","status":"Running","intv_str":"-4.903","fastest_lap_time":"90.2965","incidents":"2","provisional":"N","elapsed_time":"9065205","tpts":50,"name":"Anderson, Nathan"},
{"race_participant_id":"6","race_id":"9001","driver_id":"12","num_laps":"10","laps_led":"10","finish_pos":"1","status":"Running","intv_str":"-","fastest_lap_time":"89.5378","incidents":"0","provisional":"N","elapsed_time":"9065105","tpts":55,"name":"Rose, Mia"}],
  drivers: {}, race_id: 9001 }));
</script>
</div>
<div id='tab_9002' class='tab-pane fade'>
<h2 class='heading-session-name m-0'>CONSOLATION</h2>
<div id='driver_table_9002'></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9002')).render(React.createElement(ResultsTable, {
  rps: [{"race_participant_id":"4","race_id":"9002","driver_id":"13","num_laps":"14","laps_led":"1","finish_pos":"1","status":"Running","intv_str":"-","fastest_lap_time":"89.799","incidents":"0","provisional":"N","elapsed_time":"12824214","tpts":75,"name":"Burchett, Brian"}],
  drivers: {}, race_id: 9002 }));
</script>
</div>
<div id='tab_9003' class='tab-pane fade show active'>
<h2 class='heading-session-name m-0'>FEATURE</h2>
<div class='race-stats'>1h 9m &middot; 14 laps &middot; 3 Leaders &middot; 5 Lead Changes &middot; 3 cautions (11 laps)</div>
<div id='driver_table_9003'></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9003')).render(React.createElement(ResultsTable, {
  rps: [{"race_participant_id":"1","race_id":"9003","driver_id":"11","num_laps":"14","laps_led":"10","finish_pos":"1","status":"Running","intv_str":"-","fastest_lap_time":"90.3687","incidents":"6","provisional":"N","elapsed_time":"12864949","tpts":75,"name":"Anderson, Nathan"},
{"race_participant_id":"2","race_id":"9003","driver_id":"12","num_laps":"13","laps_led":"4","finish_pos":"2","status":"Running","intv_str":"-1L","fastest_lap_time":"89.6849","incidents":"0","provisional":"N","elapsed_time":"12866653","tpts":70,"name":"Rose, Mia"}],
  drivers: {},
  schedule: {"schedule_id":"7500","season_id":"3040","race_date":"2026-09-15","season_name":"Kiwi Sim Racing - 2026","series_name":"Kiwi Cup","league_name":"Kiwi Sim Racing","track_name":"Adelaide Street Circuit"},
  race_id: 9003 }));
</script>
</div>
</div>
</body></html>`;

const doc = parseSrhPage(page);
for (const s of doc.segments) s.table = srhSegmentTable(s);
const plan = planRace({ id: "r1" }, doc, roster);

check("a whole night plans every session on it", plan.sessions.map(s => s.session),
  ["Heat 1", "Consolation", "A-Main Feature"]);
check("…and counts what it will write", plan.rows_total, 5);
check("the event grows the sessions to hold it", [plan.race_update.heat_format, plan.race_update.heats, plan.race_update.consolations],
  [true, ["Heat 1"], ["Consolation"]]);
check("nobody on this page is off the roster", plan.unmatched, []);

// The whole-night plan threads the choice down to every session on it.
{
  const takenPlan = planRace({ id: "r1" }, doc, roster, { takeSrhPoints: true });
  const every = takenPlan.sessions.flatMap(s => s.rows);
  ok("every row of every session carries what SimRacerHub paid",
    every.length > 0 && every.every(r => r.manual_points != null));
  ok("…and none of them carries it in Adj as well", every.every(r => !r.points_adjustment));
  ok("left off, none of them does", planRace({ id: "r1" }, doc, roster)
    .sessions.flatMap(s => s.rows).every(r => r.manual_points == null));
}

// The night's own figures belong to the event, not to a driver — and a heat's
// cautions are not the night's, so they come off the session that decided it.
check("the event's race statistics come off the feature", plan.stats_session, "A-Main Feature");
check("…and are the ones SimRacerHub printed there",
  [plan.stats.caution_flags, plan.stats.caution_laps, plan.stats.lead_changes], [3, 11, 5]);

// ── 5. One season link → a link per round ──────────────────────────────────

const races = [
  { id: "r1", round_number: 1 }, { id: "r2", round_number: 2 }, { id: "r3", round_number: 3 },
];
const byRound = matchScheduleToRaces(races, [
  { round_number: 1, schedule_id: "101" }, { round_number: 2, schedule_id: "102" }, { round_number: 3, schedule_id: "103" },
]);
check("each round gets its own round's results page", byRound, {
  r1: "https://www.simracerhub.com/scoring/season_race.php?schedule_id=101",
  r2: "https://www.simracerhub.com/scoring/season_race.php?schedule_id=102",
  r3: "https://www.simracerhub.com/scoring/season_race.php?schedule_id=103",
});

// A league that renumbered here, or a SimRacerHub schedule that leaves its
// playoff rounds unnumbered: the two lists are paired down the page instead,
// which is date order on both.
const paired = matchScheduleToRaces(races, [
  { round_number: 11, schedule_id: "201" }, { round_number: null, schedule_id: "202" }, { round_number: 13, schedule_id: "203" },
]);
check("numbering that doesn't line up pairs down the page", Object.keys(paired).sort(), ["r1", "r2", "r3"]);
check("…in order", paired.r2, "https://www.simracerhub.com/scoring/season_race.php?schedule_id=202");

// A round with no partner is left empty for an admin to paste into — never
// pointed at some other round's results.
const short = matchScheduleToRaces(races, [{ round_number: 1, schedule_id: "301" }, { round_number: 3, schedule_id: "303" }]);
check("a round the schedule has no partner for is left empty", Object.keys(short).sort(), ["r1", "r3"]);
check("nothing to pair with fills nothing in", matchScheduleToRaces(races, []), {});

// ── 6. The drivers the roster hasn't got ───────────────────────────────────

const missing = unmatchedRoster([
  { race_id: "r1", label: "Race 1 — Opener", unmatched: ["Ghost, Casper", "Newman, Alice"] },
  { race_id: "r2", label: "Race 2 — Bristol", unmatched: ["ghost, casper"] },
  { race_id: "r3", label: "Race 3 — Dover", unmatched: ["Ghost, Casper", "Late, Gary"] },
]);
check("one person, however many rounds they went missing from", missing.map(u => u.name),
  ["Ghost, Casper", "Late, Gary", "Newman, Alice"]);
check("…ordered by how much is riding on each", missing[0].rounds.length, 3);
check("…and carrying the rounds that will fix",
  missing[0].rounds.map(r => r.race_id), ["r1", "r2", "r3"]);
check("…by the name they can be found under", missing[0].rounds[0].label, "Race 1 — Opener");
// SimRacerHub is not consistent about case, and two spellings of one person is
// the duplicate this panel exists to stop being created.
check("a name spelled two ways is still one person", missing.length, 3);

check("a round that placed everybody asks for nothing",
  unmatchedRoster([{ race_id: "r1", label: "Race 1", unmatched: [] }]), []);
check("neither does a page that failed", unmatchedRoster([null, undefined, {}]), []);
check("and a blank name is not a person", unmatchedRoster([{ race_id: "r1", unmatched: ["", "   "] }]), []);
// The same round read twice (a check, then an import) is still one round.
check("a round read twice is listed once",
  unmatchedRoster([
    { race_id: "r1", label: "Race 1", unmatched: ["Ghost, Casper"] },
    { race_id: "r1", label: "Race 1", unmatched: ["Ghost, Casper"] },
  ])[0].rounds.length, 1);

// ── 7. Working the list, one name at a time ───────────────────────────────
//
// The panel keeps one name active and opens the next when it is answered. The
// answer just given has NOT reached the answered set yet — it was set in the
// same tick — so the name being advanced from must be excluded by name, or the
// run hands you the driver you just dealt with and never moves.
const names = ["alice", "bob", "cass", "dev"];

check("the next name is the one below", nextUnanswered(names, "alice", []), "bob");
check("the one just answered is never handed back", nextUnanswered(names, "alice", []) === "alice", false);
check("…even though it isn't in the answered set yet",
  nextUnanswered(["alice", "bob"], "alice", []), "bob");
check("names already answered are stepped over", nextUnanswered(names, "alice", ["bob", "cass"]), "dev");

// Worked out of order — the admin clicked down the list — the run still has to
// come back for the ones above rather than ending early.
check("it wraps to the top for anything left behind",
  nextUnanswered(names, "dev", ["bob"]), "alice");
check("…and picks the first still open on the way round",
  nextUnanswered(names, "cass", ["alice"]), "dev");
check("a middle name with only earlier ones left wraps",
  nextUnanswered(names, "cass", ["dev"]), "alice");

// The end of the run: nothing left is "", which is what closes the panel's
// active row rather than looping on the last name.
check("nothing left ends the run", nextUnanswered(names, "dev", ["alice", "bob", "cass"]), "");
check("a one-name list ends as soon as it is answered", nextUnanswered(["alice"], "alice", []), "");
check("an empty list has no next", nextUnanswered([], "alice", []), "");

// A name that isn't in the list at all (it was resolved and the list rebuilt
// under us) still yields the first thing outstanding rather than nothing.
check("a name no longer in the list falls to the first open one",
  nextUnanswered(names, "gone", ["alice"]), "bob");

// A Set is as good as an array, since that is what the caller naturally holds.
check("an answered Set works the same", nextUnanswered(names, "alice", new Set(["bob"])), "cass");

console.log(`srhSeasonResults: ${n} checks passed`);
