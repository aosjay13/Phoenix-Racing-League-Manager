"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";

function DriverCell({ r }) {
  // On a game-specific event, prefer the driver's mapped alias (their on-track
  // name for this game) as the primary label, keeping the profile name as a
  // muted subtitle. Falls back to the profile name when no alias is mapped.
  const alias = r.game_alias && r.game_alias !== r.driver_name ? r.game_alias : null;
  const primary = alias || r.driver_name;
  return (
    <>
      {(r.driver_id || r.user_id)
        ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{primary}</Link>
        : primary}
      {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
      {alias && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.driver_name}</span>}
    </>
  );
}

function statusLabel(s) {
  return s === "finished" ? "Running" : (s || "").toUpperCase();
}

// Coloured +/- SR change a driver earned in this race.
function SrDelta({ delta }) {
  if (delta == null) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  if (delta === 0) return <span style={{ color: "var(--ink-2)" }}>±0</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "var(--positive, #34d399)" : "var(--negative, #f87171)", fontWeight: 600 }}>
      {up ? "+" : ""}{delta}
    </span>
  );
}

// Maps a session name (the currently viewed tab) back to the edit screen's
// top-level tab key, which for heat-format events is one of
// heats/consolation/feature rather than a single "results" tab.
function editTabFor(event, sessionTab) {
  if (sessionTab === "__qual") return "qualifying";
  if (!event.heat_format) return "results";
  if ((event.heats || []).includes(sessionTab)) return "heats";
  if ((event.consolations || []).includes(sessionTab)) return "consolation";
  return "feature";
}

