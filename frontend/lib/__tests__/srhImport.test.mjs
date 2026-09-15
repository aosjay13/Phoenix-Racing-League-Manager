// Getting a night of racing out of SimRacerHub used to be a table selection, a
// paste, and then the same again for every heat. One button now does it, which
// puts a lot of weight on this module being right about six things:
//
//   1. where to fetch from — and, just as much, where NOT to. The only thing
//      standing between "paste a link" and the server fetching whatever it's
//      pointed at is parseSrhRef, so a link to anywhere but simracerhub.com is
//      refused here and never reaches the network;
//   2. which sessions a race page holds, what each is CALLED, and which grid in
//      this app it belongs in — the whole point is that Qualifying, the Heats,
//      the Consolation and the Feature come back separately and land in the
//      right place;
//   3. the numbers. SimRacerHub writes lap times as decimal seconds, elapsed
//      times in ten-thousandths, and a lap deficit as a negative "-4L", none of
//      which is what the results grid stores;
//   4. a driver SimRacerHub paid without them racing is a provisional entry
//      here, not a finisher — the review table arrives with those rows ticked
//      and their finishing stats blank;
//   5. and the tables it produces have to be readable by the importer this app
//      already had: same headers, same column mapping, same fuzzy matching of a
//      name against every alias a driver answers to. A header this module
//      spells differently is a column that silently imports as nothing;
//   6. and none of it may reach Firestore on its own. An import fills the grid
//      for review — Save is still the statistician's to press.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProvisional, looksLikeSrhRef, parseSrhPage, parseSrhRef,
  srhDriverName, srhElapsed, srhEventLabel, srhInterval, srhLapTime,
  srhPageError, srhSegmentTable, SRH_HEADERS,
} from "../srhImport.js";
import { buildRows, headerToField, mapHeaders, sessionTypeFromName } from "../resultsImport.js";
import { segmentType } from "../iracingImport.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Where to fetch from ─────────────────────────────────────────────────

const fromUrl = parseSrhRef("https://www.simracerhub.com/scoring/season_race.php?schedule_id=375505");
check("a pasted race URL gives up its id", [fromUrl.ok, fromUrl.param, fromUrl.id], [true, "schedule_id", "375505"]);
check("…and one page to fetch", fromUrl.urls.length, 1);

// The host is written several ways in the wild, and a link typed by hand has no
// scheme at all.
for (const raw of [
  "https://simracerhub.com/season_race.php?race_id=379326",
  "simracerhub.com/scoring/season_race.php?race_id=379326",
  "http://www.simracerhub.com/scoring/season_race.php?race_id=379326&class_id=12",
]) {
  const ref = parseSrhRef(raw);
  check(`“${raw}” resolves`, [ref.ok, ref.param, ref.id], [true, "race_id", "379326"]);
  ok("…to a simracerhub.com page", ref.urls[0].startsWith("https://www.simracerhub.com/scoring/season_race.php?"));
}

// A bare number could be either id SimRacerHub accepts, and it only tells them
// apart by being asked — so both are offered, schedule first.
const bare = parseSrhRef(" 375505 ");
check("a bare id is tried as a schedule then a race", bare.urls, [
  "https://www.simracerhub.com/scoring/season_race.php?schedule_id=375505",
  "https://www.simracerhub.com/scoring/season_race.php?race_id=375505",
]);
check("a bare 'race_id=42' is taken at its word", parseSrhRef("?race_id=42").urls,
  ["https://www.simracerhub.com/scoring/season_race.php?race_id=42"]);

// THE guard: this is the only thing that decides where the server makes a
// request to.
const elsewhere = parseSrhRef("https://internal.example.com/x?schedule_id=1");
check("a link to anywhere else is refused", elsewhere.ok, false);
ok("…and says where it pointed", /internal\.example\.com/.test(elsewhere.error));
check("a simracerhub link with no race on it is refused", parseSrhRef("https://www.simracerhub.com/scoring/leagues.php").ok, false);
check("so is an empty box", parseSrhRef("   ").ok, false);
check("so is a lookalike host", parseSrhRef("https://simracerhub.com.evil.test/season_race.php?race_id=1").ok, false);
check("and so is prose", parseSrhRef("import last night please").ok, false);

// What a pasted link looks like to the paste box, which fetches it instead of
// trying to read it as one very confusing row of results.
ok("a race link pasted into the table box is recognised",
  looksLikeSrhRef("https://www.simracerhub.com/scoring/season_race.php?schedule_id=375505"));
