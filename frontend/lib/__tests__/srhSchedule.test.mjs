// Importing a whole season's schedule from SimRacerHub, which is the one press
// that replaces typing twelve rounds in for the second time.
//
// It writes a season, a dozen races and any venue the league is missing, all
// from one URL, so the parsing has to be right about seven things:
//
//   1. where to fetch from, and where NOT to — parseSrhSeasonRef is the only
//      thing deciding where the server makes a request to, and a series or
//      league link names no single season, so it is refused rather than having
//      one picked for the admin;
//   2. the columns. SimRacerHub lets every league choose which ones its
//      schedule shows, so no two pages have the same shape and nothing may be
//      found by counting. Each cell is located by what its column is CALLED;
//   3. the dates. "Sep 10, 2024", "Sunday June 21, 2026", "17/08/2026" — and
//      that last one is 17 August in a British league and unreadable in an
//      American one. One format per league, so the page is resolved as a whole,
//      from evidence;
//   4. the Event / Track cell, which stacks the league's name for the event and
//      the track in one place. Reading them as one string would make a venue
//      called "Stages 30/60/130 Daytona International Speedway Oval" — a brand
//      new track, every week;
//   5. the round numbers. This app orders a schedule by them, and SimRacerHub
//      leaves playoff rounds unnumbered and lists the page by date, so taking
//      them as given can put two races on one number;
//   6. the distances: laps, or a clock, or a column that isn't a distance at
//      all;
//   7. and the venue behind each layout name, read off SimRacerHub's own track
//      directory, which is what lets the track checker in lib/trackMatch.js
//      tell an Oval from a Roval at the same place. Whether that venue is
//      already in the app is that module's job and its own test file.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapScheduleHeaders, numberRounds, parseSrhSchedule, parseSrhSeasonNames,
  parseSrhSeasonRef, parseSrhTrackDirectory, readCarCell, readEventCell,
  readRaceLength, readScheduleDate, readSessionTime, resolveDates, roundName,
  scheduleHeaderField, srhSchedulePlan, srhSchedulePageUrl, srhTrackInfo,
} from "../srhSchedule.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Where to fetch from ─────────────────────────────────────────────────

const SCHED = "https://www.simracerhub.com/scoring/season_schedule.php?season_id=25195";

check("the schedule link an admin copies", parseSrhSeasonRef("https://www.simracerhub.com/season_schedule.php?season_id=25195"),
  { ok: true, season_id: "25195", url: SCHED });
// Any page of that season carries the id, and an admin shouldn't have to find
// the schedule tab before copying.
check("…or its standings", parseSrhSeasonRef("https://www.simracerhub.com/scoring/season_standings.php?season_id=25195").url, SCHED);
check("…or its results", parseSrhSeasonRef("simracerhub.com/season_race.php?season_id=25195&class_id=7").url, SCHED);
check("…or the bare id", parseSrhSeasonRef(" 25195 ").url, SCHED);
check("…or the query fragment", parseSrhSeasonRef("?season_id=25195").url, SCHED);
check("the canonical page is built from the id", srhSchedulePageUrl("25195"), SCHED);

