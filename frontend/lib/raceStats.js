// Race statistics — figures that describe the RUNNING of an event rather than
// any one driver's day: how many caution flags flew, and how many times the
// lead changed hands. They belong to the race, so they live on the race doc
// (`caution_flags`, `lead_changes`) beside its distance and its date, not on a
// results row, and nothing in the points or stats engines reads them.
//
// Both are OPTIONAL and both default to unset, because not every league has
// them to hand: a game that reports neither, or a statistician who didn't count
// them, leaves the boxes empty and the event reads on every screen exactly as it
// did before these existed. That is also the display rule everywhere they're
// printed — a stat is shown only when there is at least ONE of it. Zero cautions
// and no cautions recorded are indistinguishable in a blank box, so a "0" is
// never printed as if it were a counted figure.
//
// Stored as numbers (0 = unset, the same convention `total_laps` uses) so a
// blank box and a zero both read back as "this event doesn't have one".

// The two stats, in the order they're printed. `icon` fronts the chip on the
// results page; `title` is its tooltip.
const RACE_STATS = [
  { field: "caution_flags", label: "Caution Flags", icon: "🟡",
    title: "Caution flags shown during this race" },
  { field: "lead_changes", label: "Lead Changes", icon: "🔄",
    title: "Times the race lead changed hands" },
];

// The race-doc fields these stats are stored in.
export const RACE_STAT_FIELDS = RACE_STATS.map(s => s.field);

// One stat off a race doc, as a whole number — or null when the event doesn't
// have it. Null covers every way "no figure" arrives: absent, blank, 0, a
// negative, or something that isn't a number at all.
export function raceStatValue(race, field) {
  const n = Number(race?.[field]);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

export const cautionFlags = race => raceStatValue(race, "caution_flags");
export const leadChanges = race => raceStatValue(race, "lead_changes");

// The stats this event actually has, ready to print: { key, label, icon, title,
// value }. An event with neither returns an empty list, which is what keeps the
// whole strip off the page rather than showing a row of dashes.
export function raceStats(race) {
  return RACE_STATS
    .map(s => ({ key: s.field, label: s.label, icon: s.icon, title: s.title, value: raceStatValue(race, s.field) }))
    .filter(s => s.value != null);
}

// True when there is at least one stat to show for this event.
export function hasRaceStats(race) {
  return raceStats(race).length > 0;
}

// ── Form ↔ doc ─────────────────────────────────────────────────────────────

// A saved race doc → the form fields, as the strings the inputs want. Blank
// (rather than "0") for an event that has never recorded one, so the
// placeholder shows and the box reads as the optional figure it is.
export function raceStatsForm(race = {}) {
  const str = field => {
    const n = raceStatValue(race, field);
    return n == null ? "" : String(n);
  };
  return Object.fromEntries(RACE_STAT_FIELDS.map(f => [f, str(f)]));
}

// Form fields → the stats half of a POST/PATCH body. A blank box, a zero or
// anything unparseable is written back as 0 — unset — so clearing a figure
// really does clear it rather than leaving the old number on the event.
export function raceStatsBody(form = {}) {
  const num = field => {
    const n = Number(form?.[field]);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : 0;
  };
  return Object.fromEntries(RACE_STAT_FIELDS.map(f => [f, num(f)]));
}