ok("a results table is not", !looksLikeSrhRef("Fin,Start,Driver\n1,3,Jane Doe"));
ok("nor is a bare number — that's a table of one cell as easily as an id", !looksLikeSrhRef("375505"));

// ── 2. Sessions, names and the grid each belongs in ────────────────────────

// SimRacerHub's own vocabulary for a night's sessions.
check("qualifying", sessionTypeFromName("QUALIFY"), "qualifying");
check("practice", sessionTypeFromName("PRACTICE"), "practice");
check("a heat", sessionTypeFromName("HEAT 2"), "heat");
check("a consolation", sessionTypeFromName("CONSOLATION"), "consolation");
check("a B-Main is a consolation", sessionTypeFromName("B-MAIN"), "consolation");
check("the feature", sessionTypeFromName("FEATURE"), "feature");
check("an A-Main is the feature", sessionTypeFromName("A-MAIN"), "feature");
check("a plain race", sessionTypeFromName("RACE"), "race");
check("a stage is a race", sessionTypeFromName("STAGE 1"), "race");
check("something unheard of is a race", sessionTypeFromName("SHOOTOUT"), "race");
// A heat is often named for what it decides, and that reading has to win over
// the word "qualifying" inside it.
check("a qualifying race is a heat", sessionTypeFromName("QUALIFYING RACE"), "heat");

// The same vocabulary is what the iRacing importer classifies its race sessions
// by, and moving it here mustn't have changed any of its answers.
check("iRacing qualifying still qualifies", segmentType({ simsession_type: 4, simsession_name: "QUALIFY" }), "qualifying");
check("iRacing practice is still practice", segmentType({ simsession_type: 3, simsession_name: "PRACTICE" }), "practice");
check("an iRacing B-Main is still a consolation", segmentType({ simsession_type: 6, simsession_name: "B-MAIN" }), "consolation");
check("an iRacing heat is still a heat", segmentType({ simsession_type: 6, simsession_name: "HEAT 1" }), "heat");
check("an iRacing feature is still the feature", segmentType({ simsession_type: 6, simsession_name: "FEATURE" }), "feature");
check("an iRacing race session named for qualifying is still a race",
  segmentType({ simsession_type: 6, simsession_name: "QUALIFYING" }), "race");

