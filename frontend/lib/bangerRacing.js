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
    name: "Takedowns",
    header: "TD",
    title: "Takedowns — cars this driver put out of the event. Paid per takedown by the points structure.",
    width: "62px",
    bonus: { key: "takedown", label: "Points per Takedown" },
    stat: { key: "takedowns", header: "TD", label: "Takedowns" },
  },
  {
    key: "survival_bonus",
    type: "bool",
    name: "Survival Bonus",
    header: "SUR",
    title: "Survival bonus — the driver who survived the longest. Worth whatever the points structure pays for it.",
    width: "38px",
    bonus: { key: "survival_bonus", label: "Survival Bonus (survived longest)" },
    stat: { key: "survival_bonuses", header: "Surv", label: "Survival Bonuses" },
  },
  {
    key: "most_lethal",
    type: "bool",
    name: "Most Lethal",
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
// The levels add up: derby is on for anything at or under a flagged level. A
// flagged series means every season and class in it; a flagged season means
// every class in it; a flagged class means that class alone.
//
// A season can also say so itself, for a one-off derby year inside an ordinary
// series. What a scope CONTAINS never makes it a derby: a racing series with a
// Banger class in one of its seasons is still a racing series, and its overall
// standings must not carry takedown columns.

// A season's own answer to "is this a derby season?".
//   ""    no (the default)
//   "on"  yes, the whole season
//   "off" no — kept as a distinct value because it used to override an
//         inference that no longer exists; it reads the same as the default.
export const BANGER_MODES = [
  ["", "No — an ordinary racing season"],
  ["on", "Yes — the whole season is Demo Derby / Banger Racing"],
];

// Does this one doc (a series, a season or a class) carry the flag?
export function isBangerDoc(doc) {
  return !!(doc && doc.isBangerRacing);
}

// Has this season explicitly said it is NOT a derby season?
export function bangerOptOut(season) {
  return String(season?.banger_mode || "") === "off";
}

// ── Where the derby stats may be SEEN ──────────────────────────────────────
//
// The visibility rule, and the only one the Standings and Stats columns follow:
// the scope being viewed must ITSELF be labelled Demo Derby / Banger Racing —
// the class you picked, or the season, or the series it sits in. Nothing is
// inferred from what a scope contains, so:
//
//   • the league-wide Overall and any Game view: never — no series is in scope;
//   • a series that isn't labelled: never, however many derby classes or
//     seasons are inside it;
//   • a season that isn't labelled: never, even when one of its classes is a
//     derby — that class's own standings are where those stats belong;
//   • a class that isn't labelled: never, even inside a season that runs one.
//
// A labelled series or season does cover the levels BELOW it — that's what
// labelling the higher level means — so a class inside a derby series shows the
// derby stats without needing its own label.
export function isBangerScope({ series = null, season = null, cls = null } = {}) {
  if (isBangerDoc(cls)) return true;
  if (bangerOptOut(season)) return false;
  return isBangerDoc(season) || isBangerDoc(series);
}

// ── Where the derby stats may be ENTERED and CONFIGURED ────────────────────
//
// Deliberately wider than the view rule above. A results grid has to offer the
// derby inputs whenever ANY class in the event's field races derby — otherwise
// the one Banger class in an ordinary season could never have its takedowns
// recorded — and the points editors have to offer the derby rates wherever
// those results will be scored. None of that puts a column on a table: the
// stats are stored for everyone and shown only where isBangerScope says yes.
export function bangerEntryScope({ series = null, season = null, cls = null, classes = [] } = {}) {
  if (isBangerScope({ series, season, cls })) return true;
  // A specific class that isn't a derby, under a season/series that isn't one.
  if (cls) return false;
  // Otherwise: does anything in this field race derby? (An opted-out season
  // still has to be able to enter its derby class's stats.)
  return Array.isArray(classes) && classes.some(isBangerDoc);
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

// Where the derby columns sit in a stats/standings table: immediately LEFT of
// Best Laps, so they read as part of the racing stats rather than as a stray
// block pushed off the right-hand end of the table. Every screen that shows
// them inserts through this, so they land in the same place on each.
const BANGER_COLUMNS_BEFORE = "best_laps";

// `cols` in, `cols` out, in the [key, header, lowerIsBetter, fullName] shape
// both tables use. Returns the list untouched when `on` is false — which is the
// isolation rule (see isBangerScope) — and appends rather than dropping them if
// a table has no Best Laps column to anchor to.
export function withBangerColumns(cols = [], on = false) {
  if (!on) return cols;
  const at = cols.findIndex(([key]) => key === BANGER_COLUMNS_BEFORE);
  if (at < 0) return [...cols, ...BANGER_STAT_COLUMNS];
  return [...cols.slice(0, at), ...BANGER_STAT_COLUMNS, ...cols.slice(at)];
}

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

// Just the derby bonus values out of a form's bonus map, as numbers. Used to
// store derby bonuses on a class that runs the mode without giving it a whole
// points structure of its own — see classFormToBody in lib/classForm.js.
export function bangerBonusesOnly(bonuses = {}) {
  return Object.fromEntries(BANGER_BONUS_TYPES.map(([k]) => [k, Number(bonuses[k] || 0)]));
}

// Does this bonus map actually pay for anything derby-related?
export function hasBangerBonuses(bonuses = {}) {
  return BANGER_BONUS_TYPES.some(([k]) => Number(bonuses[k] || 0) !== 0);
}

// What this session actually pays for each derby stat, as [{ name, rate, per }]
// — `per` marks a counted stat (paid per unit) rather than a one-off flag. The
// results editor prints this above the grid so an admin can see the rates in
// force where they're entering the numbers, instead of finding out from the
// standings days later that they were all zero.
export function bangerRates(bonuses = {}) {
  return BANGER_STATS.map(s => ({
    name: s.name,
    rate: Number(bonuses[s.bonus.key] || 0),
    per: s.type === "number",
  }));
}

// Which points structure a derby rate typed into the results editor is written
// to. The answer is always the SEASON, and that is deliberate.
//
// A rate on a class only reaches results that are actually stamped with that
// class. A league that flags a Banger class but enters its results on a shared
// grid — drivers unclassified, or the row's Class cell left blank — has results
// that belong to no class, so a class-level rate pays them nothing, silently,
// which is precisely the "takedowns don't count" failure this control exists to
// prevent.
//
// A season-level rate has neither problem: it applies to every result in the
// season however it is classed, and it cannot leak into ordinary racing,
// because a rate is only ever multiplied by stats an ordinary result doesn't
// have (no takedowns, no survival, no most-lethal → nothing to pay for). Where
// two derby classes genuinely need different rates, that's what the class's own
// points structure in League Setup is for.
export function derbyPointsTarget({ season = null } = {}) {
  return { kind: "season", id: season?.id ?? null, name: season?.name ?? "Season" };
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

// NOTE: the results-grid column widths for these stats live in globals.css
// (.result-grid-wide.has-banger / .qual-grid.has-banger). Adding a stat above
// means adding its width there too — spelled out rather than injected from
// here, because an empty CSS custom property is legal but not universally
// honoured, and a browser that drops it would invalidate the grid layout for
// every results grid in the app, derby or not.

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
