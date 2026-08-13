"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatStat } from "@/lib/standings";

const STAT_LABELS = [
  ["points", "Points"], ["titles", "Titles"], ["starts", "Starts"], ["wins", "Wins"],
  ["podiums", "Podiums"], ["top5", "Top 5s"], ["top10", "Top 10s"], ["avg_finish", "Avg Finish"],
  ["laps_led", "Laps Led"], ["most_laps_led", "Most Laps Led"], ["best_laps", "Best Laps"],
  ["poles", "Poles"], ["avg_start", "Avg Start"], ["dnfs", "DNFs"],
];

const DRIVER_COLS = [
  ["points", "Points"], ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"],
  ["top5", "Top 5s"], ["poles", "Poles"], ["avg_finish", "Avg Fin"], ["titles", "Titles"],
];

export default function TeamProfilePage() {
  const { team } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // The route segment is the team's id, but older links (and anything shared
  // before teams became documents) carry its NAME instead — /api/team-stats
  // accepts either. useParams() returns the segment still percent-encoded, so
  // decode it before re-encoding for the API call; decodeURIComponent is a safe
  // no-op when the value is already plain text.
  const teamKey = (() => {
    const raw = Array.isArray(team) ? team[0] : team;
    try { return decodeURIComponent(raw ?? ""); } catch { return raw ?? ""; }
  })();

  useEffect(() => {
    if (!teamKey) return;
    api(`/api/team-stats?team=${encodeURIComponent(teamKey)}`).then(setData).catch(err => setError(err.message));
  }, [teamKey]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { team_name, logo_url, color, stats, drivers, seasons, seasons_raced, seasons_entered } = data;

  return (
    <section>
      <div className="hero" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        {logo_url
          ? <img src={logo_url} alt="" className="avatar avatar-xl" style={{ borderRadius: 12 }} />
          : <span className="avatar avatar-xl avatar-fallback" style={color ? { background: color } : undefined}>{String(team_name || "?")[0]?.toUpperCase()}</span>}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="page-title" style={{ marginBottom: 2 }}><h2>{team_name}</h2></div>
          <span className="page-badge">{seasons_entered ?? seasons_raced} Season{(seasons_entered ?? seasons_raced) === 1 ? "" : "s"} · {drivers.length} Driver{drivers.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="section-header"><h3>Team Career Stats</h3></div>
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

      <div className="section-header"><h3>Drivers</h3></div>
      {drivers.length === 0 ? (
        <p style={{ color: "var(--ink-1)" }}>No driver results yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sticky-col" style={{ textAlign: "left" }}>Driver</th>
                {DRIVER_COLS.map(([key, label]) => <th key={key}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={(d.driver_id ?? d.user_id ?? "") + d.driver_name}>
                  <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                    {(d.driver_id || d.user_id)
                      ? <Link href={`/drivers/${d.driver_id || d.user_id}`} style={{ color: "var(--accent-cyan)" }}>{d.driver_name}</Link>
                      : d.driver_name}
                  </td>
                  {DRIVER_COLS.map(([key]) => <td key={key}>{formatStat(key, d[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {seasons.length > 0 && (
        <>
          <div className="section-header"><h3>By Season</h3></div>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
            Each season&rsquo;s total is what that season&rsquo;s line-up scored; the career stats above are
            these seasons added together.
          </p>
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="sticky-col" style={{ textAlign: "left" }}>Season</th>
                  <th style={{ textAlign: "left" }}>Line-up</th>
                  <th>Points</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Poles</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map(s => (
                  <tr key={s.season_id}>
                    <td className="sticky-col" style={{ textAlign: "left" }}>{s.season_name}</td>
                    <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{(s.drivers ?? []).join(", ") || "—"}</td>
                    <td>{s.points}</td><td>{s.starts}</td><td>{s.wins}</td><td>{s.podiums}</td><td>{s.poles}</td>
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
