import { classOfResult } from "@/lib/classFilter";

// Default points tables mirror the PRA spreadsheet:
// race: P1 350, P2 320, P3 300, P4 280, P5 260, then -10 per position (min 10)
// qual: P1 35, P2 32, P3 30, P4 28, P5 26, then 31-pos (min 1)
function buildRacePoints() {
  const t = { 1: 350, 2: 320, 3: 300, 4: 280, 5: 260 };
  for (let p = 6; p <= 43; p++) t[p] = Math.max(10, 310 - 10 * p);
  return t;
}
function buildQualPoints() {
  const t = { 1: 35, 2: 32, 3: 30, 4: 28, 5: 26 };
  for (let p = 6; p <= 43; p++) t[p] = Math.max(1, 31 - p);
  return t;
}

export const DEFAULT_RACE_POINTS = buildRacePoints();
export const DEFAULT_QUAL_POINTS = buildQualPoints();
export const DEFAULT_POINTS_SCALE = DEFAULT_RACE_POINTS; // legacy alias

// The bonuses a season / class / points template can pay. There is deliberately
// no pole bonus here: pole is position 1 of Qualifying, so a pole bonus and the
// P1 qualifying points were two separate settings paying for the same result —
// and a league that set both silently paid twice. Qualifying Points is now the
// single place a pole is worth something (put the value first in the list).
// `bonus_points.pole` left on old season/class/template docs is simply ignored.
export const BONUS_TYPES = [
  ["best_lap", "Best Lap Bonus"],
  ["most_laps_led", "Most Laps Led Bonus"],
  ["lead_a_lap", "Lead a Lap Bonus"],
  ["halfway_point", "Half Way Point Bonus"],
  ["hard_charger", "Hard Charger Bonus"],
];

export const DEFAULT_BONUSES = Object.fromEntries(BONUS_TYPES.map(([k]) => [k, 0]));

export function parseMaybeJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && Object.keys(parsed).length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ── Result statuses ────────────────────────────────────────────────────────
//
// The Status column on a results grid is one of: Running (finished), DNF, DNS
// or DQ. Two of them change how a result is treated everywhere:
//
//   • DNS — "did not start". The driver never took the green flag, so the
//     result is not scored at all (pointsFor returns 0) and counts toward
//     nothing: not a start, not a finishing position, not a grid slot, not a
//     DNF. It stays on the grid as a record that they were entered.
//   • DQ  — thrown out. Scored like any other classified result, but it counts
//     toward the driver's DNF total the same way a retirement does: either way
//     they didn't see the checkered flag legally.
const statusOf = result => String(result?.status || "").toLowerCase();

export function isDidNotStart(result) {
  return statusOf(result) === "dns";
}

// Counts toward the DNFs stat — a retirement or a disqualification.
export function isDnf(result) {
  const s = statusOf(result);
  return s === "dnf" || s === "dq";
}

// Resolve a season document into a full scoring config.
export function resolveSeasonConfig(season = {}) {
  return {
    dropWeeks: Number(season.drop_weeks || 0),
    racePoints: parseMaybeJson(season.race_points ?? season.points_scale, DEFAULT_RACE_POINTS),
    qualPoints: parseMaybeJson(season.qual_points, DEFAULT_QUAL_POINTS),
    bonuses: { ...DEFAULT_BONUSES, ...parseMaybeJson(season.bonus_points, {}) },
  };
}

// Points templates (points_templates docs, or a season doc) share the same
// race_points/qual_points/bonus_points shape, so a template can override a
// base config wholesale — this is how each session in an event (Qualifying,
// a Heat, a Consolation, the Feature) can carry its own points system while
// falling back to the season default when no template is assigned.
export function configForTemplate(baseConfig, template) {
  if (!template) return baseConfig;
  return {
    dropWeeks: baseConfig.dropWeeks,
    racePoints: parseMaybeJson(template.race_points, baseConfig.racePoints),
    qualPoints: parseMaybeJson(template.qual_points, baseConfig.qualPoints),
    bonuses: { ...baseConfig.bonuses, ...parseMaybeJson(template.bonus_points, {}) },
  };
}

