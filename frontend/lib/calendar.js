// The month-by-month calendar's arithmetic, kept away from the page that draws
// it so the grid can be reasoned about (and tested) without a browser.
//
// Everything here speaks the same bare `YYYY-MM-DD` calendar date the rest of
// the schedule does — see lib/raceDate.js for why a race date is never a
// timestamp. A cell knows its own date string, so plotting an event is a map
// lookup rather than a date comparison, and no event can slide a day sideways
// because of a timezone.

import { toDateOnly, todayDateString } from "@/lib/raceDate";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = n => String(n).padStart(2, "0");

// A local Date → its bare calendar date. Built from the LOCAL fields, never
// from toISOString(), which would shift the day in any negative-offset zone.
export function isoOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "August 2026" — the heading over the grid.
export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

// Month arithmetic that carries the year over, so ‹ from January lands on the
// previous December rather than on month -1.
export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// The month a `YYYY-MM-DD` belongs to, or null when it isn't a usable date.
export function monthOf(value) {
  const iso = toDateOnly(value);
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m - 1 };
}

// One month as the cells a 7-column grid draws, Sunday-first: the days of the
// month itself, padded at both ends with the neighbouring months' days so every
// week is whole. Each cell carries its own date string, whether it belongs to
// the month on screen, and whether it's today.
export function buildMonthGrid(year, month, today = todayDateString()) {
  const firstOfMonth = new Date(year, month, 1);
  const lead = firstOfMonth.getDay();
  // Day 0 of the next month is the last day of this one — the standard trick
  // that also gets February right in a leap year.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < total; i++) {
    const date = new Date(year, month, i - lead + 1);
    const iso = isoOf(date);
    cells.push({
      iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: iso === today,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  return cells;
}

// Events keyed by the day they run, in a stable order within the day: earliest
// round first, then by name, so a day with three rounds doesn't reshuffle
// between renders. Undated events are returned separately rather than dropped —
// a race with no date yet is still a race somebody needs to find.
export function groupRacesByDate(rows = []) {
  const byDate = {};
  const undated = [];
  for (const r of rows) {
    const iso = toDateOnly(r?.date);
    if (!iso) { undated.push(r); continue; }
    (byDate[iso] ||= []).push(r);
  }
  const order = (a, b) =>
    (Number(a?.round_number) || 0) - (Number(b?.round_number) || 0) ||
    String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
  for (const list of Object.values(byDate)) list.sort(order);
  undated.sort(order);
  return { byDate, undated };
}

// Which months have racing in them, oldest first — what the "jump to a month
// that has races" control offers, and what picks the month to open on.
export function monthsWithRaces(rows = []) {
  const counts = new Map();
  for (const r of rows) {
    const m = monthOf(r?.date);
    if (!m) continue;
    const key = `${m.year}-${pad(m.month + 1)}`;
    const entry = counts.get(key) || { ...m, key, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// The month the calendar should open on: the one being lived through if it has
// racing in it, else the next month that does, else the last one that did. A
// league whose season ended in March shouldn't open on an empty August.
export function initialMonth(rows = [], today = todayDateString()) {
  const [y, m] = today.split("-").map(Number);
  const current = { year: y, month: m - 1 };
  const months = monthsWithRaces(rows);
  if (!months.length) return current;
  const currentKey = `${y}-${pad(m)}`;
  const here = months.find(x => x.key === currentKey);
  if (here) return { year: here.year, month: here.month };
  const next = months.find(x => x.key > currentKey);
  const pick = next || months[months.length - 1];
  return { year: pick.year, month: pick.month };
}

// A short tag for a series, for the pills where the full name would never fit:
// "Phoenix GT3 Championship" → "PGT3C", "Sunday Cup" → "SC". Words carrying a
// digit stay whole, because "GT3" abbreviated to "G" tells a reader nothing.
// The full name always travels alongside as the pill's tooltip.
const STOPWORDS = new Set(["the", "of", "and", "a", "an", "for"]);

export function seriesAbbrev(name, max = 5) {
  const text = String(name ?? "").trim();
  if (!text) return "";
  const words = text.split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter(w => !STOPWORDS.has(w.toLowerCase()));
  if (!words.length) return text.slice(0, max).toUpperCase();
  if (words.length === 1) return words[0].slice(0, max).toUpperCase();
  return words.map(w => (/\d/.test(w) ? w : w[0])).join("").slice(0, max).toUpperCase();
}

// What one pill says: the series it belongs to, and where it's being raced.
// The track is the point of the line — an event's own name ("Round 4") is the
// fallback for a race with no track set, not the other way round.
export function eventPillLabel(race) {
  const track = String(race?.track ?? "").trim();
  return track || String(race?.name ?? "").trim() || "Race";
}

// The whole event in one line, for the pill's tooltip and for a screen reader:
// "GTC · Watkins Glen — Round 4 · Summer Series 2026".
export function eventTitle(race) {
  const parts = [race?.name, race?.track].map(v => String(v ?? "").trim()).filter(Boolean);
  const scope = [race?.series_name, race?.season_name].map(v => String(v ?? "").trim()).filter(Boolean);
  return [parts.join(" · "), scope.join(" · ")].filter(Boolean).join(" — ");
}
