"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";

function DriverCell({ r }) {
  return (
    <>
      {r.user_id
        ? <Link href={`/drivers/${r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
        : r.driver_name}
      {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
    </>
  );
}

function statusLabel(s) {
  return s === "finished" ? "Running" : (s || "").toUpperCase();
}

export default function EventResultsPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null); // "qual" or session name

  useEffect(() => {
    api(`/api/events/${id}`)
      .then(d => {
        setData(d);
        const withResults = d.sessions.find(s => s.results.length);
        setTab(withResults ? withResults.name : (d.sessions[0]?.name ?? null));
      })
      .catch(err => setError(err.message));
  }, [id]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { event, season, sessions } = data;
  const hasQualifying = sessions.some(s => s.qualifying.length);
  const activeSession = sessions.find(s => s.name === tab);

  return (
    <section>
      <div className="hero" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        {event.track_logo_url
          ? <img src={event.track_logo_url} alt="" className="avatar avatar-xl" style={{ borderRadius: 14 }} />
          : <div className="round-num" style={{ width: 72, height: 72, fontSize: "1.4rem" }}>R{event.round_number}</div>}
        <div>
          <div className="page-title" style={{ marginBottom: 2 }}>
            <h2>{event.name}</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--ink-1)", fontSize: "0.9rem" }}>
            {event.track ? `${event.track} · ` : ""}
            {event.date ? new Date(event.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Date TBA"}
            {season ? ` · ${season.name}` : ""}
          </p>
          <p style={{ margin: "6px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
            <Link href="/schedule" style={{ color: "var(--accent-cyan)", fontSize: "0.85rem" }}>← Back to Schedule</Link>
            {isAdmin && (
              <Link
                href={`/races/${event.id}/edit?tab=results${tab && tab !== "__qual" ? `&session=${encodeURIComponent(tab)}` : ""}`}
                className="btn btn-ghost"
                style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
              >
                ✎ Edit Race
              </Link>
            )}
          </p>
        </div>
      </div>

      <div className="tab-row" style={{ marginTop: 20 }}>
        {hasQualifying && (
          <button className={`tab${tab === "__qual" ? " active" : ""}`} onClick={() => setTab("__qual")}>Qualifying</button>
        )}
        {sessions.map(s => (
          <button key={s.name} className={`tab${tab === s.name ? " active" : ""}`} onClick={() => setTab(s.name)}>
            {s.name}
          </button>
        ))}
      </div>

      {tab === "__qual" ? (
        sessions.filter(s => s.qualifying.length).map(s => (
          <div key={s.name}>
            {sessions.filter(x => x.qualifying.length).length > 1 && (
              <div className="section-header"><h3>{s.name} — Qualifying</h3></div>
            )}
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr><th>Pos</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th><th>Time</th><th>Points</th></tr>
                </thead>
                <tbody>
                  {s.qualifying.map(r => (
                    <tr key={r.entry_id}>
                      <td>{r.start_pos}</td>
                      <td className="driver-name-cell" style={{ textAlign: "left" }}><DriverCell r={r} /></td>
                      <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                      <td>{r.qual_time || "—"}</td>
                      <td className="points-cell">{r.qual_points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : activeSession && activeSession.results.length ? (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Pos</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th>
                <th>Start</th><th>Laps</th><th>Led</th><th>Inc</th><th>Status</th><th>Points</th>
              </tr>
            </thead>
            <tbody>
              {activeSession.results.map(r => (
                <tr key={r.entry_id}>
                  <td>
                    <span className={`rank-badge ${r.finish_pos === 1 ? "rank-p1" : r.finish_pos === 2 ? "rank-p2" : r.finish_pos === 3 ? "rank-p3" : "rank-default"}`}>
                      {r.finish_pos}
                    </span>
                  </td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}>
                    <DriverCell r={r} />
                    {r.fastest_lap && <span className="badge" title="Fastest lap" style={{ marginLeft: 6 }}>FL</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                  <td>{r.start_pos ?? "—"}</td>
                  <td>{r.laps ?? "—"}</td>
                  <td>{r.laps_led ?? 0}</td>
                  <td>{r.incidents ?? 0}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td className="points-cell">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon">⏱</span>
          <p>No results recorded for {tab ?? "this event"} yet.</p>
        </div>
      )}
    </section>
  );
}
