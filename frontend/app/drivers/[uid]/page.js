"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatStat } from "@/lib/standings";

const STAT_LABELS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["top10", "Top 10s"], ["avg_finish", "Avg Finish"], ["laps_run", "Laps Run"],
  ["laps_led", "Laps Led"], ["most_laps_led", "Most Laps Led"], ["best_laps", "Best Laps"],
  ["poles", "Poles"], ["avg_start", "Avg Start"], ["dnfs", "DNFs"],
  ["provisionals", "Provisionals"], ["titles", "Titles"], ["points", "Points"],
];

// Per-track table columns — the venue-specific slice of a driver's career.
const TRACK_COLUMNS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["poles", "Poles"], ["best_laps", "Fastest Laps"], ["avg_start", "Avg Start"],
  ["avg_finish", "Avg Finish"], ["laps_led", "Laps Led"],
];

export default function DriverProfilePage() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gameFilter, setGameFilter] = useState("all");
  const [view, setView] = useState("career"); // "career" | "tracks"

  useEffect(() => {
    api(`/api/drivers/${uid}`).then(setData).catch(err => setError(err.message));
  }, [uid]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏎</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { profile, all_games, by_game, by_track = [], linked, skill_rating } = data;
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
          {skill_rating != null && (
            <Link href="/skill-ratings" className="page-badge" title="Global Skill Rating" style={{ marginLeft: profile.country ? 8 : 0 }}>
              📈 Skill Rating {skill_rating}
            </Link>
          )}
          {!linked && (
            <span className="page-badge" style={{ background: "transparent", border: "1px solid var(--ink-2)", color: "var(--ink-2)", marginLeft: profile.country ? 8 : 0 }}>
              ⛓️‍💥 Not linked to an account
            </span>
          )}
          {profile.bio && <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 560 }}>{profile.bio}</p>}
          {!linked && (
            <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: "0.85rem", maxWidth: 560 }}>
              These stats are tracked from race results. No player account has claimed this driver yet, so there's no profile photo, bio, or country.
            </p>
          )}
        </div>
      </div>

      <div className="tab-row" style={{ marginTop: 24 }}>
        <button className={`tab${view === "career" ? " active" : ""}`} onClick={() => setView("career")}>Career Stats</button>
        <button className={`tab${view === "tracks" ? " active" : ""}`} onClick={() => setView("tracks")}>Per Track Stats</button>
      </div>

      {view === "career" ? (
        <>
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
                  <div className="metric-num">{formatStat(key, stats[key])}</div>
                  <div className="metric-label">{label}</div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="section-header"><h3>Per Track Stats</h3></div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ink-1)", fontSize: "0.88rem" }}>
            Every venue this driver has raced at, with their accumulated results there.
          </p>
          {by_track.length === 0 ? (
            <div className="empty-state"><span className="empty-state-icon">🏁</span><p>No track results recorded yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="sticky-col" style={{ textAlign: "left" }}>Track</th>
                    {TRACK_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {by_track.map(t => (
                    <tr key={t.track_id || t.track_name}>
                      <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                        {t.track_id
                          ? <Link href={`/tracks/${t.track_id}`} style={{ color: "var(--accent-cyan)" }}>{t.track_name}</Link>
                          : t.track_name}
                        {t.track_location && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{t.track_location}</span>}
                      </td>
                      {TRACK_COLUMNS.map(([key]) => <td key={key}>{formatStat(key, t.stats[key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === "career" && by_game.length > 0 && (
        <>
          <div className="section-header"><h3>By Game</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Game</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Top 5s</th><th>Poles</th><th>Titles</th><th>Points</th><th>Avg Finish</th></tr></thead>
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
                    <td>{g.stats.poles}</td>
                    <td>{g.stats.titles}</td>
                    <td className="points-cell">{g.stats.points}</td>
                    <td>{formatStat("avg_finish", g.stats.avg_finish)}</td>
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
