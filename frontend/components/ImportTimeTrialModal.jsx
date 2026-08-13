"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { formatRaceDate } from "@/lib/raceDate";
import { averageLabel, entryIndex, matchEntry, planQualifyingExport } from "@/lib/timeTrials";

// "Import from Time Trial" — the same bridge as Export to Qualifying, walked
// from the other end. An admin sitting on a race's Qualifying tab pulls a
// completed hot-lap session in rather than going to find the session and
// pushing it here.
//
// It behaves like the CSV import beside it: the grid is filled in the browser
// and nothing is written until the admin reviews it and hits Save. That is the
// difference from the export button on the trial screen, which writes the
// session outright — here the admin is already looking at the sheet the rows
// are landing on.
export function ImportTimeTrialModal({ entries = [], gameId = "", onApply, onClose }) {
  const [trials, setTrials] = useState(null);
  const [trialId, setTrialId] = useState("");
  const [detail, setDetail] = useState(null);
  const [sortKey, setSortKey] = useState("best");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    // Every session in the league, most recent first. Completed ones lead —
    // they're what this is for — but an open session is still importable, since
    // a league that runs qualifying as a hot-lap window enters it live.
    const qs = gameId ? `?game_id=${gameId}` : "";
    api(`/api/time-trials${qs}`)
      .then(list => {
        if (!live) return;
        const ordered = [...list].sort((a, b) =>
          Number(b.status === "completed") - Number(a.status === "completed") ||
          String(b.date || "").localeCompare(String(a.date || "")));
        setTrials(ordered);
        setTrialId(ordered[0]?.id || "");
      })
      .catch(err => { if (live) { setTrials([]); setError(err.message); } });
    return () => { live = false; };
  }, [gameId]);

  useEffect(() => {
    if (!trialId) { setDetail(null); return; }
    let live = true;
    setLoading(true);
    setDetail(null);
    setError(null);
    api(`/api/time-trials/${trialId}`)
      .then(d => {
        if (!live) return;
        setDetail(d);
        setSortKey(d.trial?.sort_key === "average" ? "average" : "best");
      })
      .catch(err => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [trialId]);

  // Which of the session's drivers are on THIS event's roster. A result can
  // only be filed against a roster entry, so anyone missing is named rather
  // than quietly dropped — the fix is to add them to the roster, which the
  // grid's own "Add a driver" bar does.
  const plan = useMemo(() => {
    if (!detail) return null;
    const index = entryIndex(entries.map(e => ({ ...e, id: e.id ?? e.entry_id })));
    return planQualifyingExport(detail.entries || [], row => matchEntry(row, index)?.id || "", { key: sortKey });
  }, [detail, entries, sortKey]);

  function apply() {
    if (!plan?.grid.length) return;
    // The shape the results grid's own importer takes, so a time trial arrives
    // through exactly the same path a CSV does.
    onApply(plan.grid.map(row => ({
      entry_id: row.entry_id,
      finish_pos: row.finish_pos,
      qual_time: row.qual_time,
      fastest_lap_time: row.fastest_lap_time,
    })));
  }

  const trial = detail?.trial ?? null;

  return (
    <Modal title="Import from Time Trial" onClose={onClose}>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55, marginTop: 6 }}>
        Pulls a hot-lap session&rsquo;s best laps into this qualifying grid — fastest lap on pole.
        Nothing is saved until you review the grid and hit <strong>Save</strong>.
      </p>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="tt_import_session">Time trial session</label>
        <select id="tt_import_session" value={trialId} onChange={e => setTrialId(e.target.value)}>
          {trials === null && <option value="">Loading…</option>}
          {trials?.length === 0 && <option value="">No time trials yet</option>}
          {(trials || []).map(t => (
            <option key={t.id} value={t.id}>
              {t.name}{t.track ? ` · ${t.track}` : ""}{t.date ? ` · ${formatRaceDate(t.date)}` : ""}
              {t.status === "completed" ? "" : " (open)"}
            </option>
          ))}
        </select>
      </div>

      {trial && (
        <div className="field">
          <label htmlFor="tt_import_key">Grid order</label>
          <select id="tt_import_key" value={sortKey} onChange={e => setSortKey(e.target.value)}>
            <option value="best">Best Time — single fastest lap</option>
            <option value="average">{averageLabel(trial.average_laps)}</option>
          </select>
        </div>
      )}

      {loading && <div className="skeleton" style={{ height: 70 }} />}

      {plan && (
        <div className="bonus-panel" style={{ marginTop: 4 }}>
          <div className="bonus-panel-title">What this will fill in</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{plan.grid.length} drivers</span>
            {plan.unmatched.length > 0 && <span className="bonus-chip">{plan.unmatched.length} not on this roster</span>}
          </div>
          {plan.grid.length > 0 && (
            <p className="bonus-panel-note">
              Pole: <strong>{plan.grid[0].name}</strong> ({plan.grid[0].qual_time})
              {plan.grid[1] && <> · P2 {plan.grid[1].name} ({plan.grid[1].qual_time})</>}
            </p>
          )}
          {plan.unmatched.length > 0 && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              Left out — not on this season&rsquo;s roster: {plan.unmatched.slice(0, 8).join(", ")}
              {plan.unmatched.length > 8 ? `, and ${plan.unmatched.length - 8} more` : ""}.
            </p>
          )}
          {plan.grid.length === 0 && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              Nobody from that session is on this event&rsquo;s roster with a lap time, so there is
              nothing to import.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
          disabled={!plan?.grid.length} onClick={apply}>
          Fill the grid
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