// ── Per-class points structures ────────────────────────────────────────────
//
// A class can score on its own points structure. Class docs carry the same
// race_points / qual_points / bonus_points shape a season (and a points
// template) does, so a class is just another override layer between the season
// and the session:
//
//   season default → the class's own structure → the session's template
//
// Every level only overrides what it actually sets, so a class that changes
// nothing but the best-lap bonus still inherits the season's race scale.

// Does this value hold a real points table? An unset field, an empty object and
// unparseable JSON all mean "inherit"; `{ 1: 0 }` (what a deliberately blank
// scale saves as) does not.
function hasTable(value) {
  if (!value) return false;
  if (typeof value === "string") {
    try { return Object.keys(JSON.parse(value) || {}).length > 0; } catch { return false; }
  }
  return Object.keys(value).length > 0;
}

// Does this class score on its own points structure, rather than the season's?
export function classScoresOwnPoints(cls) {
  return !!cls && (hasTable(cls.race_points) || hasTable(cls.qual_points) || hasTable(cls.bonus_points));
}

// The base config a class's results are scored against: the season config with
// the class's own structure laid over it, or the season config untouched when
// the class doesn't define one.
export function configForClass(baseConfig, cls) {
  return classScoresOwnPoints(cls) ? configForTemplate(baseConfig, cls) : baseConfig;
}

// class id -> that class's base config, for a whole season's class list.
export function classConfigs(baseConfig, classes = []) {
  return Object.fromEntries(classes.map(c => [c.id, configForClass(baseConfig, c)]));
}

// Whether a session counts toward stats/points by default, before any admin
// override. Preliminary sessions (heats, consolations/B- & C-Mains) are off by
// default so they don't skew a driver's global Win/Top-5/Average-Finish metrics
// or award championship points; standard races, the feature, and qualifying are
// on — including Qualifying, which feeds Poles/Average Start unless an admin
// turns its stats toggle off. Admin toggles (race.session_stats /
// session_points_enabled, keyed by session name) override these per session.
export function defaultSessionFlags(sessionType) {
  const preliminary = sessionType === "heat" || sessionType === "consolation";
  return { counts_stats: !preliminary, counts_points: !preliminary };
}

// Resolve a result's stats/points flags: an explicit admin toggle on the race
// doc wins; otherwise the session-type default applies.
export function resolveSessionFlags(result, racesById = {}) {
  const race = racesById[result.race_id] || {};
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const type = result.session_type || "race";
  // A qualifying result with no session name recorded (older data) is keyed as
  // "Qualifying" — never as the first race session, whose toggles are its own.
  const name = result.session || (type === "qualifying" ? "Qualifying" : firstStd);
  const def = defaultSessionFlags(type);
  const statsMap = race.session_stats || {};
  const pointsMap = race.session_points_enabled || {};
  return {
    counts_stats: name in statsMap ? !!statsMap[name] : def.counts_stats,
    counts_points: name in pointsMap ? !!pointsMap[name] : def.counts_points,
  };
}

// Stamp each result with its resolved counts_stats / counts_points flags so the
// downstream stat/points aggregation can filter without re-consulting the race
// docs. `racesById` maps race_id -> race doc (carrying the session_stats /
// session_points_enabled toggle maps) and must hold every race of the season:
// results whose race no longer exists are dropped here, so results orphaned by
// an old race deletion never count toward stats or standings.
export function decorateSessionFlags(results, racesById = {}) {
  return results
    .filter(r => racesById[r.race_id])
    .map(r => ({ ...r, ...resolveSessionFlags(r, racesById) }));
}

