"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { RaceCreateModal } from "@/components/RaceCreateModal";
import { api } from "@/lib/api";

// A driver cell that links to the profile when we can resolve one, else plain
// text. Falls back to an em-dash for events with no recorded pole/winner yet.
function Person({ p }) {
  if (!p || !p.name) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  const id = p.driver_id || p.user_id;
  return id
    ? <Link href={`/drivers/${id}`} style={{ color: "var(--accent-cyan)" }}>{p.name}</Link>
    : <span>{p.name}</span>;
}

function fmtDate(d) {
  if (!d) return "TBA";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SchedulePage() {
  const { seasonId, season } = useLeague();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [races, setRaces] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadRaces = () => {
    if (!seasonId) { setRaces(null); return; }
    api(`/api/schedule?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  };
  useEffect(loadRaces, [seasonId]);

  async function remove(r) {
    if (!confirm(`Delete "${r.name}" and all its results? This cannot be undone.`)) return;
    try {
      await api(`/api/races/${r.id}`, { method: "DELETE" });
      loadRaces();
    } catch (err) { alert(err.message); }
  }

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">🗓</span><p>Select a game, series and season above.</p></div>;
  }
  if (!races) return <div className="skeleton" style={{ height: 240 }} />;

  const now = new Date();
  const ordered = [...races].sort((a, b) => (Number(a.round_number) || 0) - (Number(b.round_number) || 0));
  const nextRound = races.reduce((m, r) => Math.max(m, Number(r.round_number) || 0), 0) + 1;

  return (
    <section>
      <div className="page-title">
        <h2>Schedule · {season?.name ?? ""}</h2>
        <span className="page-badge">{races.length} Event{races.length === 1 ? "" : "s"}</span>
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginLeft: "auto", marginTop: 0 }} onClick={() => setShowCreate(true)}>
            + New Race
          </button>
        )}
      </div>

      {showCreate && (
        <RaceCreateModal
          seasonId={seasonId}
          defaultRound={nextRound}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadRaces(); }}
        />
      )}

      {races.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🗓</span><p>No races scheduled yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table schedule-table">
            <thead>
              <tr>
                <th>Race</th>
                <th>Race Date</th>
                <th className="sticky-col" style={{ textAlign: "left" }}>Event / Track</th>
                <th>Race Length</th>
                <th style={{ textAlign: "left" }}>Car</th>
                <th style={{ textAlign: "left" }}>Pole</th>
                <th style={{ textAlign: "left" }}>Winner</th>
                <th>Num Drivers</th>
                <th>Results</th>
                {isAdmin && <th>Admin</th>}
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => {
                const s = r.summary || {};
                const done = r.date && new Date(r.date) < now;
                return (
                  <tr key={r.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.round_number ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td className="sticky-col" style={{ textAlign: "left" }}>
                      <Link href={`/races/${r.id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{r.name}</Link>
                      {r.track && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.track}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {s.laps ? `${s.laps} Laps` : "—"}
                      {s.laps_extended && (
                        <span title={`Scheduled ${s.scheduled_laps} laps — extended by a green-white-checkered / overtime finish`}
                          style={{ marginLeft: 5, fontSize: "0.7rem", color: "var(--accent-cyan)", fontWeight: 700 }}>GWC</span>
                      )}
                    </td>
                    <td style={{ textAlign: "left" }}>{s.car || <span style={{ color: "var(--ink-2)" }}>—</span>}</td>
                    <td style={{ textAlign: "left" }}><Person p={s.pole} /></td>
                    <td style={{ textAlign: "left", fontWeight: s.winner ? 600 : undefined }}><Person p={s.winner} /></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.num_drivers || "—"}</td>
                    <td>
                      {s.has_results
                        ? <Link href={`/races/${r.id}`} title="View race results" style={{ fontSize: "1.1rem" }}>🏁</Link>
                        : <span className={`race-status ${done ? "status-completed" : "status-upcoming"}`} style={{ fontSize: "0.7rem" }}>{done ? "TBD" : "UPCOMING"}</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="icon-btn" title="Edit race" onClick={() => router.push(`/races/${r.id}/edit`)}>✎</button>
                        <button className="icon-btn icon-btn-danger" title="Delete race" onClick={() => remove(r)}>🗑</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
