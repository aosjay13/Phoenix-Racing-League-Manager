"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatStat } from "@/lib/standings";
import { useLeague } from "@/components/LeagueProvider";

const DRIVER_COLS = [
  ["starts", "Races"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["poles", "Poles"], ["best_laps", "Best Laps"], ["laps_led", "Laps Led"], ["avg_finish", "Avg Fin"],
];

// Venue "records" — the single leader for each headline stat, drawn from the
// per-driver leaderboard (already sorted so [0] is the winningest driver).
function records(drivers) {
  const leaderBy = key => {
    let best = null;
    for (const d of drivers) {
      const v = Number(d[key] || 0);
      if (v > 0 && (best == null || v > Number(best[key] || 0))) best = d;
    }
    return best;
  };
  return [
    { label: "Most Wins", key: "wins", d: leaderBy("wins") },
    { label: "Most Poles", key: "poles", d: leaderBy("poles") },
    { label: "Most Best Laps", key: "best_laps", d: leaderBy("best_laps") },
    { label: "Most Laps Led", key: "laps_led", d: leaderBy("laps_led") },
  ];
}

export default function TrackProfilePage() {
  const { id } = useParams();
  const { gameId, seriesId, seasonId } = useLeague();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("records"); // "records" | "results"

  // Scope the venue stats to the top-of-page Game/Series/Season dropdowns, and
  // re-fetch whenever that context changes.
  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (seasonId) params.set("season_id", seasonId);
    else if (seriesId) params.set("series_id", seriesId);
    else if (gameId) params.set("game_id", gameId);
    const qs = params.toString();
    api(`/api/tracks/${id}${qs ? `?${qs}` : ""}`).then(setData).catch(err => setError(err.message));
  }, [id, gameId, seriesId, seasonId]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { track, races_held, seasons_raced, drivers, winners, record } = data;
  const recs = records(drivers);

  return (
    <section>
      <div className="hero" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        {track.logo_url
          ? <img src={track.logo_url} alt="" className="avatar avatar-xl" style={{ borderRadius: 12 }} />
          : <span className="avatar avatar-xl avatar-fallback" style={{ borderRadius: 12 }}>🏁</span>}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="page-title" style={{ marginBottom: 2 }}><h2>{track.name}</h2></div>
          <span className="page-badge">
            {races_held} Race{races_held === 1 ? "" : "s"} · {seasons_raced} Season{seasons_raced === 1 ? "" : "s"}
          </span>
          <p style={{ marginTop: 8, color: "var(--ink-1)", fontSize: "0.9rem" }}>
            {[track.location, track.track_type, track.length].filter(Boolean).join(" · ") || "Venue"}
          </p>
          {track.notes && <p style={{ marginTop: 4, color: "var(--ink-2)", fontSize: "0.85rem" }}>{track.notes}</p>}
        </div>
      </div>

      {races_held === 0 ? (
        <div className="empty-state" style={{ marginTop: 24 }}>
          <span className="empty-state-icon">📊</span>
          <p>{(gameId || seriesId || seasonId)
            ? "No races held here in the current selection — adjust the Game / Series / Season filters at the top."
            : "No races have been held here yet. Assign this track to a race in League Setup."}</p>
        </div>
      ) : (
        <>
          <div className="tab-row" style={{ marginTop: 18 }}>
            <button className={`tab${tab === "records" ? " active" : ""}`} onClick={() => setTab("records")}>Records</button>
            <button className={`tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>
              Past Results{winners.length ? ` (${winners.length})` : ""}
            </button>
          </div>

          {tab === "records" ? (
            <>
              {record && (
                <article className="metric-card" style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", borderColor: "var(--accent-cyan)" }}>
                  <span style={{ fontSize: "2rem" }}>⏱</span>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="metric-label" style={{ marginBottom: 2 }}>Track Record (Fastest Lap)</div>
                    <div className="metric-num" style={{ fontVariantNumeric: "tabular-nums" }}>{record.time}</div>
                    <div style={{ color: "var(--ink-1)", fontSize: "0.85rem", marginTop: 2 }}>
                      {(record.driver_id || record.user_id)
                        ? <Link href={`/drivers/${record.driver_id || record.user_id}`} style={{ color: "var(--accent-cyan)" }}>{record.driver_name}</Link>
                        : record.driver_name}
                      {record.race_name ? ` · ${record.race_name}` : ""}
                      {record.season_name ? ` · ${record.season_name}` : ""}
                    </div>
                  </div>
                </article>
              )}

              <div className="section-header"><h3>Venue Records</h3></div>
              <div className="metrics" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {recs.map(r => (
                  <article className="metric-card" key={r.label}>
                    <div className="metric-num" style={{ fontSize: "1.1rem" }}>
                      {r.d ? <>{r.d.driver_name} <span style={{ color: "var(--ink-2)" }}>({formatStat(r.key, r.d[r.key])})</span></> : "—"}
                    </div>
                    <div className="metric-label">{r.label}</div>
                  </article>
                ))}
              </div>

              <div className="section-header"><h3>Driver History Here</h3></div>
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
            </>
          ) : (
            <>
              <div className="section-header"><h3>Past Results</h3></div>
              {winners.length === 0 ? (
                <p style={{ color: "var(--ink-1)" }}>No completed events with a recorded winner yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th className="sticky-col" style={{ textAlign: "left" }}>Event</th>
                        <th style={{ textAlign: "left" }}>Series</th>
                        <th style={{ textAlign: "left" }}>Season</th>
                        <th>Date</th>
                        <th style={{ textAlign: "left" }}>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {winners.map(w => (
                        <tr key={w.race_id}>
                          <td className="sticky-col" style={{ textAlign: "left" }}>
                            <Link href={`/races/${w.race_id}`} style={{ color: "var(--accent-cyan)" }}>
                              {w.round_number != null ? `R${w.round_number} · ` : ""}{w.race_name}
                            </Link>
                          </td>
                          <td style={{ textAlign: "left" }}>{w.series_name || "—"}</td>
                          <td style={{ textAlign: "left" }}>{w.season_name}</td>
                          <td>{w.date || "—"}</td>
                          <td style={{ textAlign: "left" }}>
                            {(w.driver_id || w.user_id)
                              ? <Link href={`/drivers/${w.driver_id || w.user_id}`} style={{ color: "var(--accent-cyan)" }}>{w.driver_name}</Link>
                              : w.driver_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
