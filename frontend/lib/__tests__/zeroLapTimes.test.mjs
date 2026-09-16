// A lap time of zero is not a lap.
//
// "0:00.000" is what timing exports print for a driver who never set a time,
// and it is what a slip of the keyboard leaves in an empty cell. It parses as
// cleanly as a real lap does — which is the whole problem, because zero beats
// every lap anybody has ever turned. Left to count it takes the track record at
// a venue permanently, and takes the Fastest Lap bonus (and the "Best Laps"
// column that bonus feeds on every stats, records and profile screen) with it.
//
// The invariants that matter:
//
//   1. one rule for the whole app — lapSeconds says what a lap is, and every
//      screen that ranks or records a lap reads through it;
//   2. a zero never holds a track record: not the venue's outright record, not
//      a game's, not a class's, and not via any future caller, because the
//      record book itself refuses one;
//   3. a real lap still wins, and a venue whose only "times" are zeros simply
//      has no record rather than a fake one;
//   4. a zero never takes the Fastest Lap bonus — not on the grid an admin
//      types into, and not from an imported file;
//   5. a zero is never the pole time other gaps are measured against;
//   6. none of this touches what was entered. The text stays on the sheet so it
//      can be corrected; it just counts toward nothing.
import assert from "node:assert";
import { lapSeconds, gapColumns } from "../raceTime.js";
import { classRecordKey, gameRecordKey, keepFastest } from "../trackRecords.js";
import { trackProfileFromBundle } from "../trackCompute.js";
import { applyAutoFlags, autoFastestLapSlot } from "../autoFlags.js";
import { buildRows } from "../resultsImport.js";
import { bestLap, summarizeEntry } from "../timeTrials.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (label, cond) => check(label, !!cond, true);

// ── 1. One rule, in one place ─────────────────────────────────────────────
check("a bare zero is not a lap", lapSeconds("0"), null);
check("…nor 0:00", lapSeconds("0:00"), null);
check("…nor 0:00.000", lapSeconds("0:00.000"), null);
check("…nor 00:00.000", lapSeconds("00:00.000"), null);
check("…nor 0:00:00.000", lapSeconds("0:00:00.000"), null);
check("…nor a numeric zero", lapSeconds(0), null);
check("…nor 0.000", lapSeconds("0.000"), null);
check("Infinity is not a lap", lapSeconds("Infinity"), null);
check("…nor an overflowing exponent", lapSeconds("1e400"), null);
check("blank is not a lap", lapSeconds(""), null);
check("neither is nothing at all", lapSeconds(null), null);
check("gibberish is not a lap", lapSeconds("abc"), null);
check("a real lap is a real lap", lapSeconds("1:23.456"), 83.456);
check("even a very quick one", lapSeconds("0:00.001"), 0.001);

// ── 2. The record book refuses a zero ─────────────────────────────────────
{
  const book = {};
  keepFastest(book, gameRecordKey({ gameId: "g1" }), { seconds: 0, time: "0:00.000", driver_name: "Ghost" });
  check("a zero is not filed as a record", book, {});

  keepFastest(book, gameRecordKey({ gameId: "g1" }), { seconds: 83.456, time: "1:23.456", driver_name: "Ada" });
  check("a real lap is", book.g1.driver_name, "Ada");

  keepFastest(book, gameRecordKey({ gameId: "g1" }), { seconds: 0, time: "0:00.000", driver_name: "Ghost" });
  check("and a zero can't take it off them", book.g1.driver_name, "Ada");

  const classBook = {};
  keepFastest(classBook, classRecordKey({ gameId: "g1", className: "GT3" }), { seconds: 0, driver_name: "Ghost" });
  check("class records refuse a zero too", classBook, {});
}

