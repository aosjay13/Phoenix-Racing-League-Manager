// A season's schedule, pasted out of a spreadsheet.
//
// SimRacerHub scores iRacing and nothing else, so every other league was still
// building next season a round at a time — retyping dates and tracks already
// sitting in a sheet somebody made months ago. Selecting that sheet and pasting
// it is now the whole import, and this is the reading of it.
//
// The reading is the only genuinely new part: everything after it — the round
// numbering, the race documents, the venue matching, the review table — is what
// the SimRacerHub importer already uses, because this hands back the SAME shape
// parseSrhSchedule does. So what has to be right here is narrow and sharp:
//
//   1. WHICH COLUMN IS WHICH. A spreadsheet header is whatever a human typed.
//      "Race" means the round number; "Race Name" means the name; "Total Race
//      Laps" is a distance and contains both words. Getting that order wrong
//      silently files a round number as an event name.
//   2. WHICH ROWS ARE ROUNDS. A sheet ends with "Total Laps = 310", and it is
//      not round nine. Neither is the blank spacer above it.
//   3. THE DATES. 10/30/2023 is October; 8/11/2023 could be either month, and
//      only the table as a whole can say. Same reader and same rule as a
//      SimRacerHub schedule — this must not grow a second opinion.
//   4. NOTHING VANISHES. Every row not read as a round is named, with why.
import assert from "node:assert";
import { mapPastedHeaders, parsePastedSchedule, pastedHeaderField, seasonNameFrom } from "../pastedSchedule.js";
import { srhSchedulePlan } from "../srhSchedule.js";
import { initialTrackChoices, trackChoiceProblems } from "../scheduleReview.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── The sheet in the request, pasted verbatim ─────────────────────────────

const REAL = [
  "2023 Season 1 Schedule\t\t\t",
  "Race\tDates\tTrack\tTotal Race Laps",
  "1\t10/30/2023\tDaytona Oval\t50",
  "2\t11/6/2023\tRoad America\t18",
  "3\t11/13/2023\tFontana\t50",
  "4\t11/20/2023\tIndy Road Course\t27",
  "5\t11/27/2023\tGateway\t60",
  "6\t12/4/2023\tWatkins Glen\t35",
  "7\t12/11/2023\tIndy Oval\t50",
  "8\t12/18/2023\tDaytona NASCAR Road Course\t20",
  "\t\tTotal Laps =\t310",
].join("\n");

const real = parsePastedSchedule(REAL);
ok("the sheet reads as a schedule", !!real);
check("the title line becomes the season's name", real.title, "2023 Season 1");
check("every column is placed", real.mapping, { round: 0, date: 1, track: 2, laps: 3 });
check("…and eight rounds come out of it", real.rounds.length, 8);
check("the totals line is not round nine", real.rounds.map(r => r.track).includes("Total Laps ="), false);
check("…and is named, with why", real.skipped, [{ text: "Total Laps = 310", reason: "a total, not a round" }]);
check("the dates read as the month/day they are", real.rounds.map(r => r.date), [
  "2023-10-30", "2023-11-06", "2023-11-13", "2023-11-20",
  "2023-11-27", "2023-12-04", "2023-12-11", "2023-12-18",
]);
check("…with nothing to warn about", real.warnings, []);
check("the round numbers are the league's own", real.rounds.map(r => r.round), [1, 2, 3, 4, 5, 6, 7, 8]);
check("a bare number in a Laps column is a lap count", real.rounds[0].length, { length_type: "laps", total_laps: 50 });

// …and the whole thing through the planner the SimRacerHub importer uses, which
// is the point of matching its shape: the season and the races fall out of it.
{
  const plan = srhSchedulePlan(real);
  check("the planner names the season", plan.season.name, "2023 Season 1");
  check("…and builds eight races", plan.races.length, 8);
  check("…each named for where it runs", plan.races[0].name, "Daytona Oval");
  check("…on the date it runs", plan.races[0].date, "2023-10-30");
  check("…for the distance it runs", [plan.races[0].length_type, plan.races[0].total_laps], ["laps", 50]);
  check("…with one Race session, as a schedule describes", plan.races[0].sessions, ["Race"]);
  check("…and every venue listed for checking", plan.tracks.length, 8);
  check("no round warns about anything", plan.rows.flatMap(r => r.warnings), []);
}

// ── 1. Which column is which ──────────────────────────────────────────────

check("a bare Race column is the round number", pastedHeaderField("Race"), "round");
check("…and so is Rd", pastedHeaderField("Rd"), "round");
check("…and Round", pastedHeaderField("Round #"), "round");
check("…and a bare #", pastedHeaderField("#"), "round");
// THE collision: both words are in it, and it is a distance.
check("Total Race Laps is a distance, not a round", pastedHeaderField("Total Race Laps"), "laps");
check("Race Name is a name, not a round", pastedHeaderField("Race Name"), "name");
check("Event is a name", pastedHeaderField("Event"), "name");
check("Dates is a date", pastedHeaderField("Dates"), "date");
check("Circuit is a track", pastedHeaderField("Circuit"), "track");
check("Venue is a track", pastedHeaderField("Venue"), "track");
check("Minutes is a duration", pastedHeaderField("Minutes"), "minutes");
check("Race Length is a length", pastedHeaderField("Race Length"), "length");
check("a column nothing matches is left alone", pastedHeaderField("Broadcast"), null);
check("and so is an empty one", pastedHeaderField(""), null);
// First column to claim a field keeps it, so a second "Track" can't steal it.
check("the first column to claim a field keeps it",
  mapPastedHeaders(["Race", "Track", "Circuit"]), { round: 0, track: 1 });

