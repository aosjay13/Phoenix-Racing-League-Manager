// Timezone-safe handling for race schedule dates.
//
// A race date is a plain calendar date — "July 20th" — with no time and no
// timezone. It is stored as a bare `YYYY-MM-DD` string. The bug this module
// exists to kill: `new Date("2026-07-20")` is parsed by JS as UTC midnight, so
// in any western (negative-offset) timezone it renders as July *19th*. Every
// place that displays or compares a race date must go through the helpers here
// instead of handing the raw string to `new Date()`.

// Normalize whatever an admin/date-picker/legacy record gives us down to a bare
// `YYYY-MM-DD` calendar date, dropping any time component entirely. Returns ""
// when there's no usable date.
export function toDateOnly(value) {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Legacy rows may hold a full timestamp or a locale string; fall back to
  // reading it as a real instant and taking its LOCAL calendar date, so the day
  // an admin originally saw is the day we keep.
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A `YYYY-MM-DD` string as a Date pinned to LOCAL midnight — never UTC — so
// formatting it can't roll backwards a day. Returns null for an unusable value.
export function parseRaceDate(value) {
  const iso = toDateOnly(value);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Today's calendar date as `YYYY-MM-DD` (local). Race dates are compared as
// strings against this, which is exact and offset-free.
export function todayDateString(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Sortable key for a race date. Undated races sort last for "upcoming" views
// (Infinity) and first for "most recent" views (-Infinity) — pick with `fallback`.
export function raceDateSortKey(value, fallback = Infinity) {
  const iso = toDateOnly(value);
  return iso ? Number(iso.replace(/-/g, "")) : fallback;
}

// The race has already happened, judged purely on calendar dates.
export function isPastRaceDate(value, today = todayDateString()) {
  const iso = toDateOnly(value);
  return !!iso && iso < today;
}

// Display a race date exactly as the admin picked it. `style`:
//   "short" → Jul 20, 2026   (schedule tables)
//   "long"  → July 20, 2026  (event header)
//   "full"  → Monday, July 20, 2026
//   "numeric" → locale short date
export function formatRaceDate(value, style = "short", fallback = "TBA") {
  const d = parseRaceDate(value);
  if (!d) return fallback;
  const opts = style === "full"
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : style === "long"
      ? { month: "long", day: "numeric", year: "numeric" }
      : style === "numeric"
        ? undefined
        : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}
