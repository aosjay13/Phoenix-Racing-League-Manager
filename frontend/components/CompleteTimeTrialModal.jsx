"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// "Complete Session" → the roster workflow.
//
// A placement night has already answered the roster's question — who is racing,
// and in which division — so this offers to write that answer straight onto the
// official Season / Class roster instead of an admin retyping forty drivers.
//
// A division is not always a class. When the night sorts drivers into separate
// SERIES, each series builds the roster of the season behind it, so one run can
// write several rosters at once — and the plan below is shown per season, since
// "12 added" means nothing without saying to which roster.
//
// It always shows the plan BEFORE writing. Re-running is safe — a driver already
// on a roster is updated, never duplicated — so an admin can re-sort the field
// and press it again.
export function CompleteTimeTrialModal({ trial, seasons = [], placementSeries = [], onClose, onCompleted }) {
  const [seasonId, setSeasonId] = useState(trial.season_id || "");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Series placement carries its own destinations, so the run has something to
  // do even when the trial itself is attached to no season.
  const seriesTargets = placementSeries.filter(s => s.season_id);
  const canRun = !!seasonId || seriesTargets.length > 0;

  // Preview whenever the target season changes — the plan is entirely a
  // function of the rosters it is compared against.
  useEffect(() => {
    if (!canRun) { setPlan(null); return; }
    let live = true;
    setPlan(null);
    setError(null);
    api(`/api/time-trials/${trial.id}/roster`, { method: "POST", body: { season_id: seasonId, dry_run: true } })
      .then(p => { if (live) setPlan(p); })
      .catch(err => { if (live) { setPlan(null); setError(err.message); } });
    return () => { live = false; };
  }, [seasonId, canRun, trial.id]);

  async function run(buildRoster) {
    setBusy(true);
    setError(null);
    try {
      if (buildRoster) {
        const res = await api(`/api/time-trials/${trial.id}/roster`, {
          method: "POST", body: { season_id: seasonId, complete: true },
        });
        setDone(res);
        onCompleted(res.trial, res);
      } else {
        // Close the session without touching any roster — an ordinary time
        // attack night that simply finished.
        const updated = await api(`/api/time-trials/${trial.id}`, { method: "PATCH", body: { status: "completed" } });
        onCompleted(updated, null);
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Rosters built" onClose={onClose}>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
          <strong>{done.created}</strong> driver{done.created === 1 ? "" : "s"} added and{" "}
          <strong>{done.updated}</strong> moved into the division this session placed them in
          {done.seasons?.length > 1 ? `, across ${done.seasons.length} rosters.` : "."}
          {done.skipped?.length > 0 && <> {done.skipped.length} left unchanged.</>}
        </p>
        {done.seasons?.length > 1 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {done.seasons.map(s => (
              <li key={s.season_id}>
                <strong>{s.season_name || "Season"}</strong> — {s.created} added, {s.updated} re-classed
              </li>
            ))}
          </ul>
        )}
        {done.skipped?.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ink-2)" }}>
            {done.skipped.slice(0, 12).map((s, i) => <li key={i}>{s.name || "Unnamed"} — {s.reason}</li>)}
            {done.skipped.length > 12 && <li>…and {done.skipped.length - 12} more</li>}
          </ul>
        )}
        {/* The other half of the run, on a screen the admin isn't looking at:
            these drivers were in the Placements Roster waiting on a session, and
            this is the session. Said out loud so the list emptying is a reported
            outcome rather than something noticed later. */}
        {done.placements_cleared > 0 && (
          <p style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--ink-1)" }}>
            <strong>{done.placements_cleared}</strong>{" "}
            {done.placements_cleared === 1 ? "driver has" : "drivers have"} left the{" "}
            <strong>Placement Roster</strong> — they&rsquo;re on a roster now, and each has been told
            on their Dashboard.
          </p>
        )}
        <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  const nothingToDo = plan && !plan.created && !plan.updated;

  return (
    <Modal title="Complete this session" onClose={busy ? () => {} : onClose}>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55, marginTop: 6 }}>
        Completing closes the sheet for entry and makes this session available to the{" "}
        <strong>Import from Time Trial</strong> button on a race&rsquo;s Qualifying tab.
        {trial.is_placement && <> It can also build the official roster from the divisions you assigned.</>}
      </p>

      {seriesTargets.length > 0 && (
        <div className="bonus-panel" style={{ marginTop: 12 }}>
          <div className="bonus-panel-title">Series placements go to their own rosters</div>
          <div className="bonus-panel-row">
            {seriesTargets.map(s => (
              <span key={s.series_id} className="bonus-chip">{s.series_name} → {s.season_name}</span>
            ))}
          </div>
          {placementSeries.some(s => !s.season_id) && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              {placementSeries.filter(s => !s.season_id).map(s => s.series_name).join(", ")} name no season
              yet, so anyone placed there can&rsquo;t be added to a roster. Pick one in Settings first.
            </p>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="tt_roster_season">
          {seriesTargets.length > 0 ? "Everyone not placed into a series goes to" : "Create / update the roster for"}
        </label>
        <select id="tt_roster_season" value={seasonId} onChange={e => setSeasonId(e.target.value)} disabled={busy}>
          <option value="">{seriesTargets.length > 0 ? "Leave them off any roster" : "Don't touch any roster"}</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Every driver on the sheet joins a roster in the division they were placed in. Drivers
          already on one are moved into their new division rather than duplicated, so this is safe to
          run again after a re-sort.
        </span>
      </div>

      {canRun && !plan && !error && <div className="skeleton" style={{ height: 70 }} />}

      {plan && (
        <div className="bonus-panel" style={{ marginTop: 4 }}>
          <div className="bonus-panel-title">What this will do</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{plan.created} added</span>
            <span className="bonus-chip">{plan.updated} re-classed</span>
            <span className="bonus-chip">{plan.skipped.length} untouched</span>
          </div>
          {plan.seasons?.map(season => (
            <p className="bonus-panel-note" key={season.season_id}>
              <strong>{season.season_name || "Season"}</strong> — {season.create.length} added
              {season.create.length > 0 && <>
                {" "}({season.create.slice(0, 6).map(c => c.name).join(", ")}
                {season.create.length > 6 ? `, +${season.create.length - 6}` : ""})
              </>}
              , {season.update.length} re-classed
            </p>
          ))}
          {plan.skipped.length > 0 && (
            <p className="bonus-panel-note">
              Untouched: {plan.skipped.slice(0, 6).map(s => `${s.name || "Unnamed"} (${s.reason})`).join(", ")}
              {plan.skipped.length > 6 ? `, and ${plan.skipped.length - 6} more` : ""}
            </p>
          )}
          {nothingToDo && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              Nothing to write — assign divisions on the sheet first, then come back.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
          disabled={busy || !canRun || !plan || nothingToDo}
          onClick={() => run(true)}>
          {busy ? "Working…" : `Complete & Build Roster${plan?.seasons?.length > 1 ? "s" : ""}`}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} disabled={busy}
          onClick={() => run(false)}>
          Complete Only
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