// Mark per-race derived flags (most laps led) before scoring. Events can
// hold multiple races ("sessions"), each scored independently.
//
// Results saved from the editor carry an explicit `most_laps_led` flag — the
// grid ticks it automatically off the Led column, but an admin can move it, so
// a result that has the flag is taken at its word. Results saved before the
// field existed have it derived here from laps led, exactly as before.
export function decorateRaceBonuses(results) {
  const byRace = {};
  for (const r of results) (byRace[`${r.race_id}|${r.session || ""}`] ??= []).push(r);
  const out = [];
  for (const raceResults of Object.values(byRace)) {
    const maxLed = Math.max(0, ...raceResults.map(r => Number(r.laps_led || 0)));
    for (const r of raceResults) {
      out.push({
        ...r,
        is_most_laps_led: r.most_laps_led != null
          ? !!r.most_laps_led
          : maxLed > 0 && Number(r.laps_led || 0) === maxLed,
      });
    }
  }
  return out;
}

// `qualPos` is the driver's actual Qualifying finish position for this race
// (looked up separately — see buildQualPosMap), not a copy stored on the
// race result itself. That's the only source of starting-position info now;
// there is no editable "Start" field on race/heat/consolation/feature rows.
// `qualConfig` resolves the qualifying-position points against the Qualifying
// session's OWN assigned points system (see buildQualTemplateMap) — falling
// back to `config` (the race result's own template) when Qualifying carries
// no override of its own, so a session-specific Qualifying points structure
// actually reaches the standings total instead of being silently ignored.
export function pointsFor(result, config, qualPos = null, qualConfig = null) {
  // Did Not Start: the driver never took the green flag, so there is nothing to
  // score — no position points, no qualifying points, no bonuses, and no
  // per-result adjustment either. A no-show that still needs to cost the driver
  // something is an entry-level points adjustment, not a scored result.
  if (isDidNotStart(result)) return 0;

  // A per-result adjustment (penalties/corrections) is applied on top of the
  // scored points in every case — an admin can dock or add points without
  // touching the driver's finishing position. Negative = penalty.
  const adjustment = Number(result.points_adjustment || 0);

  // Provisional entries (drivers who didn't make the race) score a flat,
  // admin-entered value instead of position-based points — see the Provisional
  // section of the results editor. They're also excluded from stats (statLine).
  if (result.provisional && result.manual_points != null && result.manual_points !== "") {
    return Number(result.manual_points || 0) + adjustment;
  }

  const { racePoints, bonuses } = config;
  const qualPoints = (qualConfig || config).qualPoints;
  let pts = Number(racePoints[result.finish_pos] ?? 0);
  // Grid position pays through the qualifying scale alone — pole is just its
  // position 1 (see BONUS_TYPES on why there's no separate pole bonus).
  if (qualPos != null) pts += Number(qualPoints[qualPos] ?? 0);
  if (result.fastest_lap) pts += Number(bonuses.best_lap || 0);
  if (result.is_most_laps_led) pts += Number(bonuses.most_laps_led || 0);
  if (Number(result.laps_led || 0) > 0) pts += Number(bonuses.lead_a_lap || 0);
  if (result.halfway_leader) pts += Number(bonuses.halfway_point || 0);
  if (result.hard_charger) pts += Number(bonuses.hard_charger || 0);
  pts += Number(result.bonus_points || 0) - Number(result.penalty_points || 0);
  pts += adjustment;
  return pts;
}

// A driver's Qualifying finish position, per event — the number the qualifying
// points in pointsFor are scored off.
//
// Keyed by race + entry + class, because one roster entry can race SEVERAL
// classes at the same event: at a split event each class runs its own
// Qualifying, so "SuperRaptor_'s grid slot at round 4" has three different
// answers and a race+entry key would keep only whichever was read last. That
// collision is invisible inside a single class championship (only that class's
// Qualifying is in the filtered set) but wrong in the combined table, where all
// three are — which is exactly how a driver's class totals stopped adding up to
// their overall total.
//
// The unscoped race|entry key is kept as a fallback for the ordinary case: one
// combined Qualifying for the whole field, whose result may carry no class at
// all (data written before classes existed). It's only set when that entry has
// a SINGLE qualifying result at the event — with several, there is no
// class-agnostic answer and guessing one is what caused the bug above.
export function buildQualPosMap(results, entriesById = {}) {
  const map = {};
  const byEntry = {};
  for (const r of results) {
    if (r.session_type !== "qualifying") continue;
    // A DNS in qualifying is no grid slot at all, so it pays no qualifying
    // points in the race that follows.
    if (isDidNotStart(r)) continue;
    const pos = Number(r.finish_pos);
    const key = `${r.race_id}|${r.entry_id}`;
    map[`${key}|${classOfResult(r, entriesById) || ""}`] = pos;
    (byEntry[key] ??= []).push(pos);
  }
  for (const [key, positions] of Object.entries(byEntry)) {
    if (positions.length === 1) map[key] = positions[0];
  }
  return map;
}