// A race page, in the shape SimRacerHub really serves one: a tab per session,
// a heading above each table, the table's id carrying the session's race id,
// and the rows themselves handed to a React component as JSON. Two heats and a
// feature — plus a driver paid provisionally, a car a lap down, and a name with
// a bracket in it, which is what a naive scan of that JSON trips over.
const page = `<!DOCTYPE html><html><body>
<script language='javascript'>race_id=["9003","9002","9001"];</script>
<ul class='nav nav-tabs mb5'>
<li class='nav-item'><button class='nav-link active' data-bs-toggle='tab' data-bs-target='#tab_9003'>FEATURE</button></li>
<li class='nav-item'><button class='nav-link' data-bs-toggle='tab' data-bs-target='#tab_9002'>CONSOLATION</button></li>
<li class='nav-item'><button class='nav-link' data-bs-toggle='tab' data-bs-target='#tab_9001'>HEAT 1</button></li>
</ul>
<div class='tab-content'>
<div id='tab_9003' class='tab-pane fade show active'>
<h2 class='heading-session-name m-0'>FEATURE</h2>
<div id='driver_table_9003'><table class='driver_table'></table></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9003')).render(React.createElement(
  ResultsTable,
  {
    rps: [{"race_participant_id":"1","race_id":"9003","driver_id":"11","driver_number":"23","qualify_pos":"9","qualify_time":"90.2236","num_laps":"14","laps_led":"10","finish_pos":"1","status":"Running","intv":"0","intv_units":"ms","intv_str":"-","fastest_lap_time":"90.3687","incidents":"6","avg_lap":"91.8919","provisional":"N","elapsed_time":"12864949","tpts":75,"name":"Anderson, Nathan"},
{"race_participant_id":"2","race_id":"9003","driver_id":"12","driver_number":"909","qualify_pos":"1","qualify_time":"89.8022","num_laps":"13","laps_led":"4","finish_pos":"2","status":"Disconnected","intv":9999.0001,"intv_units":"ms","intv_str":"-1L","fastest_lap_time":"89.6849","incidents":"0","avg_lap":"91.601","provisional":"N","elapsed_time":"12866653","tpts":70,"name":"Rose [Jnr], Mia"},
{"race_participant_id":"3","race_id":"9003","driver_id":"13","driver_number":"","qualify_pos":"0","qualify_time":"0","num_laps":"0","laps_led":"0","finish_pos":"","status":"Provisional","intv":1199880,"intv_units":"ms","intv_str":"-120L","fastest_lap_time":"0","incidents":"0","provisional":"Y","elapsed_time":null,"tpts":10,"name":"Burchett, Brian"}],
    rps_by_class: {},
    drivers: {"11":{"driver_id":"11","name":"N Anderson","last_first":"Anderson, Nathan"},"12":{"driver_id":"12","name":"M Rose","last_first":"Rose [Jnr], Mia"},"13":{"driver_id":"13","name":"B Burchett","last_first":"Burchett, Brian"}},
    schedule: {"schedule_id":"7500","season_id":"3040","series_id":"1370","race_date":"2026-09-15","season_name":"Kiwi Sim Racing - 2026","series_name":"Kiwi Cup","league_name":"Kiwi Sim Racing","track_name":"Adelaide Street Circuit","track_config_name":null,"planned_laps":"14"},
    race_id: 9003,
  }));
</script>
</div>
<div id='tab_9002' class='tab-pane fade'>
<h2 class='heading-session-name m-0'>CONSOLATION</h2>
<div id='driver_table_9002'></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9002')).render(React.createElement(
  ResultsTable,
  {
    rps: [{"race_participant_id":"4","race_id":"9002","driver_id":"12","driver_number":"909","qualify_pos":"8","qualify_time":"89.8022","num_laps":"14","laps_led":"1","finish_pos":"1","status":"Running","intv":"0","intv_str":"-","fastest_lap_time":"89.799","incidents":"0","provisional":"N","elapsed_time":"12824214","tpts":75,"name":"Rose [Jnr], Mia"}],
    drivers: {},
    race_id: 9002,
  }));
</script>
</div>
<div id='tab_9001' class='tab-pane fade'>
<h2 class='heading-session-name m-0'>HEAT 1</h2>
<div id='driver_table_9001'></div>
<script>
ReactDOM.createRoot(document.getElementById('driver_table_9001')).render(React.createElement(
  ResultsTable,
  {
    rps: [{"race_participant_id":"5","race_id":"9001","driver_id":"11","driver_number":"23","qualify_pos":"2","qualify_time":"90.2236","num_laps":"10","laps_led":"0","finish_pos":"2","status":"Running","intv":"4.9034","intv_str":"-4.903","fastest_lap_time":"90.2965","incidents":"2","provisional":"N","elapsed_time":"9065205","tpts":50,"name":"Anderson, Nathan"},
{"race_participant_id":"6","race_id":"9001","driver_id":"12","driver_number":"909","qualify_pos":"1","qualify_time":"89.8022","num_laps":"10","laps_led":"10","finish_pos":"1","status":"Running","intv":"0","intv_str":"-","fastest_lap_time":"89.5378","incidents":"0","provisional":"N","elapsed_time":"9065105","tpts":55,"name":"Rose [Jnr], Mia"}],
    drivers: {},
    race_id: 9001,
  }));
</script>
</div>
</div>
</body></html>`;

const doc = parseSrhPage(page);
ok("a race page parses", !!doc);
check("every session on it is found", doc.segments.map(s => s.name), ["Heat 1", "Consolation", "Feature"]);
check("…in the order they were run", doc.segments.map(s => s.key), ["9001", "9002", "9003"]);
check("…each landing in the right grid", doc.segments.map(s => s.type), ["heat", "consolation", "feature"]);
check("…with its own field", doc.segments.map(s => s.driver_count), [2, 1, 3]);
check("the event says whose night it was",
  srhEventLabel(doc.event), "Kiwi Sim Racing · Kiwi Cup · Adelaide Street Circuit · 2026-09-15");

// Rows are filed by the race id each one carries, so a session can never end up
// with another session's field however the page renders its tables.
const feature = doc.segments.find(s => s.key === "9003");
check("a session's rows are its own", feature.results.map(r => r.race_participant_id), ["1", "2", "3"]);

