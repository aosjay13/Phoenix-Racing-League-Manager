// The cross-season Schedule feed ("All Games" / "All Series"). What it has to
// get right:
//
//   1. Upcoming is soonest FIRST and holds only racing that is actually still
//      to come — the day hasn't passed;
//   2. Archive is most recent FIRST;
//   3. a round whose day has been and gone belongs to the archive even if
//      nobody ever entered its results. Leaving it in Upcoming is what made the
//      feed look unsorted: soonest-first put a two-season-old round at the very
//      top, and the per-section cap could push the real upcoming racing off the
//      bottom of the table entirely.
import assert from "node:assert";
import {
  FEED_LIMIT, byDateAscending, byDateDescending, isArchived, splitScheduleFeed,
} from "../scheduleFeed.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const TODAY = "2026-08-12";
const race = (id, date, opts = {}) => ({
  id, date, name: opts.name ?? id, round_number: opts.round ?? 1,
  summary: { has_results: !!opts.results },
});

// ── 1. Which half an event belongs to ─────────────────────────────────────
check("a future race is still to come", isArchived(race("a", "2026-09-01"), TODAY), false);
check("today's race is still to come", isArchived(race("a", TODAY), TODAY), false);
check("yesterday's race is history", isArchived(race("a", "2026-08-11"), TODAY), true);
// The load-bearing one: the day has passed and no sheet was ever entered. It is
// history with a gap in it, not something still on the calendar.
check("a past race nobody entered results for is STILL history",
  isArchived(race("a", "2024-05-05"), TODAY), true);
// Results before the day is out (an admin entering the sheet that evening, or a
// race dated slightly ahead of when it ran) still read as run.
check("results already in makes it history whatever the date says",
  isArchived(race("a", "2026-09-01", { results: true }), TODAY), true);
check("an undated race is still to come", isArchived(race("a", ""), TODAY), false);
check("an undated race WITH results is history", isArchived(race("a", "", { results: true }), TODAY), true);

// ── 2. Upcoming: soonest first, undated last ─────────────────────────────
{
  const rows = [
    race("sep", "2026-09-01"),
    race("today", TODAY),
    race("tba", ""),
    race("aug20", "2026-08-20"),
    race("oct", "2026-10-15"),
  ];
  const { upcoming } = splitScheduleFeed(rows, TODAY);
  check("soonest first, undated last", upcoming.map(r => r.id), ["today", "aug20", "sep", "oct", "tba"]);
}

// ── 3. Archive: most recent first, undated last ──────────────────────────
{
  const rows = [
    race("jan", "2026-01-10", { results: true }),
    race("jul", "2026-07-04", { results: true }),
    race("undated", "", { results: true }),
    race("aug", "2026-08-01", { results: true }),
  ];
  const { archive } = splitScheduleFeed(rows, TODAY);
  check("most recent first, undated last", archive.map(r => r.id), ["aug", "jul", "jan", "undated"]);
}

// ── 4. The bug this file exists for ──────────────────────────────────────
// A league two seasons in, where a handful of old rounds never got a results
// sheet. Before the fix, every one of those sat in Upcoming — and since
// Upcoming is soonest-first, 2024 was the top of the table.
{
  const rows = [
    race("old-unentered-1", "2024-03-02"),
    race("old-unentered-2", "2024-04-06"),
    race("last-week", "2026-08-05", { results: true }),
    race("next-sunday", "2026-08-16"),
    race("the-one-after", "2026-08-23"),
    race("old-entered", "2025-06-01", { results: true }),
  ];
  const { upcoming, archive } = splitScheduleFeed(rows, TODAY);
  check("Upcoming holds only racing still to come",
    upcoming.map(r => r.id), ["next-sunday", "the-one-after"]);
  check("...starting with the very next race", upcoming[0].id, "next-sunday");
  // Strictly by date, newest first — an unentered round takes its place in the
  // history by the day it ran, not behind everything that has a results sheet.
  check("the unentered old rounds are in the archive, newest first",
    archive.map(r => r.id), ["last-week", "old-entered", "old-unentered-2", "old-unentered-1"]);
  check("no event is lost between the two halves", upcoming.length + archive.length, rows.length);
  check("and none is duplicated",
    new Set([...upcoming, ...archive].map(r => r.id)).size, rows.length);
}