// The Qualifying position a given result scores its grid bonus off: its own
// class's Qualifying when that class ran one, else the event's single combined
// Qualifying, else null (the driver never qualified).
export function qualPosFor(map, result, entriesById = {}) {
  const key = `${result.race_id}|${result.entry_id}`;
  return map[`${key}|${classOfResult(result, entriesById) || ""}`] ?? map[key] ?? null;
}

// The Qualifying session's own points_template_id (or null for the season/class
// default), so the qualifying-position bonus folded into a race result (see
// pointsFor) can be resolved against the actual points system assigned to
// Qualifying rather than whatever template the race session happens to use.
//
// Keyed both by race and by race+class: at a split event each class runs its
// OWN Qualifying, which can carry its own points system, so "the Qualifying
// template for this race" is only an answer once you know whose race it is.
export function buildQualTemplateMap(results, entriesById = {}) {
  const map = {};
  for (const r of results) {
    if (r.session_type !== "qualifying") continue;
    const template = r.points_template_id || null;
    map[r.race_id] = template;
    map[`${r.race_id}|${classOfResult(r, entriesById) || ""}`] = template;
  }
  return map;
}

// The Qualifying template a given result's qualifying points score under:
// its own class's Qualifying when that class ran one, else the event's.
export function qualTemplateFor(map, result, entriesById = {}) {
  const key = `${result.race_id}|${classOfResult(result, entriesById) || ""}`;
  return key in map ? map[key] : (map[result.race_id] ?? null);
}

// Everything needed to score one season's results in one place: each result is
// scored under its own class's structure (configForClass), with the session's
// assigned template laid on top, and its qualifying points resolved against that
// same class's Qualifying session. Every screen and stat page builds its points
// through this, so a per-class structure reaches all of them identically.
export function makeScorer(results, { config, classes = [], entriesById = {}, templatesById = {} } = {}) {
  const byClass = classConfigs(config, classes);
  const baseFor = r => byClass[classOfResult(r, entriesById)] || config;
  const qualPosMap = buildQualPosMap(results, entriesById);
  const qualTemplates = buildQualTemplateMap(results, entriesById);

  const configFor = r => configForTemplate(baseFor(r), templatesById[r.points_template_id]);
  const qualConfigFor = r => configForTemplate(baseFor(r), templatesById[qualTemplateFor(qualTemplates, r, entriesById)]);
  const posFor = r => qualPosFor(qualPosMap, r, entriesById);

  return {
    qualPosMap,
    qualPosFor: posFor,
    baseFor,
    configFor,
    qualConfigFor,
    points: r => pointsFor(r, configFor(r), posFor(r), qualConfigFor(r)),
  };
}

const round2 = n => Math.round(n * 100) / 100;

// Stats whose display is always fixed to two decimal places.
const TWO_DP_STATS = new Set(["avg_start", "avg_finish"]);

// Format a stat value for display. Average Start / Average Finish always render
// with exactly two decimals (2.00, 14.50, 8.33); null shows an em dash; every
// other stat passes through unchanged.
export function formatStat(key, value) {
  if (value == null) return "—";
  if (TWO_DP_STATS.has(key)) return Number(value).toFixed(2);
  return value;
}