// The two pages that aren't a race page at all.
check("an error page is not a race", parseSrhPage("<html><body><div class='alert alert-danger d-flex'><div>Series ID, Season ID, Schedule ID, or Race ID is required</div></div></body></html>"), null);
check("…and says why, in SimRacerHub's own words",
  srhPageError("<div class='alert alert-danger d-flex align-items-center'><i class='bi'></i><div>Series ID, Season ID, Schedule ID, or Race ID is required</div></div>"),
  "Series ID, Season ID, Schedule ID, or Race ID is required");
check("nothing at all is not a race", parseSrhPage(""), null);

// ── 3. The numbers ─────────────────────────────────────────────────────────

check("a lap time is decimal seconds", srhLapTime("90.2236"), "1:30.224");
check("…however short the lap", srhLapTime("15.068"), "0:15.068");
check("a driver who set none has none", srhLapTime("0"), "");
check("…and neither does a missing one", srhLapTime(null), "");
check("an elapsed time is ten-thousandths", srhElapsed("12864949"), "21:26.495");
check("…and runs to hours", srhElapsed("50234690"), "1:23:43.469");

check("the leader has no gap", srhInterval({ intv: "0", intv_str: "-" }), "");
check("a gap is a gap", srhInterval({ intv: "4.9034", intv_str: "-4.903" }), "+4.903");
check("a lap down is laps, not seconds", srhInterval({ intv: 9999.0001, intv_str: "-1L" }), "1L");
check("…however many laps", srhInterval({ intv: 1199880, intv_str: "-120L" }), "120L");
// The numeric field encodes a lap deficit as a multiple of 9999 seconds, which
// is what's left to read when the display string is missing.
check("a lap deficit is still read without the string", srhInterval({ intv: 39996.0001, intv_str: "" }), "4L");
check("a gap is still read without the string", srhInterval({ intv: "1.5", intv_str: "" }), "+1.500");
check("no gap at all reads as none", srhInterval({}), "");

// SimRacerHub stores the iRacing name last-first; the roster here holds the name
// the driver actually races under.
check("a name comes back the way round it's registered", srhDriverName({ name: "Bage, John" }), "John Bage");
check("…including one with initials", srhDriverName({ name: "Rose [Jnr], Mia" }), "Mia Rose [Jnr]");
check("a name with no comma is left alone", srhDriverName({ name: "Tazio" }), "Tazio");
check("a row with no name of its own falls back to the driver list",
  srhDriverName({ driver_id: "11" }, { 11: { name: "N Anderson", last_first: "Anderson, Nathan" } }), "Nathan Anderson");
check("and a driver nobody named is blank", srhDriverName({}, {}), "");

// ── 4. A provisional entry is not a finisher ───────────────────────────────

ok("SimRacerHub's own flag is read", isProvisional({ provisional: "Y" }));
ok("…and its absence", !isProvisional({ provisional: "N" }) && !isProvisional({}));

const featureTable = srhSegmentTable(feature);
check("the provisional driver is flagged, nobody else is", featureTable.provisional, [false, false, true]);
const provRow = featureTable.rows[2];
check("a provisional row keeps who and what they were paid",
  [provRow[3], provRow[12]], ["Brian Burchett", "10"]);
check("…and claims no finishing position, gap or race time",
  [provRow[0], provRow[1], provRow[7], provRow[8]], ["", "", "", ""]);

// ── 5. Readable by the importer this app already had ───────────────────────

// Every header this module emits has to map to the schema field it means —
// one that doesn't is a column that imports as nothing at all.
check("the headers map to the fields they name",
  SRH_HEADERS.map(headerToField),
  ["finish_pos", "start_pos", "car_number", "driver", "laps", "laps_led", "incidents",
   "interval", "race_time", "fastest_lap_time", "qual_time", "status", "points"]);
check("…and the column mapping falls out of them",
  mapHeaders(featureTable.headers, featureTable.rows.slice(0, 3)),
  { finish_pos: 0, start_pos: 1, car_number: 2, driver: 3, laps: 4, laps_led: 5, incidents: 6,
    interval: 7, race_time: 8, fastest_lap_time: 9, qual_time: 10, status: 11, points: 12 });