// ── 3. A venue's records, end to end ──────────────────────────────────────
//
// One race at one venue: the winner's Best Lap cell holds the "0:00.000" their
// timing export printed, and the driver behind them turned a real lap. The
// record is the real lap, and the zero is nowhere in the book.
const bundle = (results, extra = {}) => ({
  scope: "league",
  games: [{ id: "g1", name: "iRacing" }],
  series: [{ id: "sr1", name: "Phoenix GT", game_id: "g1" }],
  seasons: [{ id: "s1", name: "Season 1", series_id: "sr1", game_id: "g1" }],
  tracks: [{ id: "t1", name: "Bristol" }],
  classes: [{ id: "c1", season_id: "s1", name: "GT3" }],
  races: [{ id: "r1", season_id: "s1", name: "Round 1", track_id: "t1", date: "2026-03-01", sessions: ["Race"] }],
  entries: [
    { id: "e1", season_id: "s1", name: "Ada", driver_id: "d1", class_id: "c1" },
    { id: "e2", season_id: "s1", name: "Grace", driver_id: "d2", class_id: "c1" },
  ],
  drivers: [{ id: "d1", name: "Ada" }, { id: "d2", name: "Grace" }],
  results,
  teams: [], team_seasons: [], account_names: {}, points_templates: [],
  time_trials: [], time_trial_entries: [],
  ...extra,
});

const raceResult = (id, entryId, pos, lap) => ({
  id, season_id: "s1", race_id: "r1", entry_id: entryId,
  session: "Race", session_type: "race", finish_pos: pos, laps: 30, fastest_lap_time: lap,
});

{
  const venue = trackProfileFromBundle(
    bundle([raceResult("x1", "e1", 1, "0:00.000"), raceResult("x2", "e2", 2, "1:23.456")]),
    { trackId: "t1", trackName: "Bristol" },
  );
  check("the track record is the real lap", venue.record.time, "1:23.456");
  check("…set by the driver who actually turned it", venue.record.driver_name, "Grace");
  check("the per-game record agrees", venue.records_by_game.map(r => r.time), ["1:23.456"]);
  check("and so does the per-class one", venue.records_by_class.map(r => `${r.class_name} ${r.time}`), ["GT3 1:23.456"]);
  ok("the zero holder isn't in the record book at all",
    ![venue.record, ...venue.records_by_game, ...venue.records_by_class].some(r => r.driver_name === "Ada"));
  check("and the race itself still counts as a race held here", venue.races_held, 1);
  ok("with both drivers still on the venue leaderboard", venue.drivers.length === 2);
}

// A venue where NOBODY set a time has no record — not a record of zero.
{
  const venue = trackProfileFromBundle(
    bundle([raceResult("x1", "e1", 1, "0:00.000"), raceResult("x2", "e2", 2, "0")]),
    { trackId: "t1", trackName: "Bristol" },
  );
  check("no laps, no track record", venue.record, null);
  check("no per-game record either", venue.records_by_game, []);
  check("nor a per-class one", venue.records_by_class, []);
  check("the race was still held here", venue.races_held, 1);
}

// Qualifying hot laps go through the same gate — a zero in Qual Time is not a
// pole lap, and the real one behind it holds the record.
{
  const qual = (id, entryId, pos, time) => ({
    id, season_id: "s1", race_id: "r1", entry_id: entryId,
    session: "Qualifying", session_type: "qualifying", finish_pos: pos, qual_time: time,
  });
  const venue = trackProfileFromBundle(
    bundle([qual("q1", "e1", 1, "0:00.000"), qual("q2", "e2", 2, "1:24.100")]),
    { trackId: "t1", trackName: "Bristol" },
  );
  check("a zero qualifying time holds nothing", venue.record.time, "1:24.100");
  check("…and the real hot lap's holder is named", venue.record.driver_name, "Grace");
  ok("recorded as a qualifying lap", venue.record.from_qualifying);
}

