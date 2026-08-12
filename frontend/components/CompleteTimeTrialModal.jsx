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
// It always shows the plan BEFORE writing: how many drivers would be created,
// how many already on the roster would simply be moved into the division the
// trial placed them in, and who would be left alone (and why). Re-running is
// safe — a driver already on the roster is updated, never duplicated — so an
// admin can re-sort the field and press it again.
export function CompleteTimeTrialModal({ trial, seasons = [], onClose, onCompleted }) {
  const [seasonId, setSeasonId] = useState(trial.season_id || "");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Preview whenever the target season changes — the plan is entirely a
  // function of which roster it is compared against.
  useEffect(() => {
    if (!seasonId) { setPlan(null); return; }
    let live = true;
    setPlan(null);
    setError(null);
    api(`/api/time-trials/${trial.id}/roster`, { method: "POST", body: { season_id: seasonId, dry_run: true } })
      .then(p => { if (live) setPlan(p); })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [seasonId, trial.id]);

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
      <Modal title="Roster built" onClose={onClose}>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
          <strong>{done.created}</strong> driver{done.created === 1 ? "" : "s"} added to the roster and{" "}
          <strong>{done.updated}</strong> moved into the division this session placed them in.
          {done.skipped?.length > 0 && <> {done.skipped.length} left unchanged.</>}
        </p>
        {done.skipped?.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ink-2)" }}>
            {done.skipped.slice(0, 12).map((s, i) => <li key={i}>{s.name || "Unnamed"} — {s.reason}</li>)}
            {done.skipped.length > 12 && <li>…and {done.skipped.length - 12} more</li>}
          </ul>
        )}
        <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  const nothingToDo = plan && !plan.create.length && !plan.update.length;

  return (
    <Modal title="Complete this session" onClose={busy ? () => {} : onClose}>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55, marginTop: 6 }}>
        Completing closes the sheet for entry and makes this session available to the{" "}
        <strong>Import from Time Trial</strong> button on a race&rsquo;s Qualifying tab.
        {trial.is_placement && <> It can also build the official roster from the divisions you assigned.</>}
      </p>

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="tt_roster_season">Create / update the roster for</label>
        <select id="tt_roster_season" value={seasonId} onChange={e => setSeasonId(e.target.value)} disabled={busy}>
          <option value="">Don&rsquo;t touch any roster</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Every driver on the sheet joins this season&rsquo;s roster in the division they were placed
          in. Drivers already on it are moved into their new division rather than duplicated, so this
          is safe to run again after a re-sort.
        </span>
      </div>

      {seasonId && !plan && !error && <div className="skeleton" style={{ height: 70 }} />}

      {plan && (
        <div className="bonus-panel" style={{ marginTop: 4 }}>
          <div className="bonus-panel-title">What this will do</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{plan.create.length} added</span>
            <span className="bonus-chip">{plan.update.length} re-classed</span>
            <span className="bonus-chip">{plan.skipped.length} untouched</span>
          </div>
          {plan.create.length > 0 && (
            <p className="bonus-panel-note">
              New: {plan.create.slice(0, 8).map(c => c.name).join(", ")}
              {plan.create.length > 8 ? `, and ${plan.create.length - 8} more` : ""}
            </p>
          )}
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
          disabled={busy || !seasonId || nothingToDo}
          onClick={() => run(true)}>
          {busy ? "Working…" : "Complete & Build Roster"}
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