// A result belongs to a qualifying session (its finish_pos is a grid slot,
// not a race finish) rather than a race session.
export function isQualifying(r) {
  return r.session_type === "qualifying";
}

// Starting-grid info for a driver, from Qualifying sessions only — Poles and
// Average Start never look at anything recorded on a race result.
function startInfo(qualResults) {
  const positions = qualResults.map(r => Number(r.finish_pos)).filter(n => n > 0);
  return { positions, poles: qualResults.filter(r => Number(r.finish_pos) === 1).length };
}

// Accepts a mix of race + qualifying results for one driver and keeps them
// separate: race metrics come only from race sessions, while Poles and
// Average Start come from qualifying sessions.
function statLine(results) {
  // A session with its stats toggle off is ignored: a race session drops out of
  // the finishing-position metrics (Wins, Top 5s, Average Finish, Laps Led, …),
  // and a qualifying session drops out of Poles / Average Start — that's how a
  // qualifying run held purely for show (a grid set for visual purposes, an
  // exhibition hot-lap session) stays on the event page without touching
  // anyone's record. Provisional entries (drivers who didn't race) are excluded
  // too — they earn points only, never stats. So are DNS rows: a driver who
  // never took the green flag has no start, no finishing position to average
  // and no lap count — the slot they were listed in is not a race they ran.
  const rs = results.filter(r => !isQualifying(r) && r.counts_stats !== false && !r.provisional && !isDidNotStart(r));
  const qs = results.filter(r => isQualifying(r) && r.counts_stats !== false && !isDidNotStart(r));
  // Provisionals are counted from the full race set, since `rs` now omits them.
  const provisionalCount = results.filter(r => !isQualifying(r) && r.provisional).length;
  const starts = rs.length;
  const sum = fn => rs.reduce((a, r) => a + fn(r), 0);
  const { positions, poles } = startInfo(qs);
  return {
    starts,
    wins: rs.filter(r => r.finish_pos === 1).length,
    podiums: rs.filter(r => r.finish_pos <= 3).length,
    top5: rs.filter(r => r.finish_pos <= 5).length,
    top10: rs.filter(r => r.finish_pos <= 10).length,
    avg_finish: starts ? round2(sum(r => r.finish_pos) / starts) : null,
    // Unrounded totals behind the two averages. Kept alongside the rounded
    // display values so tie-breaking (and team aggregation) works off exact
    // arithmetic — 3.334 and 3.336 both render as 3.33 but are not a tie.
    finish_sum: sum(r => r.finish_pos),
    laps_run: sum(r => Number(r.laps || 0)),
    laps_led: sum(r => Number(r.laps_led || 0)),
    most_laps_led: rs.filter(r => r.is_most_laps_led).length,
    best_laps: rs.filter(r => r.fastest_lap).length,
    poles,
    qualifying_sessions: qs.length,
    avg_start: positions.length ? round2(positions.reduce((a, b) => a + b, 0) / positions.length) : null,
    start_sum: positions.reduce((a, b) => a + b, 0),
    dnfs: rs.filter(isDnf).length,
    provisionals: provisionalCount,
    incidents: sum(r => Number(r.incidents || 0)),
    best_finish: starts ? Math.min(...rs.map(r => r.finish_pos)) : null,
  };
}

// ── Championship tie-breakers ──────────────────────────────────────────────
//
// When two competitors finish level on points, the title is decided by this
// chain, applied in order until one of them is ahead. It is the league's single
// definition of "who finished higher", used by driver standings, team
// standings, the stats tables and every career/team page — so a tie is broken
// the same way wherever it's shown.
//
//   1. More Wins            6. More Poles
//   2. More Podiums         7. Better Average Start (lower is better)
//   3. More Top 5s          8. More Best Laps
//   4. More Top 10s         9. More Laps Led
//   5. Better Average Finish (lower is better)
//
// `dir: "asc"` marks the two averages, where a LOWER number is the better
// result (P1 beats P2). Everything else is a count where more is better.
export const TIE_BREAKERS = [
  { key: "wins", label: "Wins", dir: "desc" },
  { key: "podiums", label: "Podiums", dir: "desc" },
  { key: "top5", label: "Top 5s", dir: "desc" },
  { key: "top10", label: "Top 10s", dir: "desc" },
  { key: "avg_finish", label: "Average Finish", dir: "asc", sum: "finish_sum", count: "starts" },
  { key: "poles", label: "Poles", dir: "desc" },
  { key: "avg_start", label: "Average Start", dir: "asc", sum: "start_sum", count: "qualifying_sessions" },
  { key: "best_laps", label: "Best Laps", dir: "desc" },
  { key: "laps_led", label: "Laps Led", dir: "desc" },
];

