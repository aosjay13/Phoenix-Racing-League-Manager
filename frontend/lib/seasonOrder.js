// How a series' seasons are ordered — newest season first, everywhere.
//
// The order used to be creation order, which meant a league that entered
// "Season 5" before it got round to filling in 2, 3 and 4 was stuck with the
// menus reading 1, 5, 2, 3, 4 forever. What actually makes one season newer
// than another is WHEN IT RACED, so that's what sorts them here: a season's
// key is the date of its first race, and the list runs newest at the top down
// to the oldest at the bottom.
//
// Two escape hatches, in this order of precedence:
//
//   1. `sort_order` — a custom order an admin set by hand in League Setup
//      (see /api/seasons/reorder). Lowest first, and it wins over the dates.
//   2. A season with no races yet has no dates to judge, so it falls back to
//      when it was CREATED — which puts a season being set up right now at the
//      top, where an upcoming season belongs.
//
// The two live on one scale on purpose: an admin's custom order is stamped as
// a contiguous 0,1,2… run down the list they arranged, and a season with no
// `sort_order` of its own uses its POSITION in the date ordering as its key.
// So a season added after a hand-sort still slots in by date instead of
// silently landing at the bottom.
//
// The dates themselves are attached server-side from the races collection —
// see lib/seasonOrderServer.js, which stamps `first_race_date` /
// `last_race_date` onto every season the API hands out.

import { toDateOnly } from "@/lib/raceDate";

// `YYYY-MM-DD` → a comparable number (20260720). 0 for anything unusable, which
// sorts last — i.e. treated as the oldest.
function dateNum(value) {
  const iso = toDateOnly(value);
  return iso ? Number(iso.replace(/-/g, "")) : 0;
}

// The calendar dates a season is judged by: the first and last race on its
// schedule, falling back to the day it was created for a season that hasn't
// been given a schedule yet.
export function seasonDates(season = {}) {
  const created = toDateOnly(season.created_at);
  return {
    start: toDateOnly(season.first_race_date) || created,
    end: toDateOnly(season.last_race_date) || created,
  };
}

// Has an admin hand-sorted this season? `sort_order` is null/absent until they
// do, and 0 is a real (top of the list) value — so this can't be a truthiness
// check.
export function hasCustomOrder(season) {
  const raw = season?.sort_order;
  if (raw === null || raw === undefined || raw === "") return false;
  return Number.isFinite(Number(raw));
}

// Newest first, on dates alone. Ties fall through to the finer signals so the
// order is always total (and therefore stable across reloads): the last race,
// then the exact creation timestamp, then the name read numerically, which puts
// "Season 10" above "Season 9" rather than beside "Season 1".
export function compareSeasonsByDate(a, b) {
  const da = seasonDates(a), dbb = seasonDates(b);
  return (dateNum(dbb.start) - dateNum(da.start))
    || (dateNum(dbb.end) - dateNum(da.end))
    || String(b?.created_at || "").localeCompare(String(a?.created_at || ""))
    || String(b?.name || "").localeCompare(String(a?.name || ""), undefined, { numeric: true });
}

// The whole list of one series' seasons, in display order: newest first, with
// any hand-set order taking precedence. Always returns a new array.
export function sortSeasons(seasons = []) {
  const byDate = [...seasons].sort(compareSeasonsByDate);
  // A season without a custom slot borrows its rank in the date ordering, which
  // is the same 0..n-1 scale a hand-sort is stamped on.
  const dateRank = new Map(byDate.map((s, i) => [s.id, i]));
  const keyOf = s => (hasCustomOrder(s) ? Number(s.sort_order) : (dateRank.get(s?.id) ?? 0));
  return byDate.sort((a, b) => (keyOf(a) - keyOf(b)) || compareSeasonsByDate(a, b));
}

// Does this series carry a hand-set order at all? Drives the "Sorted by hand"
// notice and the reset button in League Setup.
export function isCustomOrdered(seasons = []) {
  return seasons.some(hasCustomOrder);
}

// "Mar 2025 – Jun 2025" — the span a season raced, for the League Setup list, so
// the order the seasons are in is readable straight off the rows. Null when the
// season has no dated races, which is what the date order falls back on.
export function seasonDateRangeLabel(season = {}) {
  const first = toDateOnly(season.first_race_date);
  const last = toDateOnly(season.last_race_date);
  if (!first) return null;
  const label = iso => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  };
  const from = label(first), to = last ? label(last) : from;
  return from === to ? from : `${from} – ${to}`;
}
