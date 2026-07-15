export const DEFAULT_POINTS_SCALE = {
  1: 40, 2: 35, 3: 32, 4: 30, 5: 28, 6: 26, 7: 24, 8: 22, 9: 20, 10: 18,
  11: 16, 12: 14, 13: 12, 14: 10, 15: 8, 16: 6, 17: 4, 18: 2, 19: 1, 20: 1,
};

export function pointsFor(result, pointsScale) {
  const base = pointsScale[result.finish_pos] ?? 0;
  const bonus = Number(result.bonus_points || 0);
  const penalty = Number(result.penalty_points || 0);
  return base + bonus - penalty;
}

// results: [{entry_id, finish_pos, laps_led, incidents, ...}]
// entries: season roster [{id, name, number, team_id, user_id}]
// teams:   [{id, name, logo_url}]
export function calculateStandings(results, entries, teams = [], dropWeeks = 0, pointsScale = DEFAULT_POINTS_SCALE) {
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));

  const byEntry = {};
  for (const r of results) {
    (byEntry[r.entry_id] ??= []).push(r);
  }

  const rows = [];
  for (const [entryId, entryResults] of Object.entries(byEntry)) {
    const entry = entriesById[entryId] || {};
    const team = teamsById[entry.team_id] || {};
    const pointsList = entryResults.map(r => pointsFor(r, pointsScale));
    const totalPoints = pointsList.reduce((a, b) => a + b, 0);

    let droppedPoints = 0;
    if (dropWeeks > 0) {
      const sorted = [...pointsList].sort((a, b) => a - b);
      droppedPoints = sorted.slice(0, dropWeeks).reduce((a, b) => a + b, 0);
    }

    const wins = entryResults.filter(r => r.finish_pos === 1).length;
    const podiums = entryResults.filter(r => r.finish_pos <= 3).length;
    const top5 = entryResults.filter(r => r.finish_pos <= 5).length;
    const top10 = entryResults.filter(r => r.finish_pos <= 10).length;
    const lapsLed = entryResults.reduce((a, r) => a + Number(r.laps_led || 0), 0);
    const incidents = entryResults.reduce((a, r) => a + Number(r.incidents || 0), 0);
    const avgFinish = entryResults.reduce((a, r) => a + r.finish_pos, 0) / entryResults.length;

    rows.push({
      entry_id: entryId,
      driver_name: entry.name ?? "Unknown",
      driver_number: entry.number ?? null,
      user_id: entry.user_id ?? null,
      team_id: entry.team_id ?? null,
      team: team.name ?? entry.team ?? "—",
      team_logo_url: team.logo_url ?? null,
      starts: entryResults.length,
      points: totalPoints,
      dropped_points: droppedPoints,
      adjusted_points: totalPoints - droppedPoints,
      wins,
      podiums,
      top5,
      top10,
      laps_led: lapsLed,
      incidents,
      avg_finish: Math.round(avgFinish * 100) / 100,
    });
  }

  rows.sort((a, b) => {
    if (b.adjusted_points !== a.adjusted_points) return b.adjusted_points - a.adjusted_points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.top5 !== a.top5) return b.top5 - a.top5;
    return a.avg_finish - b.avg_finish;
  });

  return { drop_weeks: dropWeeks, rows: rows.map((row, i) => ({ rank: i + 1, ...row })) };
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
      points: 0, wins: 0, podiums: 0, top5: 0, drivers: 0,
    });
    t.points += row.adjusted_points;
    t.wins += row.wins;
    t.podiums += row.podiums;
    t.top5 += row.top5;
    t.drivers += 1;
  }
  const rows = Object.values(byTeam).sort((a, b) =>
    b.points - a.points || b.wins - a.wins || b.top5 - a.top5
  );
  return rows.map((row, i) => ({ rank: i + 1, ...row }));
}

// Aggregate career stats from raw results (already joined with points per season).
export function aggregateCareerStats(resultsWithPoints) {
  const starts = resultsWithPoints.length;
  if (!starts) {
    return { starts: 0, wins: 0, podiums: 0, top5: 0, top10: 0, laps_led: 0, incidents: 0, points: 0, avg_finish: null, best_finish: null };
  }
  const sum = (fn) => resultsWithPoints.reduce((a, r) => a + fn(r), 0);
  return {
    starts,
    wins: resultsWithPoints.filter(r => r.finish_pos === 1).length,
    podiums: resultsWithPoints.filter(r => r.finish_pos <= 3).length,
    top5: resultsWithPoints.filter(r => r.finish_pos <= 5).length,
    top10: resultsWithPoints.filter(r => r.finish_pos <= 10).length,
    laps_led: sum(r => Number(r.laps_led || 0)),
    incidents: sum(r => Number(r.incidents || 0)),
    points: sum(r => Number(r.points || 0)),
    avg_finish: Math.round((sum(r => r.finish_pos) / starts) * 100) / 100,
    best_finish: Math.min(...resultsWithPoints.map(r => r.finish_pos)),
  };
}
