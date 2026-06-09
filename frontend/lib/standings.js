export const DEFAULT_POINTS_SCALE = {
  1: 40, 2: 35, 3: 32, 4: 30, 5: 28, 6: 26, 7: 24, 8: 22, 9: 20, 10: 18,
  11: 16, 12: 14, 13: 12, 14: 10, 15: 8, 16: 6, 17: 4, 18: 2, 19: 1, 20: 1,
};

export function calculateStandings(results, drivers, season, dropWeeks = 0, pointsScale = DEFAULT_POINTS_SCALE) {
  if (!results.length) {
    return { season, drop_weeks: dropWeeks, points_scale: pointsScale, rows: [] };
  }

  const driversByUid = Object.fromEntries(drivers.map(d => [d.uid, d]));

  const byDriver = {};
  for (const r of results) {
    if (!byDriver[r.driver_uid]) byDriver[r.driver_uid] = [];
    byDriver[r.driver_uid].push(r);
  }

  const rows = [];

  for (const [driverUid, driverResults] of Object.entries(byDriver)) {
    const driver = driversByUid[driverUid] || {};
    const pointsList = driverResults.map(r => pointsScale[r.finish_pos] ?? 0);
    const totalPoints = pointsList.reduce((a, b) => a + b, 0);

    let droppedPoints = 0;
    if (dropWeeks > 0) {
      const sorted = [...pointsList].sort((a, b) => a - b);
      droppedPoints = sorted.slice(0, dropWeeks).reduce((a, b) => a + b, 0);
    }

    const wins = driverResults.filter(r => r.finish_pos === 1).length;
    const top5 = driverResults.filter(r => r.finish_pos <= 5).length;
    const avgFinish = driverResults.reduce((a, r) => a + r.finish_pos, 0) / driverResults.length;

    rows.push({
      driver_uid: driverUid,
      driver_name: driver.name ?? "Unknown",
      team: driver.team ?? "Unknown",
      points: totalPoints,
      dropped_points: droppedPoints,
      adjusted_points: totalPoints - droppedPoints,
      wins,
      top5,
      avg_finish: Math.round(avgFinish * 100) / 100,
    });
  }

  rows.sort((a, b) => {
    if (b.adjusted_points !== a.adjusted_points) return b.adjusted_points - a.adjusted_points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.top5 !== a.top5) return b.top5 - a.top5;
    return a.avg_finish - b.avg_finish;
  });

  return {
    season,
    drop_weeks: dropWeeks,
    points_scale: pointsScale,
    rows: rows.map((row, i) => ({ rank: i + 1, ...row })),
  };
}
