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

function parseMaybeJson(value, fallback) {
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

// Mark per-race derived flags (most laps led) before scoring.
export function decorateRaceBonuses(results) {
  const byRace = {};
  for (const r of results) (byRace[r.race_id] ??= []).push(r);
  const out = [];
  for (const raceResults of Object.values(byRace)) {
    const maxLed = Math.max(0, ...raceResults.map(r => Number(r.laps_led || 0)));
    for (const r of raceResults) {
      out.push({ ...r, is_most_laps_led: maxLed > 0 && Number(r.laps_led || 0) === maxLed });
    }
  }
  return out;
}

export function pointsFor(result, config) {
  const { racePoints, qualPoints, bonuses } = config;
  let pts = Number(racePoints[result.finish_pos] ?? 0);
  if (result.start_pos != null && result.start_pos !== "") {
    pts += Number(qualPoints[result.start_pos] ?? 0);
  }
  if (Number(result.start_pos) === 1) pts += Number(bonuses.pole || 0);
  if (result.fastest_lap) pts += Number(bonuses.best_lap || 0);
  if (result.is_most_laps_led) pts += Number(bonuses.most_laps_led || 0);
  if (Number(result.laps_led || 0) > 0) pts += Number(bonuses.lead_a_lap || 0);
  if (result.halfway_leader) pts += Number(bonuses.halfway_point || 0);
  if (result.hard_charger) pts += Number(bonuses.hard_charger || 0);
  pts += Number(result.bonus_points || 0) - Number(result.penalty_points || 0);
  return pts;
}

function statLine(rs) {
  const starts = rs.length;
  const started = rs.filter(r => r.start_pos != null && r.start_pos !== "");
  const sum = fn => rs.reduce((a, r) => a + fn(r), 0);
  return {
    starts,
    wins: rs.filter(r => r.finish_pos === 1).length,
    podiums: rs.filter(r => r.finish_pos <= 3).length,
    top5: rs.filter(r => r.finish_pos <= 5).length,
    top10: rs.filter(r => r.finish_pos <= 10).length,
    avg_finish: starts ? Math.round((sum(r => r.finish_pos) / starts) * 100) / 100 : null,
    laps_run: sum(r => Number(r.laps || 0)),
    laps_led: sum(r => Number(r.laps_led || 0)),
    most_laps_led: rs.filter(r => r.is_most_laps_led).length,
    best_laps: rs.filter(r => r.fastest_lap).length,
    poles: rs.filter(r => Number(r.start_pos) === 1).length,
    avg_start: started.length
      ? Math.round((started.reduce((a, r) => a + Number(r.start_pos), 0) / started.length) * 100) / 100
      : null,
    dnfs: rs.filter(r => r.status === "dnf").length,
    provisionals: rs.filter(r => r.provisional).length,
    incidents: sum(r => Number(r.incidents || 0)),
    best_finish: starts ? Math.min(...rs.map(r => r.finish_pos)) : null,
  };
}

// results should already be passed through decorateRaceBonuses().
export function calculateStandings(results, entries, teams = [], config) {
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));

  const byEntry = {};
  for (const r of results) (byEntry[r.entry_id] ??= []).push(r);

  const rows = [];
  for (const [entryId, entryResults] of Object.entries(byEntry)) {
    const entry = entriesById[entryId] || {};
    const team = teamsById[entry.team_id] || {};
    const pointsList = entryResults.map(r => pointsFor(r, config));
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
    points: results.reduce((a, r) => a + Number(r.points || 0), 0),
    titles,
  };
}
