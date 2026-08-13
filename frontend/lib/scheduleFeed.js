// How the cross-season Schedule feed ("All Games" / "All Series") splits and
// orders the league's racing — kept out of the page so the ordering can be
// reasoned about, and tested, on its own.
//
// The feed answers two questions side by side: what is coming up, and what
// recently ran. Which half an event belongs in is a question about the CALENDAR,
// not about the admin's data entry:
//
//   upcoming   the day hasn't come yet (or has no date set at all)
//   archive    the day has been and gone — OR results are already in
//
// That second rule is the one that had been doing all the work on its own, and
// it's why the feed looked unsorted: an event whose results were never entered
// stayed "upcoming" forever, so a round from two seasons ago sat at the TOP of
// the Upcoming table (soonest-first puts the oldest date first), and with the
// per-section cap the genuinely upcoming races could be pushed off the bottom
// entirely. A race that ran in 2024 and never got a results sheet is history
// with a gap in it, not something still to come.
//
// Everything here compares bare `YYYY-MM-DD` calendar dates as strings, which
// is exact and offset-free — see lib/raceDate.js for why a race date is never
// a timestamp.

import { raceDateSortKey, todayDateString, toDateOnly } from "@/lib/raceDate";

// How many events each half of the feed shows. The feed is a summary — a
// league with ten seasons behind it doesn't want all of them here — so both
// halves are capped, and the cap is applied AFTER ordering so it keeps the
// nearest racing rather than an arbitrary forty.
export const FEED_LIMIT = 40;

// An event belongs to the archive once its day has passed, or once it has
// results (which can land before the day is out — an admin entering a sheet
// the same evening, or a race dated slightly ahead of when it was run).
export function isArchived(race, today = todayDateString()) {
  if (race?.summary?.has_results) return true;
  const iso = toDateOnly(race?.date);
  return !!iso && iso < today;
}

// Ties inside one day: the running order of the day itself. Two rounds on the
// same Sunday should read 1 then 2, and must not swap places between renders.
const byRoundThenName = (a, b) =>
  (Number(a?.round_number) || 0) - (Number(b?.round_number) || 0) ||
  String(a?.name ?? "").localeCompare(String(b?.name ?? ""));

// Soonest first. An undated event sorts last — it's still to come, but nobody
// knows when, so it can't jump ahead of a race with a real date on it.
export function byDateAscending(a, b) {
  return raceDateSortKey(a?.date, Infinity) - raceDateSortKey(b?.date, Infinity)
    || byRoundThenName(a, b);
}

// Most recent first. An undated event sorts last here too (it has no day to be
// recent on), and same-day rounds read latest-round-first, since that's the one
// that just finished.
export function byDateDescending(a, b) {
  return raceDateSortKey(b?.date, -Infinity) - raceDateSortKey(a?.date, -Infinity)
    || byRoundThenName(b, a);
}

// The two tables the feed draws, from the master schedule response.
export function splitScheduleFeed(rows = [], today = todayDateString(), limit = FEED_LIMIT) {
  const upcoming = [];
  const archive = [];
  for (const r of rows) (isArchived(r, today) ? archive : upcoming).push(r);
  upcoming.sort(byDateAscending);
  archive.sort(byDateDescending);
  return { upcoming: upcoming.slice(0, limit), archive: archive.slice(0, limit) };
}