// ── 2. Which rows are rounds ──────────────────────────────────────────────
//
// A row says either where it sits in the season or when it was run. One rule,
// and it throws out the totals, the spacers and the note at the bottom without
// needing a list of the words people put in them.
{
  const messy = parsePastedSchedule([
    "Round,Date,Track,Laps",
    "1,3/1/2026,Bristol,100",
    ",,,",
    "2,3/8/2026,Martinsville,200",
    ",,Total Laps =,300",
    ",,Remember to check tyre rules,",
  ].join("\n"));
  check("the rounds are the rows that say when or where", messy.rounds.length, 2);
  check("…and everything else is named", messy.skipped.map(s => s.text),
    ["Total Laps = 300", "Remember to check tyre rules"]);
  check("…a blank row isn't even mentioned, it is just blank", messy.skipped.length, 2);
  check("a total is called a total", messy.skipped[0].reason, "a total, not a round");
  check("…and a stray note is called what it is", messy.skipped[1].reason, "no round number and no date");
}

// A round with a date but no number is still a round — plenty of sheets don't
// number them.
{
  const unnumbered = parsePastedSchedule([
    "Date\tTrack\tLaps",
    "3/1/2026\tBristol\t100",
    "3/8/2026\tMartinsville\t200",
  ].join("\n"));
  check("a sheet that doesn't number its rounds still reads", unnumbered.rounds.length, 2);
  check("…and the planner numbers them down the page",
    srhSchedulePlan(unnumbered).races.map(r => r.round_number), [1, 2]);
}

// An off week holds a place on a calendar and is not an event.
{
  const withBye = parsePastedSchedule([
    "Race,Date,Track,Laps",
    "1,3/1/2026,Bristol,100",
    "2,3/8/2026,OFF WEEK,",
    "3,3/15/2026,Martinsville,200",
  ].join("\n"));
  check("an off week is marked, not raced", withBye.off_weeks, 1);
  check("…and the planner leaves it out", srhSchedulePlan(withBye).races.length, 2);
}

// ── 3. The dates ──────────────────────────────────────────────────────────

// The whole paste decides the order, not each row. A 30 in the second position
// can only be a day, which settles every other row with it.
{
  const dmy = parsePastedSchedule([
    "Race\tDate\tTrack",
    "1\t17/08/2026\tBrands Hatch",
    "2\t24/08/2026\tOulton Park",
  ].join("\n"));
  check("a day above 12 settles the whole table as day-first",
    dmy.rounds.map(r => r.date), ["2026-08-17", "2026-08-24"]);
  check("…with no doubt about the order to report",
    dmy.warnings.some(w => /which number is the month/.test(w)), false);
}
{
  const ambiguous = parsePastedSchedule([
    "Race\tDate\tTrack",
    "1\t08/11/2026\tBristol",
    "2\t09/12/2026\tMartinsville",
  ].join("\n"));
  check("a table that can't prove its order is read month-first",
    ambiguous.rounds.map(r => r.date), ["2026-08-11", "2026-09-12"]);
  ok("…and says so rather than choosing quietly",
    ambiguous.warnings.some(w => /which number is the month/.test(w)));
}
// A month by name needs no table to settle it.
{
  const named = parsePastedSchedule([
    "Race\tDate\tTrack",
    "1\tMar 1, 2026\tBristol",
    "2\t8 March 2026\tMartinsville",
  ].join("\n"));
  check("a month written in words is read as itself",
    named.rounds.map(r => r.date), ["2026-03-01", "2026-03-08"]);
}

// ── Delimiters, because a paste is whatever the clipboard held ────────────

for (const [label, text] of [
  ["tabs", "Race\tDate\tTrack\tLaps\n1\t3/1/2026\tBristol\t100"],
  ["commas", "Race,Date,Track,Laps\n1,3/1/2026,Bristol,100"],
  ["aligned spaces", "Race   Date       Track     Laps\n1      3/1/2026   Bristol   100"],
]) {
  const parsed = parsePastedSchedule(text);
  check(`a schedule separated by ${label} reads`, parsed?.rounds?.length, 1);
  check(`…with the track intact (${label})`, parsed.rounds[0].track, "Bristol");
  check(`…and the distance (${label})`, parsed.rounds[0].length, { length_type: "laps", total_laps: 100 });
}

