"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

const STAT_LABELS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5"],
  ["top10", "Top 10"], ["points", "Points"], ["laps_led", "Laps Led"],
  ["avg_finish", "Avg Finish"], ["best_finish", "Best Finish"],
];

export default function DriverProfilePage() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gameFilter, setGameFilter] = useState("all");

  useEffect(() => {
    api(`/api/users/${uid}`).then(setData).catch(err => setError(err.message));
  }, [uid]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏎</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { profile, all_games, by_game } = data;
  const stats = gameFilter === "all"
    ? all_games
    : by_game.find(g => g.game_id === gameFilter)?.stats ?? all_games;

  return (
    <section>
      <div className="hero" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        {profile.photo_url
          ? <img src={profile.photo_url} alt="" className="avatar avatar-xl" />
          : <span className="avatar avatar-xl avatar-fallback">{String(profile.display_name || "?")[0]?.toUpperCase()}</span>}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="page-title" style={{ marginBottom: 2 }}>
            <h2>
              {profile.display_name}
              {profile.number != null && <span style={{ color: "var(--accent-gold)", marginLeft: 10 }}>#{profile.number}</span>}
            </h2>
          </div>
          {profile.country && <span className="page-badge">{profile.country}</span>}
          {profile.bio && <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 560 }}>{profile.bio}</p>}
        </div>
      </div>

      <div className="section-header">
        <h3>Career Stats</h3>
        <div className="context-select">
          <select value={gameFilter} onChange={e => setGameFilter(e.target.value)}>
            <option value="all">All Games</option>
            {by_game.map(g => <option key={g.game_id} value={g.game_id}>{g.game_name}</option>)}
          </select>
        </div>
      </div>

      {stats.starts === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">📊</span><p>No race results recorded yet.</p></div>
      ) : (
        <div className="metrics" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {STAT_LABELS.map(([key, label]) => (
            <article className="metric-card" key={key}>
              <div className="metric-num">{stats[key] ?? "—"}</div>
              <div className="metric-label">{label}</div>
            </article>
          ))}
        </div>
      )}

      {by_game.length > 0 && (
        <>
          <div className="section-header"><h3>By Game</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Game</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Top 5</th><th>Points</th><th>Avg Finish</th></tr></thead>
              <tbody>
                {by_game.map(g => (
                  <tr key={g.game_id}>
                    <td className="driver-name-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {g.game_logo_url && <img src={g.game_logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                      {g.game_name}
                    </td>
                    <td>{g.stats.starts}</td>
                    <td>{g.stats.wins}</td>
                    <td>{g.stats.podiums}</td>
                    <td>{g.stats.top5}</td>
                    <td className="points-cell">{g.stats.points}</td>
                    <td>{g.stats.avg_finish}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