// ── 5. The cap keeps the NEAREST racing, not an arbitrary forty ──────────
// Ordering happens before the cap, so a league with hundreds of events still
// opens on the next race and the one that just ran.
{
  const many = [];
  for (let i = 1; i <= 60; i++) many.push(race(`up${i}`, `2026-09-${String(i % 28 + 1).padStart(2, "0")}`, { round: i }));
  for (let i = 1; i <= 60; i++) many.push(race(`past${i}`, `2025-06-${String(i % 28 + 1).padStart(2, "0")}`, { round: i, results: true }));
  const { upcoming, archive } = splitScheduleFeed(many, TODAY);
  check("upcoming is capped", upcoming.length, FEED_LIMIT);
  check("archive is capped", archive.length, FEED_LIMIT);
  check("the soonest race survives the cap", upcoming[0].date, "2026-09-01");
  check("the most recent result survives the cap", archive[0].date, "2025-06-28");
  check("upcoming stays in ascending order after the cap",
    upcoming.every((r, i) => i === 0 || upcoming[i - 1].date <= r.date), true);
  check("archive stays in descending order after the cap",
    archive.every((r, i) => i === 0 || archive[i - 1].date >= r.date), true);
}

// ── 6. Two rounds on the same day read in running order ─────────────────
{
  const sameDay = [
    race("r2", "2026-08-16", { round: 2 }),
    race("r1", "2026-08-16", { round: 1 }),
    race("r3", "2026-08-16", { round: 3 }),
  ];
  check("upcoming: the day's running order", splitScheduleFeed(sameDay, TODAY).upcoming.map(r => r.id),
    ["r1", "r2", "r3"]);
  const ran = sameDay.map(r => ({ ...r, date: "2026-08-01", summary: { has_results: true } }));
  check("archive: the round that just finished, first",
    splitScheduleFeed(ran, TODAY).archive.map(r => r.id), ["r3", "r2", "r1"]);
}

// The comparators are stable on equal rows, so a re-render can't reshuffle a
// table the reader is looking at.
{
  const a = race("a", "2026-08-16", { round: 1 });
  const b = { ...a, id: "b" , name: "a" };
  check("identical rows compare equal (ascending)", byDateAscending(a, b), 0);
  check("identical rows compare equal (descending)", byDateDescending(a, b), 0);
  // Two undated rows have no date to tell apart (Infinity − Infinity is NaN,
  // which a comparator must never return), so they fall through to the same
  // round-then-name tie-break every other equal pair uses.
  check("two undated rows tie-break by name, never on NaN",
    byDateAscending(race("x", ""), race("y", "")), -1);
  check("...and the other way round", byDateAscending(race("y", ""), race("x", "")), 1);
  check("...same for the descending half", byDateDescending(race("x", ""), race("y", "")), 1);
  check("two undated rows that are alike compare equal",
    byDateAscending(race("x", ""), { ...race("x", ""), id: "other" }), 0);
}

// ── 7. Nothing in, nothing out ───────────────────────────────────────────
check("no rows", splitScheduleFeed([], TODAY), { upcoming: [], archive: [] });
check("no argument", splitScheduleFeed(undefined, TODAY), { upcoming: [], archive: [] });

// A full timestamp on a legacy row still lands on the right side of today.
check("a legacy timestamp is read as its calendar date",
  isArchived({ date: "2026-08-11T23:30:00Z", summary: {} }, TODAY), true);

console.log(`all ${n} checks passed — the feed opens on the next race and the one that just ran`);