// Minutes, for the leagues that race to a clock rather than a distance.
{
  const timed = parsePastedSchedule("Race,Date,Track,Minutes\n1,3/1/2026,Spa,45");
  check("a Minutes column is a clock, not laps", timed.rounds[0].length, { length_type: "time", race_minutes: 45 });
}
{
  const written = parsePastedSchedule("Race,Date,Track,Race Length\n1,3/1/2026,Spa,1h 30m");
  check("a length written out is read", written.rounds[0].length, { length_type: "time", race_minutes: 90 });
}

// ── 4. What isn't a schedule ──────────────────────────────────────────────

check("nothing is not a schedule", parsePastedSchedule(""), null);
check("neither is whitespace", parsePastedSchedule("   \n\t\n"), null);
check("nor a sentence", parsePastedSchedule("here is our schedule for next year"), null);
// One recognised header is a coincidence, not a header row.
check("one recognised column is not a header row",
  parsePastedSchedule("Track\nBristol\nMartinsville"), null);
// Columns with nowhere to put a date, a track or a name aren't a schedule this
// app can build a season from.
check("a table with no date, track or name is refused",
  parsePastedSchedule("Race,Laps\n1,100\n2,200"), null);

// ── Warnings, where a column simply wasn't there ──────────────────────────
{
  const noTrack = parsePastedSchedule("Race,Date,Event\n1,3/1/2026,Season Opener");
  ok("a schedule with no track column says so",
    noTrack.warnings.some(w => /no track column/i.test(w)));
  ok("…and one with no distance says that too",
    noTrack.warnings.some(w => /race length column/i.test(w)));
  check("…but it still imports, named from its Event column",
    srhSchedulePlan(noTrack).races[0].name, "Season Opener");
}
{
  const badDate = parsePastedSchedule("Race,Date,Track\n1,3/1/2026,Bristol\n2,sometime,Martinsville");
  check("a date nobody can read leaves the round dateless", badDate.rounds[1].date, "");
  ok("…and is counted in a warning", badDate.warnings.some(w => /1 round had no date/.test(w)));
}

// ── The season's name ─────────────────────────────────────────────────────

check("a trailing “Schedule” is not part of the name", seasonNameFrom("2023 Season 1 Schedule"), "2023 Season 1");
check("…nor is “Calendar”", seasonNameFrom("2026 Calendar"), "2026");
check("a name that is only the word is kept whole", seasonNameFrom("Schedule"), "Schedule");
check("a name with no suffix is left alone", seasonNameFrom("Winter Series 2026"), "Winter Series 2026");
check("and nothing stays nothing", seasonNameFrom(""), "");

// ── The venue answers, shared with the SimRacerHub importer ───────────────
//
// Both review tables draw their warnings from this and both Create buttons are
// gated on it, so the two can never disagree about whether an import is ready.
// Wrong in either direction shows up only afterwards: too strict and a season
// can't be created, too loose and a season's races point at a venue nobody
// confirmed — or two venues are created under one name, which is the duplicate
// the whole check exists to prevent.
const venues = [
  { raw: "Bristol", status: "matched", track_id: "t1", suggested_name: "Bristol", suggested_type: "Oval" },
  { raw: "Martinsville Speedway", status: "suggested", track_id: "t2", suggested_name: "Martinsville", suggested_type: "Oval" },
  { raw: "Nowhere Park", status: "new", track_id: null, suggested_name: "Nowhere Park", suggested_type: "" },
];

{
  const start = initialTrackChoices(venues);
  check("a confident match starts as the track you have", start.Bristol, { action: "use", track_id: "t1" });
  check("…and everything else starts as one to create",
    start["Martinsville Speedway"], { action: "create", name: "Martinsville", track_type: "Oval" });
  check("those answers are complete", trackChoiceProblems(venues, start).ready, true);
}

{
  // Two venues created under one name is the duplicate this exists to stop.
  const clash = {
    ...initialTrackChoices(venues),
    "Martinsville Speedway": { action: "create", name: "Nowhere Park" },
  };
  const problems = trackChoiceProblems(venues, clash);
  check("two venues under one name is refused", problems.ready, false);
  check("…and the name is named", [...problems.duplicateNames], ["nowhere park"]);
}

{
  const blank = { ...initialTrackChoices(venues), "Nowhere Park": { action: "create", name: "  " } };
  check("a new venue with no name is refused", trackChoiceProblems(venues, blank).ready, false);
  check("…and is named", trackChoiceProblems(venues, blank).unnamed.map(t => t.raw), ["Nowhere Park"]);
}

{
  // "Use one I already have" with none picked must never fall through to
  // creating something — see applyTrackDecisions.
  const unpicked = { ...initialTrackChoices(venues), "Nowhere Park": { action: "use", track_id: "" } };
  const problems = trackChoiceProblems(venues, unpicked);
  check("pointing at a track without picking one is refused", problems.ready, false);
  check("…and is named", problems.unanswered.map(t => t.raw), ["Nowhere Park"]);
}

check("a schedule racing nowhere new is ready at once", trackChoiceProblems([], {}).ready, true);

console.log(`pastedSchedule: ${n} checks passed`);