// A human-readable "Points, then Wins, then Podiums, …" for tooltips/footnotes.
export const TIE_BREAKER_SUMMARY = TIE_BREAKERS.map(t => t.label).join(", then ");

// An average, preferring the exact sum ÷ count over the rounded display value
// so two rows that merely *display* the same average aren't treated as tied.
// Returns null when there's nothing to average (no starts, never qualified).
function averageFor(row, tb) {
  const count = Number(row[tb.count] || 0);
  if (count > 0 && row[tb.sum] != null) return Number(row[tb.sum]) / count;
  return row[tb.key] == null ? null : Number(row[tb.key]);
}

// Compare two rows by the tie-breaker chain alone (points already equal, or
// irrelevant). Returns <0 when `a` ranks higher. A competitor with no average
// at all — nobody to average, e.g. zero starts — never wins that step: they
// sort behind anyone who actually has one, rather than a missing value reading
// as a perfect 0.0.
export function compareByTieBreakers(a, b) {
  for (const tb of TIE_BREAKERS) {
    if (tb.dir === "asc") {
      const av = averageFor(a, tb) ?? Infinity;
      const bv = averageFor(b, tb) ?? Infinity;
      if (av !== bv) return av - bv;
    } else {
      const av = Number(a[tb.key] || 0);
      const bv = Number(b[tb.key] || 0);
      if (av !== bv) return bv - av;
    }
  }
  return 0;
}

// The full championship order: points first, then the tie-breaker chain, then
// (optionally) a name so a dead-even pair still lands in a stable, predictable
// place instead of shuffling between requests.
export function compareStandings(a, b, { pointsKey = "adjusted_points", nameKey = null } = {}) {
  const ap = Number(a[pointsKey] || 0);
  const bp = Number(b[pointsKey] || 0);
  if (ap !== bp) return bp - ap;
  const tie = compareByTieBreakers(a, b);
  if (tie !== 0) return tie;
  if (nameKey) return String(a[nameKey] ?? "").localeCompare(String(b[nameKey] ?? ""));
  return 0;
}

