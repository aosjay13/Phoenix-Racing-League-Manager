"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

function RankBadge({ rank }) {
  const cls = rank === 1 ? "rank-p1" : rank === 2 ? "rank-p2" : rank === 3 ? "rank-p3" : "rank-default";
  return <span className={`rank-badge ${cls}`}>{rank}</span>;
}

export default function StandingsPage() {
  const { seasonId, season } = useLeague();
  const [tab, setTab] = useState("drivers");
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!seasonId) { setData(null); return; }
    api(`/api/standings?season_id=${seasonId}`).then(setData).catch(() => setData(null));
  }, [seasonId]);

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">🏆</span><p>Select a game, series and season above.</p></div>;
  }

  const rows = data?.[tab] ?? [];

  return (
    <section>
      <div className="page-title">
        <h2>Standings · {season?.name ?? ""}</h2>
        {data?.drop_weeks > 0 && <span className="page-badge">{data.drop_weeks} Drop Week{data.drop_weeks > 1 ? "s" : ""} Applied</span>}
      </div>

      <div className="tab-row">
        <button className={`tab${tab === "drivers" ? " active" : ""}`} onClick={() => setTab("drivers")}>Drivers</button>
        <button className={`tab${tab === "teams" ? " active" : ""}`} onClick={() => setTab("teams")}>Teams</button>
      </div>

      {!data ? (
        <div className="skeleton" style={{ height: 240, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏆</span>
          <p>No results yet for this season.</p>
        </div>
      ) : tab === "drivers" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pos</th><th>Driver</th><th>Team</th><th>Points</th><th>Wins</th>
                <th>Top 5</th><th>Top 10</th><th>Laps Led</th><th>Avg Finish</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.entry_id}>
                  <td><RankBadge rank={r.rank} /></td>
                  <td className="driver-name-cell">
                    {r.user_id
                      ? <Link href={`/drivers/${r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
                      : r.driver_name}
                    {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
                  </td>
                  <td className="team-cell">{r.team}</td>
                  <td className="points-cell">{r.adjusted_points}</td>
                  <td>{r.wins}</td>
                  <td>{r.top5}</td>
                  <td>{r.top10}</td>
                  <td>{r.laps_led}</td>
                  <td>{r.avg_finish}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Pos</th><th>Team</th><th>Points</th><th>Wins</th><th>Podiums</th><th>Drivers</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.team_id}>
                  <td><RankBadge rank={r.rank} /></td>
                  <td className="driver-name-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {r.logo_url && <img src={r.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                    {r.team}
                  </td>
                  <td className="points-cell">{r.points}</td>
                  <td>{r.wins}</td>
                  <td>{r.podiums}</td>
                  <td>{r.drivers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
