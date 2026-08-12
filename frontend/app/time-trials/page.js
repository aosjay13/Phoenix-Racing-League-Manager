"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TimeTrialCreateModal } from "@/components/TimeTrialCreateModal";
import { formatRaceDate } from "@/lib/raceDate";
import { averageLabel } from "@/lib/timeTrials";

// The Time Trials & Placements hub — the control centre for hot-lapping, time
// attack and division placement nights.
//
// These sessions are deliberately NOT races. They live in their own collection,
// score no championship points, and count toward no standard statistic (Wins,
// Top 5s, Average Finish, Championships…). What they do produce is a sorted
// sheet of lap times, which is exactly what two jobs need: sorting a field into
// divisions, and seeding a race's qualifying grid. Both are one button away
// from a completed session.

function StatusBadge({ trial }) {
  const done = trial.status === "completed";
  return (
    <span className={`badge${done ? "" : " page-badge is-muted"}`}
      style={done
        ? { background: "rgba(52, 211, 153, 0.14)", color: "var(--positive, #34d399)" }
        : undefined}>
      {done ? "Completed" : "Open"}
    </span>
  );
}

function TrialRow({ trial, onDelete, isAdmin }) {
  const laps = trial.max_laps ? `${trial.max_laps} lap max` : "Unlimited laps";
  return (
    <div className="list-row linked">
      <Link href={`/time-trials/${trial.id}`} className="list-row-name" style={{ textDecoration: "none" }}>
        <strong>{trial.name}</strong>
        <span>
          {[trial.track, trial.date ? formatRaceDate(trial.date) : null, trial.car]
            .filter(Boolean).join(" · ") || "No venue set"}
        </span>
      </Link>
      <div className="list-row-meta">
        <span>
          <span className="list-row-meta-label">Drivers</span>
          <span className="list-row-meta-value">{trial.driver_count ?? 0}</span>
        </span>
        <span>
          <span className="list-row-meta-label">Laps</span>
          <span className="list-row-meta-value">{trial.lap_count ?? 0}</span>
        </span>
        <span>
          <span className="list-row-meta-label">Format</span>
          <span className="list-row-meta-value" style={{ fontSize: "0.78rem" }}>{laps}</span>
        </span>
        <span>
          <span className="list-row-meta-label">Averages</span>
          <span className="list-row-meta-value" style={{ fontSize: "0.78rem" }}>
            {averageLabel(trial.average_laps)}
          </span>
        </span>
      </div>
      <div className="list-row-actions">
        {trial.is_placement && <span className="badge" title="This session sorts drivers into divisions">🎽 Placement</span>}
        <StatusBadge trial={trial} />
        <Link className="btn btn-ghost" style={{ marginTop: 0 }} href={`/time-trials/${trial.id}`}>Open</Link>
        {isAdmin && (
          <button className="icon-btn icon-btn-danger" type="button" title={`Delete ${trial.name}`}
            onClick={() => onDelete(trial)}>🗑</button>
        )}
      </div>
    </div>
  );
}

export default function TimeTrialsHubPage() {
  const { isAdmin } = useAuth();
  const { gameId, seriesId, seasonId, classes, game, series, season } = useLeague();
  const [trials, setTrials] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [filter, setFilter] = useState("all"); // all | open | completed | placement
  const [scoped, setScoped] = useState(true);  // narrow to the selected game/series/season
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    // Scoped to whatever the top-bar dropdowns are on, so the hub shows this
    // series' sessions rather than every session the league has ever run. The
    // switch below widens it, which is how a session created before its season
    // existed is found again.
    const qs = new URLSearchParams();
    if (scoped) {
      if (gameId) qs.set("game_id", gameId);
      if (seriesId) qs.set("series_id", seriesId);
      if (seasonId) qs.set("season_id", seasonId);
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    api(`/api/time-trials${suffix}`).then(setTrials).catch(() => setTrials([]));
  }, [scoped, gameId, seriesId, seasonId]);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function remove(trial) {
    await api(`/api/time-trials/${trial.id}`, { method: "DELETE" });
    setTrials(prev => (prev || []).filter(t => t.id !== trial.id));
    showToast("success", `“${trial.name}” deleted.`);
  }

  const rows = (trials || []).filter(t =>
    filter === "all" ? true
      : filter === "placement" ? !!t.is_placement
        : (t.status || "open") === filter);

  const scopeLabel = [game?.name, series?.name, season?.name].filter(Boolean).join(" · ");

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>⏱ Time Trials &amp; Placements</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            Hot-lapping, time attack and division placements. These sessions score no championship
            points and count toward no racing statistics — but their laps are eligible for the
            track records, and a completed session can build a season roster or seed a race&rsquo;s
            qualifying grid.
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" type="button" style={{ marginTop: 0 }} onClick={() => setCreating(true)}>
            ＋ New Time Trial
          </button>
        )}
      </div>

      <div className="tab-row" style={{ flexWrap: "wrap", alignItems: "center" }}>
        {[["all", "All"], ["open", "Open"], ["completed", "Completed"], ["placement", "Placement"]].map(([key, label]) => (
          <button key={key} className={`tab${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>{label}</button>
        ))}
        <label className="check-row" style={{ marginLeft: "auto", marginTop: 0 }}>
          <input type="checkbox" checked={scoped} onChange={e => setScoped(e.target.checked)} />
          <span style={{ fontSize: "0.82rem", color: "var(--ink-1)" }}>
            Only {scopeLabel || "the selected scope"}
          </span>
        </label>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {trials === null ? (
        <div className="skeleton" style={{ height: 220, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">⏱</span>
          <p>
            {trials.length
              ? "No sessions match that filter."
              : isAdmin
                ? "No time trials yet. Create one to start collecting lap times — you can sort the field into divisions and build a roster from it when you're done."
                : "No time trials have been run yet."}
          </p>
        </div>
      ) : (
        <div className="list-rows list-row-wrap wide" style={{ marginTop: 18 }}>
          {rows.map(t => <TrialRow key={t.id} trial={t} isAdmin={isAdmin} onDelete={setDeleting} />)}
        </div>
      )}

      {creating && (
        <TimeTrialCreateModal
          gameId={gameId} seriesId={seriesId} seasonId={seasonId} classes={classes}
          onClose={() => setCreating(false)}
          onCreated={trial => { setCreating(false); setTrials(prev => [trial, ...(prev || [])]); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this time trial?"
          message={`“${deleting.name}” and every lap submitted in it will be removed. Results already exported to a race's qualifying are untouched. This cannot be undone.`}
          confirmLabel="Delete Session"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </section>
  );
}
