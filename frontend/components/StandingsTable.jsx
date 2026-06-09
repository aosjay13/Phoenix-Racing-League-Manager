function RankBadge({ rank }) {
  const cls =
    rank === 1 ? "rank-badge rank-p1" :
    rank === 2 ? "rank-badge rank-p2" :
    rank === 3 ? "rank-badge rank-p3" :
                 "rank-badge rank-default";
  return <span className={cls}>{rank}</span>;
}

export function StandingsTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 52 }}>Rank</th>
            <th>Driver</th>
            <th>Team</th>
            <th>Pts</th>
            <th>Wins</th>
            <th>Top 5</th>
            <th>Avg Fin.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.driver_uid}>
              <td><RankBadge rank={row.rank} /></td>
              <td className="driver-name-cell">{row.driver_name}</td>
              <td className="team-cell">{row.team}</td>
              <td className="points-cell">{row.adjusted_points}</td>
              <td>{row.wins}</td>
              <td>{row.top5}</td>
              <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink-1)" }}>
                {Number(row.avg_finish).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