// A Time Trial lap competes with race laps on equal terms, and a zero typed
// into a trial sheet is refused on the same rule — this is the path that
// already read through lapSeconds, kept honest here alongside the rest.
{
  const trial = trackProfileFromBundle(
    bundle([], {
      time_trials: [{ id: "tt1", track_id: "t1", game_id: "g1", series_id: "sr1", season_id: "s1", name: "Hot Lap Night" }],
      time_trial_entries: [
        { id: "tte1", time_trial_id: "tt1", name: "Ada", driver_id: "d1", laps: ["0:00.000", "0"] },
        { id: "tte2", time_trial_id: "tt1", name: "Grace", driver_id: "d2", laps: ["1:22.900"] },
      ],
    }),
    { trackId: "t1", trackName: "Bristol" },
  );
  check("a trial's zero laps set no record", trial.record.time, "1:22.900");
  check("…and the driver who only logged zeros holds nothing", trial.record.driver_name, "Grace");
  check("a sheet of nothing but zeros has no best lap", bestLap(["0:00.000", "0", "0:00"]), null);
  check("…and no Best Time on the sheet", summarizeEntry({ laps: ["0:00.000"] }).best_time, null);
  check("but the laps themselves are still on it, as typed",
    summarizeEntry({ laps: ["0:00.000"] }).laps, ["0:00.000"]);
}

// ── 4. The Fastest Lap bonus ──────────────────────────────────────────────
//
// The flag behind every "Best Laps" / "Most Fastest Laps" figure in the app.
{
  const rows = [
    { slot_id: 1, entry_id: "e1", fastest_lap_time: "0:00.000" },
    { slot_id: 2, entry_id: "e2", fastest_lap_time: "1:23.456" },
  ];
  check("a zero doesn't take the Fastest Lap", autoFastestLapSlot(rows), 2);
  check("a grid of zeros awards it to nobody",
    autoFastestLapSlot([{ slot_id: 1, entry_id: "e1", fastest_lap_time: "0:00.000" }]), null);
  check("…and the grid leaves the box unticked",
    applyAutoFlags([{ slot_id: 1, entry_id: "e1", fastest_lap_time: "0" }]).map(r => !!r.fastest_lap), [false]);
  check("Infinity doesn't take it either",
    autoFastestLapSlot([{ slot_id: 1, entry_id: "e1", fastest_lap_time: "Infinity" }]), null);
}

// An imported file says the same thing: the row printed "0:00.000" never set
// the fastest lap of the session.
{
  const table = {
    rows: [
      ["1", "Ada", "0:00.000"],
      ["2", "Grace", "1:23.456"],
    ],
  };
  const mapping = { finish_pos: 0, driver: 1, fastest_lap_time: 2 };
  const entries = [{ id: "e1", name: "Ada" }, { id: "e2", name: "Grace" }];
  const built = buildRows(table, mapping, entries, { sessionType: "race" });
  check("the import hands Fastest Lap to the real lap",
    built.rows.map(r => !!r.values.fastest_lap), [false, true]);
  check("but the cell is imported exactly as the file printed it",
    built.rows.map(r => r.values.fastest_lap_time), ["0:00.000", "1:23.456"]);

  const allZero = buildRows({ rows: [["1", "Ada", "0:00.000"], ["2", "Grace", "0"]] }, mapping, entries,
    { sessionType: "race" });
  check("a file of nothing but zeros flags nobody",
    allZero.rows.map(r => !!r.values.fastest_lap), [false, false]);

  // Qualifying imports read the lap out of the Qual Time column instead.
  const qualBuilt = buildRows(table, { finish_pos: 0, driver: 1, qual_time: 2 }, entries,
    { sessionType: "qualifying" });
  check("and a qualifying import works the same way",
    qualBuilt.rows.map(r => !!r.values.fastest_lap), [false, true]);
}

// ── 5. A zero is never the reference time ─────────────────────────────────
//
// What a results page does with a qualifying sheet whose pole cell holds a
// zero: the gaps are measured off the first REAL time, so the rest of the grid
// isn't shown a minute and a half behind a lap nobody turned.
{
  const sheet = ["0:00.000", "1:23.456", "1:23.956"];
  const gaps = gapColumns(sheet.map(lapSeconds));
  check("the zero row gets no gap of its own", gaps[0], { toLead: null, gap: null });
  check("the first real lap is the reference", gaps[1], { toLead: null, gap: null });
  check("and the car behind measures to it", gaps[2].gap.toFixed(3), "0.500");
}

console.log(`all ${n} checks passed — a zero is not a lap, and holds no record anywhere`);
