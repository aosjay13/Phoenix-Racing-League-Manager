// ── Demo Derby / Banger Racing ─────────────────────────────────────────────
//
// A series can be flagged as Demo Derby / Banger Racing (`isBangerRacing` on
// the series doc — see SPECS.series in lib/entityApi.js). That flag does two
// things, and nothing else:
//
//   1. The results grid for any session of that series grows the extra inputs
//      defined below (Takedowns, Survival Bonus, Most Lethal Bonus), and the
//      points structure editors grow a matching bonus value for each.
//   2. Standings/Stats screens show the aggregated versions of those stats —
//      but ONLY while the viewer is scoped to a banger series. They never
//      appear in the "Overall" (league-wide) or a Game view, where they'd be
//      meaningless columns of zeros next to ordinary racing stats.
//
// The metrics themselves are always stored and always aggregated (a stat that
// exists only when someone is looking at it can't be trusted); it's the
// FRONTEND that enforces visibility — see isBangerScope() and the column
// guards in app/standings/page.js and app/stats/page.js.
//
// ── Adding another banger bonus ────────────────────────────────────────────
//
// Everything — the grid column, the results payload, the points-structure
// field, the scoring, the aggregated stat and the standings/stats column —
// is generated from the BANGER_STATS list below. To add (say) a "Big Hit"
// bonus, add one entry to that list. Nothing else needs to change.
//
//   key    the field stored on each result row
//   type   "number" (a counted stat, paid per unit) or "bool" (a one-off flag)
//   width  the grid column width in the results editor
//   bonus  { key, label } — the points value admins set per structure
//   stat   { key, header, label } — the aggregated column on Standings/Stats

export const BANGER_STATS = [
  {
    key: "takedowns",
    type: "number",
    header: "TD",
    title: "Takedowns — cars this driver put out of the event. Paid per takedown by the points structure.",
    width: "62px",
    bonus: { key: "takedown", label: "Points per Takedown" },
    stat: { key: "takedowns", header: "TD", label: "Takedowns" },
  },
  {
    key: "survival_bonus",
    type: "bool",
    header: "SUR",
    title: "Survival bonus — the driver who survived the longest. Worth whatever the points structure pays for it.",
    width: "38px",
    bonus: { key: "survival_bonus", label: "Survival Bonus (survived longest)" },
    stat: { key: "survival_bonuses", header: "Surv", label: "Survival Bonuses" },
  },
  {
    key: "most_lethal",
    type: "bool",
    header: "LTH",
    title: "Most lethal — the driver with the most takedowns. Ticks itself for the highest Takedowns count; change it and your call sticks.",
    width: "38px",
    bonus: { key: "most_lethal", label: "Most Lethal Bonus (most takedowns)" },
    stat: { key: "most_lethal_awards", header: "Lethal", label: "Most Lethal Awards" },
  },
];

// ── Where the flag lives ───────────────────────────────────────────────────
//
// `isBangerRacing` can be set at THREE levels — a series, one of its seasons,
// or a single class within a season — because a league doesn't always run
// derby at series level: a season can be a one-off derby year, and a season can
// run a Banger class alongside ordinary racing classes.
//
// The levels don't override each other, they add up: derby is on for anything
// at or under a flagged level. A flagged series means every season and class in
// it; a flagged season means every class in it; a flagged class means that
// class alone, whatever the season above it says.

// Does this one doc (a series, a season or a class) carry the flag?
export function isBangerDoc(doc) {
  return !!(doc && doc.isBangerRacing);
}

// Is the scope being viewed (or entered) a Demo Derby / Banger Racing context?
// This is the single check every visibility guard runs.
//
//   • Any of series / season / cls flagged → yes, for the reasons above.
//   • No single class picked, but the field being shown CONTAINS a banger class
//     → yes: part of that table races derby, so its stats belong on it.
//   • Nothing flagged → no. Callers pass no series at all above series level
//     ("All Series", a Game view, the league-wide Overall), so those scopes can
//     never answer yes — which is the isolation rule.
export function isBangerScope({ series = null, season = null, cls = null, classes = [] } = {}) {
  if (isBangerDoc(series) || isBangerDoc(season) || isBangerDoc(cls)) return true;
  if (!cls && Array.isArray(classes) && classes.some(isBangerDoc)) return true;
  return false;
}

