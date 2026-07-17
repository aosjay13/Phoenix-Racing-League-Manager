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

export const BONUS_TYPES = [
  ["pole", "Pole Bonus"],
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

// Whether a session counts toward stats/points by default, before any admin
// override. Preliminary sessions (heats, consolations/B- & C-Mains) are off by
// default so they don't skew a driver's global Win/Top-5/Average-Finish metrics
// or award championship points; standard races, the feature, and qualifying are
// on. Admin toggles (race.session_stats / session_points_enabled, keyed by
// session name) override these per session.
export function defaultSessionFlags(sessionType) {
  const preliminary = sessionType === "heat" || sessionType === "consolation";
  return { counts_stats: !preliminary, counts_points: !preliminary };
}

// Resolve a result's stats/points flags: an explicit admin toggle on the race
// doc wins; otherwise the session-type default applies.
export function resolveSessionFlags(result, racesById = {}) {
  const race = racesById[result.race_id] || {};
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const name = result.session || firstStd;
  const def = defaultSessionFlags(result.session_type || "race");
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
export function decorateRaceBonuses(results) {
  const byRace = {};
  for (const r of results) (byRace[`${r.race_id}|${r.session || ""}`] ??= []).push(r);
  const out = [];
  for (const raceResults of Object.values(byRace)) {
    const maxLed = Math.max(0, ...raceResults.map(r => Number(r.laps_led || 0)));
    for (const r of raceResults) {
      out.push({ ...r, is_most_laps_led: maxLed > 0 && Number(r.laps_led || 0) === maxLed });
    }
  }
  return out;
}

// `qualPos` is the driver's actual Qualifying finish position for this race
// (looked up separately — see buildQualPosMap), not a copy stored on the
// race result itself. That's the only source of starting-position info now;
// there is no editable "Start" field on race/heat/consolation/feature rows.
// `qualConfig` resolves the qualifying-position bonus against the Qualifying
// session's OWN assigned points system (see buildQualTemplateMap) — falling
// back to `config` (the race result's own template) when Qualifying carries
// no override of its own, so a session-specific Qualifying points structure
// actually reaches the standings total instead of being silently ignored.
export function pointsFor(result, config, qualPos = null, qualConfig = null) {
  const { racePoints, bonuses } = config;
  const qualPoints = (qualConfig || config).qualPoints;
  let pts = Number(racePoints[result.finish_pos] ?? 0);
  if (qualPos != null) {
    pts += Number(qualPoints[qualPos] ?? 0);
    if (Number(qualPos) === 1) pts += Number(bonuses.pole || 0);
  }
  if (result.fastest_lap) pts += Number(bonuses.best_lap || 0);
  if (result.is_most_laps_led) pts += Number(bonuses.most_laps_led || 0);
  if (Number(result.laps_led || 0) > 0) pts += Number(bonuses.lead_a_lap || 0);
  if (result.halfway_leader) pts += Number(bonuses.halfway_point || 0);
  if (result.hard_charger) pts += Number(bonuses.hard_charger || 0);
  pts += Number(result.bonus_points || 0) - Number(result.penalty_points || 0);
  return pts;
}

// race_id|entry_id -> that driver's Qualifying finish position, from
// whichever qualifying-type results are present in the given result set.
export function buildQualPosMap(results) {
  const map = {};
  for (const r of results) {
    if (r.session_type === "qualifying") map[`${r.race_id}|${r.entry_id}`] = Number(r.finish_pos);
  }
  return map;
}

// race_id -> the Qualifying session's own points_template_id (or null for the
// season default), so the qualifying-position bonus folded into a race result
// (see pointsFor) can be resolved against the actual points system assigned
// to Qualifying rather than whatever template the race session happens to use.
export function buildQualTemplateMap(results) {
  const map = {};
  for (const r of results) {
    if (r.session_type === "qualifying") map[r.race_id] = r.points_template_id || null;
  }
  return map;
}

const round2 = n => Math.round(n * 100) / 100;

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
  // A race session with its stats toggle off is ignored for finishing-position
  // metrics (Wins, Top 5s, Average Finish, Laps Led, …). Qualifying always
  // feeds Poles/Average Start.
  const rs = results.filter(r => !isQualifying(r) && r.counts_stats !== false);
  const qs = results.filter(r => isQualifying(r));
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
    laps_run: sum(r => Number(r.laps || 0)),
    laps_led: sum(r => Number(r.laps_led || 0)),
    most_laps_led: rs.filter(r => r.is_most_laps_led).length,
    best_laps: rs.filter(r => r.fastest_lap).length,
    poles,
    qualifying_sessions: qs.length,
    avg_start: positions.length ? round2(positions.reduce((a, b) => a + b, 0) / positions.length) : null,
    dnfs: rs.filter(r => r.status === "dnf").length,
    provisionals: rs.filter(r => r.provisional).length,
    incidents: sum(r => Number(r.incidents || 0)),
    best_finish: starts ? Math.min(...rs.map(r => r.finish_pos)) : null,
  };
}

// results should already be passed through decorateRaceBonuses().
// `templatesById` (optional) resolves each result's own points_template_id
// (see lib/pointsTemplatesServer.js), so a Heat/Consolation/Feature session
// scored under a different points system than the season default still
// totals correctly — falls back to the season config when a result carries
// no template of its own.
export function calculateStandings(results, entries, teams = [], config, templatesById = {}) {
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));
  const configFor = r => configForTemplate(config, templatesById[r.points_template_id]);
  const qualPosMap = buildQualPosMap(results);
  const qualTemplateByRace = buildQualTemplateMap(results);
  const qualConfigFor = r => configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]]);

  const byEntry = {};
  for (const r of results) (byEntry[r.entry_id] ??= []).push(r);

  const rows = [];
  for (const [entryId, entryResults] of Object.entries(byEntry)) {
    const entry = entriesById[entryId] || {};
    const team = teamsById[entry.team_id] || {};
    // Championship points come only from race-type sessions (race, heat,
    // consolation, feature) — qualifying results never earn points on their
    // own, only a starting-position bonus folded into the next session, scored
    // against Qualifying's own points structure (qualConfigFor) so a points
    // system assigned specifically to Qualifying actually reaches the total.
    // A session whose points toggle is off is skipped even if it carries a
    // points template.
    const raceResults = entryResults.filter(r => !isQualifying(r) && r.counts_points !== false);
    const pointsList = raceResults.map(r => pointsFor(r, configFor(r), qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null, qualConfigFor(r)));
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

  rows.sort((a, b) => {
    if (b.adjusted_points !== a.adjusted_points) return b.adjusted_points - a.adjusted_points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.top5 !== a.top5) return b.top5 - a.top5;
    return (a.avg_finish ?? 99) - (b.avg_finish ?? 99);
  });

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
    });
    t.points += row.adjusted_points;
    t.wins += row.wins;
    t.podiums += row.podiums;
    t.top5 += row.top5;
    t.poles += row.poles;
    t.drivers += 1;
  }
  const rows = Object.values(byTeam).sort((a, b) =>
    b.points - a.points || b.wins - a.wins || b.top5 - a.top5
  );
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