// results should already be passed through decorateRaceBonuses().
// `templatesById` (optional) resolves each result's own points_template_id
// (see lib/pointsTemplatesServer.js), so a Heat/Consolation/Feature session
// scored under a different points system than the season default still
// totals correctly — falls back to the season config when a result carries
// no template of its own.
// `classes` (optional) is the season's class list, so a class scoring on its
// own points structure totals under that structure — in its own championship
// AND in the combined table, where each row is scored under the class its
// driver actually raced in.
export function calculateStandings(results, entries, teams = [], config, templatesById = {}, classes = []) {
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));
  const scorer = makeScorer(results, { config, classes, entriesById, templatesById });

  const byEntry = {};
  for (const r of results) (byEntry[r.entry_id] ??= []).push(r);

  const rows = [];
  for (const [entryId, entryResults] of Object.entries(byEntry)) {
    const entry = entriesById[entryId] || {};
    const team = teamsById[entry.team_id] || {};
    // Championship points come only from race-type sessions (race, heat,
    // consolation, feature) — qualifying results never earn points on their
    // own, only a starting-position bonus folded into the next session, scored
    // against Qualifying's own points structure (see makeScorer) so a points
    // system assigned specifically to Qualifying actually reaches the total.
    // A session whose points toggle is off is skipped even if it carries a
    // points template.
    const raceResults = entryResults.filter(r => !isQualifying(r) && r.counts_points !== false);
    const pointsList = raceResults.map(r => scorer.points(r));
    const totalPoints = pointsList.reduce((a, b) => a + b, 0);

    let droppedPoints = 0;
    if (config.dropWeeks > 0) {
      const sorted = [...pointsList].sort((a, b) => a - b);
      droppedPoints = sorted.slice(0, config.dropWeeks).reduce((a, b) => a + b, 0);
    }

    // Manual admin override for corrections (penalties, import mistakes, …).
    const adjustment = Number(entry.points_adjustment || 0);

    rows.push({
      entry_id: entryId,
      driver_name: entry.name ?? "Unknown",
      driver_number: entry.number ?? null,
      driver_id: entry.driver_id ?? null,
      user_id: entry.user_id ?? null,
      team_id: entry.team_id ?? null,
      team: team.name ?? entry.team ?? "—",
      team_logo_url: team.logo_url ?? null,
      points: totalPoints,
      dropped_points: droppedPoints,
      points_adjustment: adjustment,
      adjustment_note: entry.adjustment_note ?? null,
      adjusted_points: totalPoints - droppedPoints + adjustment,
      ...statLine(entryResults),
    });
  }

  rows.sort((a, b) => compareStandings(a, b, { pointsKey: "adjusted_points", nameKey: "driver_name" }));

  const leader = rows[0]?.adjusted_points ?? 0;
  return {
    drop_weeks: config.dropWeeks,
    rows: rows.map((row, i) => ({
      rank: i + 1,
      behind_leader: leader - row.adjusted_points,
      behind_next: i === 0 ? 0 : rows[i - 1].adjusted_points - row.adjusted_points,
      ...row,
    })),
  };
}

export function calculateTeamStandings(driverRows, teams = []) {
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));
  const byTeam = {};
  for (const row of driverRows) {
    if (!row.team_id) continue;
    const t = (byTeam[row.team_id] ??= {
      team_id: row.team_id,
      team: teamsById[row.team_id]?.name ?? row.team,
      logo_url: teamsById[row.team_id]?.logo_url ?? null,
      points: 0, wins: 0, podiums: 0, top5: 0, poles: 0, drivers: 0,
      // Carried so a team tie breaks on the same chain a driver tie does.
      // The two averages are summed as totals and divided at the end — a team's
      // average finish is over all its drivers' races, not an average of their
      // averages, which would weight a one-race driver like a full-season one.
      top10: 0, best_laps: 0, laps_led: 0,
      starts: 0, finish_sum: 0, qualifying_sessions: 0, start_sum: 0,
    });
    t.points += row.adjusted_points;
    t.wins += row.wins;
    t.podiums += row.podiums;
    t.top5 += row.top5;
    t.top10 += row.top10;
    t.poles += row.poles;
    t.best_laps += row.best_laps;
    t.laps_led += row.laps_led;
    t.starts += row.starts;
    t.finish_sum += row.finish_sum;
    t.qualifying_sessions += row.qualifying_sessions;
    t.start_sum += row.start_sum;
    t.drivers += 1;
  }
  for (const t of Object.values(byTeam)) {
    t.avg_finish = t.starts ? round2(t.finish_sum / t.starts) : null;
    t.avg_start = t.qualifying_sessions ? round2(t.start_sum / t.qualifying_sessions) : null;
  }
  const rows = Object.values(byTeam)
    .sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "team" }));
  return rows.map((row, i) => ({ rank: i + 1, ...row }));
}

// Career aggregation across many seasons; results must carry precomputed
// `points` and the decorated flags.
export function aggregateCareerStats(results, titles = 0) {
  const line = statLine(results);
  return {
    ...line,
    points: results.filter(r => !isQualifying(r)).reduce((a, r) => a + Number(r.points || 0), 0),
    titles,
  };
}
