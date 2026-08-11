// The calendar's arithmetic. The invariant that matters most:
//
//   an event lands in the square for the date the admin typed — in every
//   timezone, in every month, including the ones the grid pads from its
//   neighbours.
//
// That's the same bug lib/raceDate.js exists to kill (a bare `YYYY-MM-DD` read
// as UTC midnight renders a day early west of Greenwich), so the grid is built
// from local date fields and every cell carries its own date string.
import assert from "node:assert";
import {
  buildMonthGrid, eventPillLabel, eventTitle, groupRacesByDate, initialMonth,
  isoOf, monthLabel, monthOf, monthsWithRaces, seriesAbbrev, shiftMonth,
} from "../calendar.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ── 1. A month is whole weeks, padded from its neighbours ─────────────────
// August 2026 starts on a Saturday and has 31 days: 6 lead-in days from July,
// 31 of its own, and 5 trailing days from September = 42 cells (6 weeks).
{
  const cells = buildMonthGrid(2026, 7, "2026-08-11");
  check("august 2026: whole weeks", cells.length % 7, 0);
  check("august 2026: six weeks", cells.length, 42);
  check("august 2026: starts on the Saturday before", cells[0].iso, "2026-07-26");
  check("august 2026: its own days", cells.filter(c => c.inMonth).length, 31);
  check("august 2026: first of the month", cells.find(c => c.inMonth).iso, "2026-08-01");
  check("august 2026: last of the month", cells.filter(c => c.inMonth).pop().iso, "2026-08-31");
  check("august 2026: today is marked once", cells.filter(c => c.isToday).length, 1);
  check("august 2026: today is the 11th", cells.find(c => c.isToday).iso, "2026-08-11");
}

// ── 2. February in a leap year keeps its 29th ────────────────────────────
{
  const cells = buildMonthGrid(2028, 1, "2028-01-01");
  check("feb 2028 is a leap February", cells.filter(c => c.inMonth).length, 29);
  check("feb 2028: no day is marked today", cells.some(c => c.isToday), false);
}

// A February that fills exactly four weeks still pads to whole weeks and
// nothing else — 2027's starts on a Monday, so it leads in with one January day.
{
  const cells = buildMonthGrid(2027, 1, "2027-02-01");
  check("feb 2027: whole weeks", cells.length % 7, 0);
  check("feb 2027: its own days", cells.filter(c => c.inMonth).length, 28);
}

// ── 3. Every cell's date string is its own local date ────────────────────
// Nothing here goes near toISOString(), which is what would slide a day.
{
  const cells = buildMonthGrid(2026, 0, "2026-08-11");
  check("january 2026: cells are consecutive", cells.every((c, i) => {
    if (i === 0) return true;
    const prev = new Date(`${cells[i - 1].iso}T00:00:00`);
    const here = new Date(`${c.iso}T00:00:00`);
    return (here - prev) === 86400000;
  }), true);
  check("isoOf reads local fields", isoOf(new Date(2026, 0, 1)), "2026-01-01");
  check("december rolls the year forward", shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  check("january rolls the year back", shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  check("month label", monthLabel(2026, 7), "August 2026");
  check("monthOf a race date", monthOf("2026-08-11"), { year: 2026, month: 7 });
  check("monthOf a full timestamp", monthOf("2026-08-11T18:30:00Z"), { year: 2026, month: 7 });
  check("monthOf nothing", monthOf(""), null);
}

// ── 4. Events land on their day, in round order, and undated ones survive ─
{
  const races = [
    { id: "b", date: "2026-08-11", round_number: 2, name: "Round 2" },
    { id: "a", date: "2026-08-11", round_number: 1, name: "Round 1" },
    { id: "c", date: "2026-09-01", round_number: 3, name: "Round 3" },
    { id: "d", date: "", round_number: 4, name: "Round 4" },
    { id: "e", date: null, round_number: 5, name: "Round 5" },
  ];
  const { byDate, undated } = groupRacesByDate(races);
  check("two events on the 11th", byDate["2026-08-11"].map(r => r.id), ["a", "b"]);
  check("one on 1 September", byDate["2026-09-01"].map(r => r.id), ["c"]);
  check("undated events are kept, not dropped", undated.map(r => r.id), ["d", "e"]);
  check("no phantom days", Object.keys(byDate).sort(), ["2026-08-11", "2026-09-01"]);

  check("months with racing", monthsWithRaces(races).map(m => m.key), ["2026-08", "2026-09"]);
  check("months carry their count", monthsWithRaces(races).map(m => m.count), [2, 1]);
}

// ── 5. The calendar opens where the racing is ────────────────────────────
{
  const races = [{ date: "2026-03-07" }, { date: "2026-03-21" }, { date: "2026-06-13" }];
  check("this month, when it has races", initialMonth(races, "2026-03-15"), { year: 2026, month: 2 });
  check("else the next month that does", initialMonth(races, "2026-04-02"), { year: 2026, month: 5 });
  check("else the last one that did", initialMonth(races, "2026-11-02"), { year: 2026, month: 5 });
  check("no races at all: this month", initialMonth([], "2026-11-02"), { year: 2026, month: 10 });
  check("undated races don't pick a month", initialMonth([{ date: "" }], "2026-11-02"), { year: 2026, month: 10 });
}

// ── 6. Series abbreviations stay readable ───────────────────────────────
check("initials", seriesAbbrev("Phoenix Grand Touring"), "PGT");
check("a word with a digit stays whole", seriesAbbrev("Phoenix GT3 Championship"), "PGT3C");
check("a single word is truncated, not initialled", seriesAbbrev("Endurance"), "ENDUR");
check("a short single word is left alone", seriesAbbrev("Cup"), "CUP");
check("filler words are dropped", seriesAbbrev("The Best of the Rest"), "BR");
check("punctuation is a separator", seriesAbbrev("Xfinity — East"), "XE");
check("nothing in, nothing out", seriesAbbrev(""), "");
check("nothing in, nothing out (null)", seriesAbbrev(null), "");

// ── 7. A pill says where the racing is ──────────────────────────────────
check("the track is the point", eventPillLabel({ name: "Round 4", track: "Watkins Glen" }), "Watkins Glen");
check("the event name is the fallback", eventPillLabel({ name: "Round 4", track: "" }), "Round 4");
check("something is always shown", eventPillLabel({}), "Race");
check("the tooltip carries the context",
  eventTitle({ name: "Round 4", track: "Watkins Glen", series_name: "GT Cup", season_name: "2026" }),
  "Round 4 · Watkins Glen — GT Cup · 2026");
check("the tooltip copes with a bare event", eventTitle({ name: "Round 4" }), "Round 4");

console.log(`all ${n} checks passed — every event lands on the day it was scheduled for`);