export default function EventResultsPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null); // "qual" or session name
  const [confirmKind, setConfirmKind] = useState(null); // "event" | "session" | null

  const load = () =>
    api(`/api/events/${id}`)
      .then(d => {
        setData(d);
        const withResults = d.races.find(s => s.results.length);
        setTab(prev => prev ?? (withResults ? withResults.name : (d.qualifying.length ? "__qual" : d.races[0]?.name ?? null)));
      })
      .catch(err => setError(err.message));
  useEffect(() => { load(); }, [id]);

  // Delete the whole event (race doc + every session's results); stats/points
  // recompute from results on read, so they scrub automatically.
  async function deleteEvent() {
    await api(`/api/races/${id}`, { method: "DELETE" });
    router.push("/schedule");
  }

  // Clear only the currently-viewed session's results, leaving the rest of the
  // event intact. Qualifying is isolated by type; every race-like session
  // matches by name (session_type defaults to "race" server-side).
  async function deleteSession() {
    const qs = new URLSearchParams({ race_id: id });
    if (tab === "__qual") { qs.set("session", "Qualifying"); qs.set("session_type", "qualifying"); }
    else { qs.set("session", tab); }
    await api(`/api/results?${qs.toString()}`, { method: "DELETE" });
    await load();
  }

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { event, season, races, qualifying } = data;
  const hasQualifying = qualifying.length > 0;
  const activeRace = races.find(s => s.name === tab);
  const activeResults = activeRace?.results ?? [];
  // Provisional entries (points only, didn't race) are listed separately so
  // they never read as back-of-field finishers.
  const finishers = activeResults.filter(r => !r.provisional);
  const provisionals = activeResults.filter(r => r.provisional);
  // The SR column/banner only appear for the session that actually exchanged
  // Skill Rating (the main race / Feature) — detected by results carrying an
  // sr_delta. Strength of Field is recorded on the event.
  const showSr = finishers.some(r => r.sr_delta != null);
  const sof = event.strength_of_field;

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
              <>
                <Link
                  href={`/races/${event.id}/edit?tab=${editTabFor(event, tab)}${tab && tab !== "__qual" ? `&session=${encodeURIComponent(tab)}` : ""}`}
                  className="btn btn-ghost"
                  style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                >
                  ✎ Edit Race
                </Link>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                  onClick={() => setConfirmKind("event")}
                >
                  🗑 Delete Event
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="tab-row" style={{ marginTop: 20 }}>
        {hasQualifying && (
          <button className={`tab${tab === "__qual" ? " active" : ""}`} onClick={() => setTab("__qual")}>Qualifying</button>
        )}
        {races.map(s => (
          <button key={s.name} className={`tab${tab === s.name ? " active" : ""}`} onClick={() => setTab(s.name)}>
            {s.name}
          </button>
        ))}
        {isAdmin && tab && (tab === "__qual" ? hasQualifying : activeResults.length > 0) && (
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            title={`Delete the ${tab === "__qual" ? "Qualifying" : tab} results`}
            style={{ marginLeft: "auto" }}
            onClick={() => setConfirmKind("session")}
          >
            🗑 Delete {tab === "__qual" ? "Qualifying" : tab} results
          </button>
        )}
      </div>

      {isAdmin && confirmKind === "event" && (
        <ConfirmDialog
          title="Delete this event?"
          message={`Are you sure you want to delete "${event.name}"? This removes the event and all associated qualifying, heat, main, and race results — and the points and stats those results gave every driver. This cannot be undone.`}
          confirmLabel="Delete event"
          onConfirm={deleteEvent}
          onClose={() => setConfirmKind(null)}
        />
      )}
      {isAdmin && confirmKind === "session" && (
        <ConfirmDialog
          title={`Delete ${tab === "__qual" ? "Qualifying" : tab} results?`}
          message={`Are you sure you want to delete the ${tab === "__qual" ? "Qualifying" : tab} results for this event? This removes all associated points and stats for these drivers, and cannot be undone. The rest of the event is left untouched.`}
          confirmLabel="Delete results"
          onConfirm={deleteSession}
          onClose={() => setConfirmKind(null)}
        />
      )}

      {tab === "__qual" ? (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr><th>Pos</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th><th>Qual Time</th><th>Points</th></tr>
            </thead>
            <tbody>
              {qualifying.map(r => (
                <tr key={r.entry_id}>
                  <td>
                    <span className={`rank-badge ${r.position === 1 ? "rank-p1" : "rank-default"}`}>{r.position}</span>
                    {r.position === 1 && <span className="badge" title="Pole position" style={{ marginLeft: 6 }}>POLE</span>}
                  </td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}><DriverCell r={r} /></td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                  <td>{r.qual_time || "—"}</td>
                  <td className="points-cell">{r.qual_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeRace && activeResults.length ? (
        <>
        {showSr && sof != null && (
          <div className="hero" style={{ marginTop: 16, marginBottom: 4, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-2)" }}>
              Strength of Field
            </span>
            <span style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-gold)" }}>{sof}</span>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>
              average Skill Rating of the {finishers.length} starter{finishers.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {finishers.length > 0 && (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Pos</th><th title="Starting position">Start</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th>
                <th>Race Time</th><th>Int</th><th>Best Lap</th><th>Laps</th><th>Led</th><th>Inc</th><th>Status</th><th>Points</th>
                {showSr && <th title="Skill Rating change from this race">SR ±</th>}
              </tr>
            </thead>
            <tbody>
              {finishers.map(r => (
                <tr key={r.entry_id}>
                  <td>
                    <span className={`rank-badge ${r.finish_pos === 1 ? "rank-p1" : r.finish_pos === 2 ? "rank-p2" : r.finish_pos === 3 ? "rank-p3" : "rank-default"}`}>
                      {r.finish_pos}
                    </span>
                  </td>
                  <td style={{ color: "var(--ink-1)" }}>{r.start_pos ?? "—"}</td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}>
                    <DriverCell r={r} />
                    {r.fastest_lap && <span className="badge" title="Fastest lap" style={{ marginLeft: 6 }}>FL</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                  <td>{r.finish_pos === 1 ? (r.race_time || "—") : "—"}</td>
                  <td>{r.finish_pos === 1 ? "—" : (r.interval || r.race_time || "—")}</td>
                  <td>{r.fastest_lap_time || "—"}</td>
                  <td>{r.laps ?? "—"}</td>
                  <td>{r.laps_led ?? 0}</td>
                  <td>{r.incidents ?? 0}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td className="points-cell">{r.points}</td>
                  {showSr && <td><SrDelta delta={r.sr_delta} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {provisionals.length > 0 && (
          <div className="table-wrap" style={{ marginTop: finishers.length ? 16 : 0 }}>
            <table className="stats-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }} colSpan={2}>Provisional Entries · points only, not counted in stats</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {provisionals.map(r => (
                  <tr key={r.entry_id}>
                    <td style={{ width: 40 }}><span className="badge" title="Provisional">P</span></td>
                    <td className="driver-name-cell" style={{ textAlign: "left" }}><DriverCell r={r} /></td>
                    <td className="points-cell">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon">⏱</span>
          <p>No results recorded for {tab ?? "this event"} yet.</p>
        </div>
      )}
    </section>
  );
}