// The per-result fields, split by shape — used by the results editor's row
// state and by the results API when it writes a row.
export const BANGER_RESULT_FIELDS = BANGER_STATS.map(s => s.key);
export const BANGER_BOOL_FIELDS = BANGER_STATS.filter(s => s.type === "bool").map(s => s.key);
export const BANGER_NUMBER_FIELDS = BANGER_STATS.filter(s => s.type === "number").map(s => s.key);

// The bonus values a season / class / points template can pay for banger
// achievements, in the same [key, label] shape BONUS_TYPES uses.
export const BANGER_BONUS_TYPES = BANGER_STATS.map(s => [s.bonus.key, s.bonus.label]);

// The aggregated columns, in the [key, header, lowerIsBetter, fullName] shape
// the Standings and Stats tables take.
export const BANGER_STAT_COLUMNS = BANGER_STATS.map(s => [s.stat.key, s.stat.header, false, s.stat.label]);
export const BANGER_STAT_KEYS = BANGER_STATS.map(s => s.stat.key);

// A blank set of banger fields for a fresh results row (grid state is strings
// for numbers, booleans for flags — matching the rest of the editor).
export function blankBangerRow() {
  return Object.fromEntries(BANGER_STATS.map(s => [s.key, s.type === "bool" ? false : "0"]));
}

// The banger fields of one submitted row, coerced to what's stored: counts as
// numbers, flags as real booleans. Always written, for every series — a
// non-banger result simply stores zeros/falses, which score nothing and
// aggregate to nothing.
export function bangerFieldsForSave(row = {}) {
  return Object.fromEntries(BANGER_STATS.map(s =>
    [s.key, s.type === "bool" ? !!row[s.key] : Number(row[s.key] || 0)]));
}

// Points a result earns from its banger stats, under a resolved bonus map. A
// counted stat pays its rate per unit; a flag pays its value once. Zero for
// every ordinary racing result, since those bonuses default to 0 and the
// fields default to 0/false — which is what lets pointsFor add this
// unconditionally instead of having to know what kind of series it's scoring.
export function bangerPoints(result = {}, bonuses = {}) {
  let pts = 0;
  for (const s of BANGER_STATS) {
    const rate = Number(bonuses[s.bonus.key] || 0);
    if (!rate) continue;
    pts += s.type === "bool" ? (result[s.key] ? rate : 0) : Number(result[s.key] || 0) * rate;
  }
  return pts;
}

// The aggregated banger line for a set of race results: counted stats summed,
// flags counted. Folded into every stat line (see statLine in lib/standings.js)
// so a banger driver's totals are there whenever a banger-scoped screen asks
// for them.
export function bangerStatLine(results = []) {
  const out = {};
  for (const s of BANGER_STATS) {
    out[s.stat.key] = s.type === "bool"
      ? results.filter(r => !!r[s.key]).length
      : results.reduce((a, r) => a + Number(r[s.key] || 0), 0);
  }
  return out;
}

// Zeroed banger totals, for a team accumulator to start from.
export function blankBangerTotals() {
  return Object.fromEntries(BANGER_STAT_KEYS.map(k => [k, 0]));
}

// The results-grid column widths for the banger stats, as a grid-template
// fragment. Fed to the grid through the --banger-cols custom property so the
// base column layout stays in globals.css — see .result-grid-wide.
export const BANGER_GRID_COLUMNS = BANGER_STATS.map(s => s.width).join(" ");
export const BANGER_GRID_WIDTH = BANGER_STATS.reduce((a, s) => a + parseInt(s.width, 10) + 8, 0);

// The style object that opens those columns up on a grid container. Spread onto
// the grid's `style` when the series is a banger series; an empty object
// otherwise, leaving the CSS layout exactly as it is for everyone else.
export function bangerGridStyle(on) {
  return on ? { "--banger-cols": BANGER_GRID_COLUMNS, "--banger-extra": `${BANGER_GRID_WIDTH}px` } : {};
}

// Slot that recorded the most takedowns — the automatic Most Lethal pick. Ties
// go to whoever finished highest, so the bonus lands on exactly one car (the
// same rule Most Laps Led uses). Null when nobody has a takedown recorded.
export function autoMostLethalSlot(rows = []) {
  let best = null;
  for (const r of rows) {
    if (!r.entry_id) continue;
    const td = Number(r.takedowns || 0);
    if (td <= 0) continue;
    const finish = Number(r.finish_pos);
    const rank = finish > 0 ? finish : Infinity;
    if (best == null || td > best.td || (td === best.td && rank < best.rank)) {
      best = { td, rank, slot_id: r.slot_id };
    }
  }
  return best?.slot_id ?? null;
}