// THE guard.
const elsewhere = parseSrhSeasonRef("https://internal.example.com/season_schedule.php?season_id=1");
check("a link to anywhere else is refused", elsewhere.ok, false);
ok("…and says where it pointed", /internal\.example\.com/.test(elsewhere.error));
check("a lookalike host is refused", parseSrhSeasonRef("https://simracerhub.com.evil.test/?season_id=1").ok, false);
check("an empty box is refused", parseSrhSeasonRef("  ").ok, false);
const prose = parseSrhSeasonRef("import my season please");
check("so is prose", prose.ok, false);
ok("…as prose, not as the wrong website", /doesn't look like/.test(prose.error));

// A series or a league link names no ONE season. Picking one for the admin
// would be picking the wrong one, so it says what to copy instead.
const series = parseSrhSeasonRef("https://www.simracerhub.com/scoring/series_seasons.php?series_id=12932");
check("a series link is refused", series.ok, false);
ok("…and says to open the season", /whole series/.test(series.error));
const league = parseSrhSeasonRef("https://www.simracerhub.com/scoring/league_series.php?league_id=5122");
ok("a league link is refused the same way", !league.ok && /whole series/.test(league.error));

// ── 2. The columns, which are never in the same place twice ───────────────

check("the round number", scheduleHeaderField("Race"), "round");
check("the date", scheduleHeaderField("Race Date"), "date");
check("whether it scores", scheduleHeaderField("Pts Count"), "points_count");
check("the car", scheduleHeaderField("Car"), "car");
check("the event and its track", scheduleHeaderField("Event / Track"), "event");
check("the distance", scheduleHeaderField("Race Length"), "length");
check("the practice time", scheduleHeaderField("Pract Time"), "practice_time");
check("the start time", scheduleHeaderField("Race Time"), "race_time");
// Everything else on a SimRacerHub schedule describes a race already run.
for (const header of ["Pole", "Winner", "Race Results", "Can Drop", "Num Drivers", "Weather", "Distance or Time", "Track Type", ""]) {
  check(`“${header}” is not one of ours`, scheduleHeaderField(header), null);
}

// The four real header rows this was built against, each a different shape.
check("a plain schedule",
  mapScheduleHeaders(["Race", "Race Date", "Pts Count", "Car", "Event / Track", "Race Length", "Pole", "Winner", "Race Results"]),
  { round: 0, date: 1, points_count: 2, car: 3, event: 4, length: 5 });
check("one with session times and a driver count",
  mapScheduleHeaders(["Race", "Race Date", "Pract Time", "Race Time", "Car", "Num Drivers", "Event / Track", "Race Length", "Distance or Time", "Pole", "Winner", "Race Results"]),
  { round: 0, date: 1, practice_time: 2, race_time: 3, car: 4, event: 6, length: 7 });
// THE column trap: a Track Type column sits between Event / Track and Race
// Length, so counting would read a distance of "Road Course".
check("one with a Track Type column in the way",
  mapScheduleHeaders(["Race", "Race Date", "Pts Count", "Car", "Event / Track", "Track Type", "Race Length", "Distance or Time", "Pract Time", "Race Time", "Race Results", "Num Drivers", "Winner", "Pole"]),
  { round: 0, date: 1, points_count: 2, car: 3, event: 4, length: 6, practice_time: 8, race_time: 9 });
check("and one with everything switched on",
  mapScheduleHeaders(["Race", "Race Date", "Pts Count", "Car", "Event / Track", "Race Length", "Winner", "Race Results", "Can Drop", "Num Drivers", "Distance or Time", "Weather"]),
  { round: 0, date: 1, points_count: 2, car: 3, event: 4, length: 5 });

// ── 3. The dates ──────────────────────────────────────────────────────────

// A month name settles it, however the rest is arranged.
check("the usual format", readScheduleDate("Sep 10, 2024"), { iso: "2024-09-10" });
check("a weekday in front of it", readScheduleDate("Sunday June 21, 2026"), { iso: "2026-06-21" });
check("no comma", readScheduleDate("Wednesday Feb 4 2026"), { iso: "2026-02-04" });
check("day first", readScheduleDate("17 August 2026"), { iso: "2026-08-17" });
check("an ordinal", readScheduleDate("Aug 17th, 2026"), { iso: "2026-08-17" });
check("ISO", readScheduleDate("2026-08-17"), { iso: "2026-08-17" });
check("nothing date-shaped", readScheduleDate("Off Week"), null);
check("nor an empty cell", readScheduleDate(""), null);
check("nor an impossible date", readScheduleDate("Feb 45, 2026"), null);

// All numbers: one reading per league, decided for the page.
check("numbers are read but not yet resolved", readScheduleDate("17/08/2026"), { ambiguous: { a: 17, b: 8, year: 2026 } });

const reads = t => t.map(readScheduleDate);
// Evidence 1: a first number above 12 can only be a day, and one such row
// settles every other row on the page.
const kiwi = resolveDates(reads(["17/08/2026", "24/08/2026", "31/08/2026", "07/09/2026", "14/09/2026"]));
check("a day above 12 makes the whole page day-first", kiwi.order, "dmy");
check("…and every date reads off that", kiwi.dates, ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"]);
ok("…with nothing left in doubt", !kiwi.ambiguous);
const us = resolveDates(reads(["03/14/2026", "03/28/2026", "04/11/2026"]));
check("a second number above 12 makes it month-first", us.order, "mdy");
check("…and reads that way", us.dates, ["2026-03-14", "2026-03-28", "2026-04-11"]);

// Evidence 2: a schedule runs forwards, so the reading that climbs is the one.
const forwards = resolveDates(reads(["01/02/2026", "08/02/2026", "15/02/2026"]));
check("the reading that runs forwards wins", forwards.order, "dmy");
check("…giving a February the league would recognise", forwards.dates, ["2026-02-01", "2026-02-08", "2026-02-15"]);

// Evidence 3: none. A monthly series on the 8th reads either way, so it says so
// rather than quietly choosing.
const stuck = resolveDates(reads(["01/08/2026", "02/08/2026", "03/08/2026"]));
ok("an unprovable page is flagged", stuck.ambiguous);
check("…and read month-first, SimRacerHub's own default", stuck.dates, ["2026-01-08", "2026-02-08", "2026-03-08"]);

check("a page of month names needs no resolving", resolveDates(reads(["Sep 10, 2024", "Sep 17, 2024"])),
  { order: "unambiguous", dates: ["2024-09-10", "2024-09-17"], ambiguous: false });
check("an unreadable cell stays unreadable", resolveDates(reads(["Sep 10, 2024", "Off Week"])).dates, ["2024-09-10", null]);

// ── 4. The Event / Track cell ─────────────────────────────────────────────

check("an event name and its track",
  readEventCell("<div class='mb-1'><b>Stages 30/60/130</b></div><div><a href='config_stats.php?config_id=157'>Daytona International Speedway Oval</a></div>"),
  { off_week: false, event: "Stages 30/60/130", track: "Daytona International Speedway Oval", config_id: "157" });
check("a track on its own",
  readEventCell("<div><a href='config_stats.php?config_id=288'>Lime Rock Park Grand Prix</a></div>"),
  { off_week: false, event: "", track: "Lime Rock Park Grand Prix", config_id: "288" });
check("an event with no track linked",
  readEventCell("<div class='mb-1'><b>Australian Grand Prix @Melbourne (15.03.2015)</b></div>"),
  { off_week: false, event: "Australian Grand Prix @Melbourne (15.03.2015)", track: "", config_id: null });
check("an event name a league linked to its own site",
  readEventCell("<div class='mb-1'><a href='https://example.test/sim-x' target='_blank'><b>SLM Nashville SS</b></a></div><div><a href='config_stats.php?config_id=9'>Nashville Superspeedway</a></div>"),
  { off_week: false, event: "SLM Nashville SS", track: "Nashville Superspeedway", config_id: "9" });
check("an off week is not a race",
  readEventCell("<div class='text-secondary italic'>Off Week</div>"),
  { off_week: true, event: "", track: "", config_id: null });
check("a bare cell is the event's name",
  readEventCell("Race at dawn"),
  { off_week: false, event: "Race at dawn", track: "", config_id: null });

// ── 5. Round numbers ──────────────────────────────────────────────────────

check("a clean numbering is the league's own",
  numberRounds([{ round: 1 }, { round: 2 }, { round: 3 }]),
  { numbers: [1, 2, 3], renumbered: false });
// SimRacerHub leaves a playoff round unnumbered, and this app orders a season
// by that number — two races sharing one would order the season arbitrarily.
check("gaps are renumbered down the page",
  numberRounds([{ round: 1 }, { round: 2 }, { round: null }, { round: 3 }]),
  { numbers: [1, 2, 3, 4], renumbered: true });
check("so is a numbering that doesn't follow the dates",
  numberRounds([{ round: 1 }, { round: 16 }, { round: 15 }]),
  { numbers: [1, 2, 3], renumbered: true });
check("and so are repeats", numberRounds([{ round: 1 }, { round: 1 }]), { numbers: [1, 2], renumbered: true });
check("an empty schedule numbers nothing", numberRounds([]), { numbers: [], renumbered: true });

// ── 6. Distances, cars and start times ────────────────────────────────────

check("laps", readRaceLength("58 Laps"), { length_type: "laps", total_laps: 58 });
check("one lap", readRaceLength("1 Lap"), { length_type: "laps", total_laps: 1 });
check("a race to the clock", readRaceLength("0h 22m"), { length_type: "time", race_minutes: 22 });
check("…over an hour", readRaceLength("1h 25m"), { length_type: "time", race_minutes: 85 });
check("…in minutes", readRaceLength("45 mins"), { length_type: "time", race_minutes: 45 });
// The column a league fills with something else entirely.
check("a track type is not a distance", readRaceLength("Road Course"), null);
check("nor is an empty cell", readRaceLength(""), null);
check("nor is a distance run", readRaceLength("29.64 mi"), null);

check("a car drawn as a picture", readCarCell("<div><img src='images/car_186.png'></div>"), { ids: ["186"], names: [] });
check("…and named beside it",
  readCarCell("<div><img src='images/car_186.png'></div><div>BMW M2 Racing (G87)</div>"),
  { ids: ["186"], names: ["BMW M2 Racing (G87)"] });
check("a season racing three",
  readCarCell("<div><img src='images/car_115.png'></div><div><img src='images/car_116.png'></div><div><img src='images/car_117.png'></div>").ids,
  ["115", "116", "117"]);
check("no car at all", readCarCell(""), { ids: [], names: [] });

check("an evening start", readSessionTime("8:30 pm EDT"), { time: "20:30", zone: "America/New_York" });
check("a morning one", readSessionTime("11:00 am ET"), { time: "11:00", zone: "America/New_York" });
check("midnight", readSessionTime("12:00 am UTC"), { time: "00:00", zone: "UTC" });
check("a 24-hour clock", readSessionTime("20:15 CET"), { time: "20:15", zone: "Europe/Paris" });
check("the other side of the world", readSessionTime("7:30 pm NZDT"), { time: "19:30", zone: "Pacific/Auckland" });
// A zone this doesn't know is left blank rather than guessed — a wall-clock
// time in the wrong zone is worse than no time at all.
check("an unknown zone keeps the clock and drops the zone", readSessionTime("8:30 pm XYZ"), { time: "20:30", zone: "" });
check("no time in the cell", readSessionTime("TBA"), null);

// ── 7. A whole page, as SimRacerHub serves one ────────────────────────────

const page = `<!DOCTYPE html><html><body>
<div class='pageTitle row'><div class='col'>
<div class='dropdown lss-dropdown'><button class='dropdown-toggle bold' type='button'>Prodigy Racing Association</button><ul class='dropdown-menu'><li><a class='dropdown-item' href='league_series.php?league_id=5122'>Series</a></li></ul></div>
<div class='dropdown lss-dropdown my-2'><button class='dropdown-toggle' type='button'>Vision Corsa Indy Car Series</button><ul class='dropdown-menu'><li><a class='dropdown-item' href='series_seasons.php?series_id=12932'>Seasons</a></li></ul></div>
<div class='dropdown lss-dropdown'><button class='dropdown-toggle' type='button'>TNT IndyCar Series - Season 1</button><ul class='dropdown-menu'><li><a class='dropdown-item' href='season_schedule.php?season_id=25195'>Schedule</a></li></ul></div>
</div></div>
<table id='sched_table' class='jsTable' cellspacing='1'>
<tr class='jsTableHdr'><th>Race</th><th>Race<br>Date</th><th>Pts<br>Count</th><th>Car</th><th>Event / Track</th><th>Race<br>Length</th><th>Pract Time</th><th>Race Time</th><th>Winner</th></tr>
<tr class='bg-secondary-subtle' id='sch_304243'><td class='ctr'>1</td><td>Sep 10, 2024</td><td class='ctr'>Yes</td><td class='ctr'><div><img src='images/car_45.png'></div></td><td class='wrap'><div><a href='config_stats.php?config_id=288'>Lime Rock Park Grand Prix</a></div></td><td class='ctr'>60 Laps</td><td>8:30 pm EDT</td><td>9:00 pm EDT</td><td class='wrap'><a href='driver_stats.php?driver_id=1'>Cristian Zarate</a></td></tr>
<tr class='bg-secondary-subtle' id='sch_304244'><td class='ctr'>2</td><td>Sep 17, 2024</td><td class='ctr'>Yes</td><td class='ctr'><div><img src='images/car_45.png'></div></td><td class='wrap'><div class='mb-1'><b>Night Race</b></div><div><a href='config_stats.php?config_id=334'>Phoenix Raceway Oval w/open dogleg</a></div></td><td class='ctr'>140 Laps</td><td>8:30 pm EDT</td><td>9:00 pm EDT</td><td class='wrap'>&nbsp;</td></tr>
<tr class='bg-secondary-subtle' id='sch_304245'><td class='ctr'>&nbsp;</td><td>Sep 24, 2024</td><td class='ctr'>&nbsp;</td><td class='ctr'>&nbsp;</td><td class='wrap'><div class='text-secondary italic'>Off Week</div></td><td class='ctr'>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class='wrap'>&nbsp;</td></tr>
<tr class='bg-secondary-subtle' id='sch_304246'><td class='ctr'>3</td><td>Oct 8, 2024</td><td class='ctr'>No</td><td class='ctr'><div><img src='images/car_45.png'></div></td><td class='wrap'><div><a href='config_stats.php?config_id=361'>Indianapolis Motor Speedway Road Course</a></div></td><td class='ctr'>0h 45m</td><td>8:30 pm EDT</td><td>9:00 pm EDT</td><td class='wrap'>&nbsp;</td></tr>
</table>
</body></html>`;

check("the page says whose season it is", parseSrhSeasonNames(page),
  { league: "Prodigy Racing Association", series: "Vision Corsa Indy Car Series", season: "TNT IndyCar Series - Season 1" });

const parsed = parseSrhSchedule(page);
ok("a schedule page parses", !!parsed);
check("every row is read, off week included", parsed.rounds.length, 4);
check("…and the off week is marked as one", parsed.rounds.map(r => r.off_week), [false, false, true, false]);
check("the columns were found by name", parsed.mapping,
  { round: 0, date: 1, points_count: 2, car: 3, event: 4, length: 5, practice_time: 6, race_time: 7 });

// A page with no schedule table on it must not read as an empty season.
check("some other page of the site isn't a schedule", parseSrhSchedule("<html><body><table><tr><th>Driver</th><th>Points</th></tr></table></body></html>"), null);
check("nothing at all isn't either", parseSrhSchedule(""), null);

const plan = srhSchedulePlan(parsed, { carNames: { 45: "[Legacy] Dallara DW12" } });
check("the off week is not a race", plan.races.length, 3);
check("…and is counted so the admin knows why", plan.off_weeks, 1);
check("the season is named as SimRacerHub names it", plan.season.name, "TNT IndyCar Series - Season 1");
// Every round on one car is the SEASON's car, which is how this app is set up —
// the per-race field then means "this one is different".
check("one car all season belongs to the season", plan.season.car, "[Legacy] Dallara DW12");
check("…so no race overrides it", plan.races.map(r => r.car), ["", "", ""]);
check("where it came from travels with it", plan.source,
  { league: "Prodigy Racing Association", series: "Vision Corsa Indy Car Series", season: "TNT IndyCar Series - Season 1" });

check("the first round, whole", plan.races[0], {
  name: "Lime Rock Park Grand Prix",
  round_number: 1,
  date: "2024-09-10",
  track: "Lime Rock Park Grand Prix",
  car: "",
  length_type: "laps",
  total_laps: 60,
  sessions: ["Race"],
  show_session_times: true,
  session_timezone: "America/New_York",
  session_times: { practice: "20:30", race: "21:00" },
});
// The league's own name for a round wins over the track's.
check("a named event keeps its name", plan.races[1].name, "Night Race");
check("…and still races at its track", plan.races[1].track, "Phoenix Raceway Oval w/open dogleg");
// "Pts Count: No" is this app's championship-points switch for the session.
check("a round that scores nothing says so", plan.races[2].session_points_enabled, { Race: false });
check("…while the ones that do score carry no switch at all",
  plan.races.slice(0, 2).map(r => r.session_points_enabled), [undefined, undefined]);
check("a race to the clock keeps its clock",
  [plan.races[2].length_type, plan.races[2].race_minutes], ["time", 45]);
check("the rounds are numbered past the off week", plan.races.map(r => r.round_number), [1, 2, 3]);
check("every venue is listed once", plan.tracks.length, 3);
check("nothing needed a warning", plan.warnings, []);

// The naming rules on their own.
check("a league's event name is used", roundName({ event: "Coca-Cola 600", track: "Charlotte" }, 0), "Coca-Cola 600");
// Some leagues put the round number in the event field, which is no name at all.
check("a number is not a name", roundName({ event: "7", track: "Lincoln Speedway" }, 6), "Lincoln Speedway");
check("the track does the job when there's no event", roundName({ event: "", track: "Talladega Superspeedway" }, 0), "Talladega Superspeedway");
check("and with neither, the round is all there is", roundName({ event: "", track: "" }, 4), "Race 5");
check("…using SimRacerHub's own number when it has one", roundName({ event: "", track: "", round: 9 }, 4), "Race 9");

// A round missing what a race needs says so rather than importing silently.
const thin = parseSrhSchedule(page.replace("<td class='ctr'>60 Laps</td>", "<td class='ctr'>&nbsp;</td>")
  .replace("<div><a href='config_stats.php?config_id=288'>Lime Rock Park Grand Prix</a></div>", "<div><b>Mystery Round</b></div>"));
const thinPlan = srhSchedulePlan(thin);
check("a round with no track and no distance is flagged",
  thinPlan.rows[0].warnings, ["No track", "No race length"]);
ok("…and is still imported, for the admin to finish",
  thinPlan.races[0].name === "Mystery Round" && thinPlan.races.length === 3);

// ── 7b. SimRacerHub's own track directory ──────────────────────
//
// A schedule names the LAYOUT raced, in one string with no seam in it: "Lime
// Rock Park Grand Prix" is the Grand Prix layout of Lime Rock Park, and nothing
// in the name says where the venue stops. SimRacerHub's Tracks page is the
// seam, and it also carries iRacing's own logo for each venue, so a track this
// import creates arrives looking like the place rather than like a blank row.
//
// Markup below is copied from the live page.
const directoryPage = `<html><body><table id='jsTable'>
<tr class='jsTableRow' id='trk_168'><td class='wrap ctr'><b><a href='https://adelaidegrandfinal.com.au/' title='https://adelaidegrandfinal.com.au/' target='_blank'>Adelaide Street Circuit</b></a></td><td class='ctr'><a href='http://maps.google.com/maps?hl=en&t=k&ie=UTF8&output=embed&ll=-34.93,138.62&z=15' target='track_map'><img src='images/map.png'></a></td><td class='ctr'><img src='https://images-static.iracing.com/img/logos/tracks/538__light.png' alt='Adelaide Street Circuit' class='track-logo-light' style='max-width: 100%; max-height: 50px'><img src='https://images-static.iracing.com/img/logos/tracks/538__dark.png' alt='Adelaide Street Circuit' class='track-logo-dark' style='max-width: 100%; max-height: 50px'></td><td class='ctr'>No</td><td class='ctr'>1</td><td class='ctr'>128</td><td class='ctr'>163</td></tr>
<tr class='jsTableRow' id='trk_31'><td class='wrap ctr'><b><a href='http://www.charlottemotorspeedway.com/' target='_blank'>Charlotte Motor Speedway</b></a></td><td class='ctr'><a href='http://maps.google.com/maps?ll=35.352,-80.683&z=15' target='track_map'><img src='images/map.png'></a></td><td class='ctr'><img src='https://images-static.iracing.com/img/logos/tracks/31__light.png' alt='Charlotte Motor Speedway' class='track-logo-light'><img src='https://images-static.iracing.com/img/logos/tracks/31__dark.png' class='track-logo-dark'></td><td class='ctr'>No</td><td class='ctr'>9</td></tr>
<tr class='jsTableRow' id='trk_304'><td class='wrap ctr'><b>Lime Rock Park</b></td><td class='ctr'><img src='images/map.png'></td><td class='ctr'><img src='https://images-static.iracing.com/img/logos/tracks/304__light.png' class='track-logo-light'></td><td class='ctr'>No</td><td class='ctr'>4</td></tr>
</table></body></html>`;

const directory = parseSrhTrackDirectory(directoryPage);
check("every venue on the page, once", directory.map(t => t.name),
  ["Adelaide Street Circuit", "Charlotte Motor Speedway", "Lime Rock Park"]);
check("…each with iRacing's own logo for it",
  directory.map(t => t.logo_url),
  ["https://images-static.iracing.com/img/logos/tracks/538__light.png",
    "https://images-static.iracing.com/img/logos/tracks/31__light.png",
    "https://images-static.iracing.com/img/logos/tracks/304__light.png"]);
// The row prints a light logo and a dark one and a map pin, and the light logo
// is found by what it IS rather than by which cell it sits in — a row that has
// lost a cell would otherwise hand a venue the map pin as its logo.
ok("the map pin is never mistaken for a logo",
  !directory.some(t => /images\/map\.png/.test(t.logo_url)));
check("a venue with no logo at all is still a venue",
  parseSrhTrackDirectory("<tr class='jsTableRow'><td><b>Backyard Oval</b></td><td></td></tr>"),
  [{ name: "Backyard Oval", logo_url: "" }]);
check("a row with no name is no venue",
  parseSrhTrackDirectory("<tr class='jsTableRow'><td>&nbsp;</td><td><img src='https://x/y.png' class='track-logo-light'></td></tr>"), []);
check("some other page of the site is not a directory", parseSrhTrackDirectory("<html><body><p>Nope</p></body></html>"), []);
check("and an unreadable one costs the import nothing", parseSrhTrackDirectory(null), []);

// What the schedule's layout names resolve to, keyed by the name exactly as the
// schedule wrote it — which is the key the review table and the admin's answers
// both use.
const info = srhTrackInfo([
  "Charlotte Motor Speedway Roval 2019", "Lime Rock Park Grand Prix",
  "Adelaide Street Circuit", "Somewhere Nobody Races", "  ",
], directory);
check("a layout resolves to the venue behind it",
  info["Charlotte Motor Speedway Roval 2019"],
  { base: "Charlotte Motor Speedway", logo_url: "https://images-static.iracing.com/img/logos/tracks/31__light.png" });
check("a venue that names no layout resolves to itself",
  info["Adelaide Street Circuit"].base, "Adelaide Street Circuit");
check("a name the directory has never heard of gets nothing rather than a guess",
  info["Somewhere Nobody Races"], { base: "", logo_url: "" });
check("and a blank cell isn't looked up at all", Object.keys(info),
  ["Charlotte Motor Speedway Roval 2019", "Lime Rock Park Grand Prix", "Adelaide Street Circuit", "Somewhere Nobody Races"]);
check("nothing to look up looks nothing up", srhTrackInfo(null, directory), {});
check("and with no directory, every name is simply unknown",
  srhTrackInfo(["Lime Rock Park Grand Prix"]), { "Lime Rock Park Grand Prix": { base: "", logo_url: "" } });

// ── 8. What writes, and what may not ──────────────────────────────────────
//
// This is the one importer in the app that CREATES rows rather than filling a
// form, so the rules about it are the rules about that: a preview writes
// nothing, the write goes through the same field allowlist a single New Race
// does, and the whole feature is iRacing-only — enforced on the server, not
// just hidden in the button.
const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
const route = read("app/api/import-srh-season/route.js");
const modal = read("components/SrhSeasonImportModal.jsx");
const newSeason = read("components/SeasonCreateModal.jsx");
const leagueSetup = read("app/admin/page.js");

ok("the route is gated on a staff role", /withAdmin\(/.test(route));
ok("…and refuses a series that isn't under an iRacing game", /isIracingGame\(game\?\.name\)/.test(route));
ok("…before it reads anything at all",
  route.indexOf("isIracingGame(game?.name)") < route.indexOf("await srhFetchText"));
ok("…and refuses a series from another league", /belongs to another league/.test(route));
// The preview must answer before any write, so the branch returning it comes
// first and there is nothing above it that could add a row.
const previewAt = route.indexOf("if (preview) {");
const writeAt = route.indexOf("// ── Write it");
ok("the preview answers before the write", previewAt > 0 && writeAt > previewAt);
ok("…and nothing is added above it", !/\.add\(|batch\.set\(/.test(route.slice(0, previewAt)));
ok("every race is validated by the same rules a single one is",
  /buildEntityDoc\(\{\s*spec: SPECS\.races/.test(route.replace(/\n\s*/g, " ")));
ok("…and so is the season", /spec: SPECS\.seasons/.test(route.replace(/\n\s*/g, " ")));
ok("…and every track it creates", /spec: SPECS\.tracks/.test(route.replace(/\n\s*/g, " ")));
ok("where the request may go is decided by parseSrhSeasonRef and nothing else",
  /const ref = parseSrhSeasonRef\(input\)/.test(route) && route.match(/srhFetchText\(/g).length === 1);
ok("a season's worth of races is written in batches", /batch\.commit\(\)/.test(route));

ok("the importer reads before it creates", /preview: true/.test(modal));
ok("…and creates only on a second press", /Create season &/.test(modal));
ok("…offering only iRacing games", /games\.filter\(g => isIracingGame\(g\.name\)\)/.test(modal));

ok("the New Season dialog offers it", /Import a season from SimRacerHub/.test(newSeason));
ok("…to iRacing leagues only", /const iracingHere = gameId/.test(newSeason));
ok("League Setup's Seasons panel offers it too", /Import a season from SimRacerHub/.test(leagueSetup));
ok("…to an iRacing game only", /\{iracingGame && seriesId &&/.test(leagueSetup));

console.log(`srhSchedule: ${n} assertions passed`);
