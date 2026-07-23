"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { RaceCreateModal } from "@/components/RaceCreateModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  const { seasonId } = useLeague();
  // A concrete season shows that season's full event table (with admin tools);
  // "All Games" / "All Series" show a master feed of recent + upcoming racing.
  return seasonId ? <SeasonSchedule /> : <GlobalSchedule />;
}

// ── Master feed across seasons (no single season selected) ─────────────────

function GlobalSchedule() {
  const { gameId, seriesId, game, series } = useLeague();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const qs = seriesId ? `series_id=${seriesId}` : gameId ? `game_id=${gameId}` : "";
    setRows(null);
    api(`/api/schedule${qs ? `?${qs}` : ""}`).then(setRows).catch(() => setRows([]));
  }, [gameId, seriesId]);

  const { upcoming, archive } = useMemo(() => {
    const all = rows || [];
    const dateVal = r => (r.date ? new Date(r.date).getTime() : null);
    // Upcoming: events without saved results yet, soonest first (undated last).
    const upcoming = all
      .filter(r => !r.summary?.has_results)
      .sort((a, b) => {
        const av = dateVal(a), bv = dateVal(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      })
      .slice(0, 40);
    // Archive: events with results, most recently run first.
    const archive = all
      .filter(r => r.summary?.has_results)
      .sort((a, b) => (dateVal(b) ?? 0) - (dateVal(a) ?? 0))
      .slice(0, 40);
    return { upcoming, archive };
  }, [rows]);

  const scopeLabel = series?.name || game?.name || "All Games";

  return (
    <section>
      <div className="page-title">
        <h2>Schedule</h2>
        <span className="page-badge">{scopeLabel}</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 720 }}>
        Racing across every series and season. Pick a specific Season above to manage its events; otherwise
        here&apos;s what&apos;s coming up and what recently ran. Narrow with the Game / Series menus.
      </p>

      {rows == null ? (
        <div className="skeleton" style={{ height: 240, marginTop: 16 }} />
      ) : upcoming.length === 0 && archive.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🗓</span><p>No races scheduled yet in this scope.</p></div>
      ) : (
        <>
          <FeedSection title="Upcoming" icon="🟢" rows={upcoming} kind="upcoming" />
          <FeedSection title="Archive · Recent Results" icon="🏁" rows={archive} kind="archive" />
        </>
      )}
    </section>
  );
}

function FeedSection({ title, icon, rows, kind }) {
  if (!rows.length) return null;
  const archive = kind === "archive";
  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{icon}</span>{title}
        <span className="page-badge" style={{ marginLeft: 4 }}>{rows.length}</span>
      </h3>
      <div className="table-wrap">
        <table className="stats-table" style={{ width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>Date</th>
              <th style={{ textAlign: "left" }}>Event / Track</th>
              <th style={{ textAlign: "left" }}>Series · Season</th>
              <th style={{ textAlign: "left" }}>{archive ? "Winner" : "Car"}</th>
              <th>{archive ? "Results" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = r.summary || {};
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  <td style={{ textAlign: "left" }}>
                    <Link href={`/races/${r.id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{r.name}</Link>
                    {r.track && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.track}</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)", fontSize: "0.82rem" }}>
                    {[r.series_name, r.season_name].filter(Boolean).join(" · ") || "—"}
                    {r.game_name && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.game_name}</span>}
                  </td>
                  <td style={{ textAlign: "left", fontWeight: archive && s.winner ? 600 : undefined }}>
                    {archive ? <Person p={s.winner} /> : (s.car || <span style={{ color: "var(--ink-2)" }}>—</span>)}
                  </td>
                  <td>
                    {archive
                      ? <Link href={`/races/${r.id}`} title="View race results" style={{ fontSize: "1.1rem" }}>🏁</Link>
                      : <span className="race-status status-upcoming" style={{ fontSize: "0.7rem" }}>UPCOMING</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── One season's full event table (a concrete season is selected) ──────────

function SeasonSchedule() {
  const { seasonId, season, refresh } = useLeague();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [races, setRaces] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toDelete, setToDelete] = useState(null); // race pending delete confirmation
  const [toggleComplete, setToggleComplete] = useState(false); // season completion pending confirmation

  const completed = season?.status === "completed";

  async function confirmToggleComplete() {
    // Mirrors the "Mark Completed" control on League Setup: a completed season
    // credits its champion(s) with a Title in career/team stats. refresh() pulls
    // the updated season back into the league selector so the button re-labels.
    await api(`/api/seasons/${seasonId}`, { method: "PATCH", body: { status: completed ? "active" : "completed" } });
    refresh();
  }

  const loadRaces = () => {
    if (!seasonId) { setRaces(null); return; }
    api(`/api/schedule?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  };
  useEffect(loadRaces, [seasonId]);

  async function confirmDelete() {
    // Deleting the event removes its race doc and cascades to every saved
    // result (qualifying + all race/heat/consolation/feature sessions) in the
    // DELETE route; stats/standings recompute from results on read, so they
    // scrub automatically once the results are gone.
    await api(`/api/races/${toDelete.id}`, { method: "DELETE" });
    loadRaces();
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
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 0 }}
              title={completed
                ? "This season is complete and its champion holds a Title. Click to reopen it."
                : "Mark this season complete — its champion earns a Title in career stats."}
              onClick={() => setToggleComplete(true)}>
              {completed ? "✓ Season Complete" : "Mark Season Complete"}
            </button>
            <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setShowCreate(true)}>
              + New Race
            </button>
          </div>
        )}
      </div>

      {isAdmin && toggleComplete && (
        <ConfirmDialog
          title={completed ? "Reopen this season?" : "Mark season complete?"}
          message={completed
            ? `Reopen "${season?.name}"? It will no longer count as a finished season, and its champion's Title will be removed until you mark it complete again.`
            : `Mark "${season?.name}" complete? This closes out the season and credits its champion — the points leader — with a Title in their career and team stats.`}
          confirmLabel={completed ? "Reopen season" : "Mark complete"}
          onConfirm={confirmToggleComplete}
          onClose={() => setToggleComplete(false)}
        />
      )}

      {showCreate && (
        <RaceCreateModal
          seasonId={seasonId}
          defaultRound={nextRound}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadRaces(); }}
        />
      )}

      {isAdmin && toDelete && (
        <ConfirmDialog
          title="Delete this event?"
          message={`Are you sure you want to delete "${toDelete.name}"? This removes the event and all associated qualifying, heat, main, and race results — and the points and stats those results gave every driver. This cannot be undone.`}
          confirmLabel="Delete event"
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
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
                        <button className="icon-btn icon-btn-danger" title="Delete race" onClick={() => setToDelete(r)}>🗑</button>
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