// End to end: a session through the shared pipeline, matched against a roster
// holding one driver under her gamertag rather than her iRacing name.
const roster = [
  { id: "e-nathan", name: "Nathan Anderson", number: "23" },
  { id: "e-mia", name: "MiaRose_NZ", number: "909", aliases: ["Mia Rose"] },
];
const built = buildRows(featureTable, mapHeaders(featureTable.headers), roster, { sessionType: "feature" });
check("the winner is matched and has their night's work",
  [built.rows[0].match.entry_id, built.rows[0].values.finish_pos, built.rows[0].values.start_pos,
   built.rows[0].values.laps, built.rows[0].values.laps_led, built.rows[0].values.incidents,
   built.rows[0].values.race_time, built.rows[0].values.fastest_lap_time, built.rows[0].values.qual_time,
   built.rows[0].values.car_number, built.rows[0].values.status],
  ["e-nathan", 1, 9, 14, 10, 6, "21:26.495", "1:30.369", "1:30.224", "23", "finished"]);
check("a driver on the roster under another name is still matched",
  built.rows[1].match.entry_id, "e-mia");
check("…and their disconnection is a DNF a lap down",
  [built.rows[1].values.status, built.rows[1].values.interval], ["dnf", "1L"]);
check("the fastest lap of the session is flagged once",
  built.rows.map(r => r.values.fastest_lap), [false, true, false]);
check("nothing about the field is guessed at", built.warnings, []);

// A qualifying session: the lap IS the result, so it fills Qual Time and no
// starting position is invented for a grid that has none.
const heat = doc.segments.find(s => s.key === "9001");
const qualTable = srhSegmentTable({ ...heat, type: "qualifying" });
check("a qualifying sheet has no starting positions", qualTable.rows.map(r => r[1]), ["", ""]);
check("…no gaps to the car ahead", qualTable.rows.map(r => r[7]), ["", ""]);
check("…and every driver's lap in Qual Time", qualTable.rows.map(r => r[10]), ["1:29.538", "1:30.297"]);
const qualBuilt = buildRows(qualTable, mapHeaders(qualTable.headers), roster, { sessionType: "qualifying" });
check("pole is the quickest lap", [qualBuilt.rows[0].values.qual_time, qualBuilt.rows[0].values.fastest_lap], ["1:29.538", true]);

// ── 6. The import fills the grid; Save is what writes ─────────────────────
//
// The workflow rule, and the reason the route exists at all: an import must
// never put results in Firestore behind the statistician's back. Every points,
// bonus and flag calculation in this app happens on the way in from the grid
// (Calculate-on-Write), so an importer that wrote directly would be a second
// scorer, quietly disagreeing with the first. Checked at source level, the way
// resultsGridSafety.test.mjs checks the grid's own wiring — what has to hold is
// which door the data goes through.
const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
const route = read("app/api/import-srh/route.js");
const modal = read("components/ImportResultsModal.jsx");
const editor = read("components/SessionEditor.jsx");

ok("the import route holds no database handle at all", !/from "@\/lib\/firebase"/.test(route));
ok("…and writes nothing", !/\.(set|update|add|delete|commit)\(/.test(route));
ok("…and is gated on a staff role", /withAdmin\(/.test(route));
ok("…and only ever reads with GET", !/export const (POST|PUT|PATCH|DELETE)/.test(route));
// Where the server is allowed to make a request to is decided by parseSrhRef
// and nothing else — no second, laxer path to fetch().
ok("…fetching only what parseSrhRef allowed", /for \(const url of ref\.urls\)/.test(route));
ok("…and nothing else", route.match(/fetch\(/g).length === 1);

ok("the importer's only way into the grid is the review table's Apply", /onApply\(rows\)/.test(modal));
ok("…and the statistician is told Save is still theirs to press", /nothing is saved until you click Save/i.test(modal));
ok("the SimRacerHub box is on the importer", /Import from SimRacerHub/.test(modal));
ok("…with somewhere to paste the race", /aria-label="SimRacerHub race URL or id"/.test(modal));
ok("…and a button to do it", /\{srhBusy \? "Importing…" : "Import Results"\}/.test(modal));
ok("…which asks the server, because SimRacerHub sends no CORS headers", /\/api\/import-srh\?url=/.test(modal));

ok("the results screen offers it directly too", /🔗 Import from SimRacerHub/.test(editor));
ok("…opening the same importer on that box", /autoFocusSrh=\{importSrhFirst\}/.test(editor));
ok("…and what comes back fills the grid rather than saving it", /onApply=\{applyImport\}/.test(editor));

console.log(`srhImport: ${n} assertions passed`);
