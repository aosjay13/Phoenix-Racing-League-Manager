"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { api } from "@/lib/api";

function blankRows(entries) {
  return entries.map((e, i) => ({
    entry_id: e.id,
    driver_name: e.name,
    driver_number: e.number,
    finish_pos: String(i + 1),
    laps_led: "0",
    incidents: "0",
    status: "finished",
  }));
}

function RaceEntryInner() {
  const { seasonId, season } = useLeague();
  const [races, setRaces] = useState([]);
  const [entries, setEntries] = useState([]);
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!seasonId) return;
    const [r, e] = await Promise.all([
      api(`/api/races?season_id=${seasonId}`),
      api(`/api/entries?season_id=${seasonId}`),
    ]);
    setRaces(r);
    setEntries(e);
    setRows(blankRows(e));
    setRaceId("");
  }, [seasonId]);

  useEffect(() => { load().catch(() => showToast("error", "Could not load season data.")); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  // Pre-fill with any existing results so admins can edit past races.
  async function selectRace(id) {
    setRaceId(id);
    if (!id) return;
    try {
      const existing = await api(`/api/results?race_id=${id}`);
      if (existing.length) {
        const byEntry = Object.fromEntries(existing.map(r => [r.entry_id, r]));
        setRows(blankRows(entries).map(row => {
          const prev = byEntry[row.entry_id];
          return prev ? {
            ...row,
            finish_pos: String(prev.finish_pos),
            laps_led: String(prev.laps_led ?? 0),
            incidents: String(prev.incidents ?? 0),
            status: prev.status || "finished",
          } : row;
        }));
        showToast("success", "Loaded existing results — saving will overwrite them.");
      } else {
        setRows(blankRows(entries));
      }
    } catch {}
  }

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    const filled = rows.filter(r => r.finish_pos !== "");
    if (!raceId) return showToast("error", "Pick a race first.");
    if (!filled.length) return showToast("error", "Enter at least one finishing position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same finishing position.");
    }
    setBusy(true);
    try {
      await api("/api/results", { method: "POST", body: { race_id: raceId, season_id: seasonId, rows: filled } });
      showToast("success", "Race results saved. Standings update instantly.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>Select a game, series and season above.</p></div>;
  }

  return (
    <section>
      <div className="page-title">
        <h2>Race Entry · {season?.name ?? ""}</h2>
        <span className="page-badge">{entries.length} Drivers</span>
      </div>

      <div className="form-card" style={{ maxWidth: "100%" }}>
        <div className="field">
          <label>Race</label>
          <select value={raceId} onChange={e => selectRace(e.target.value)}>
            <option value="">Select a race…</option>
            {races.map(r => <option key={r.id} value={r.id}>R{r.round_number} · {r.name}{r.track ? ` — ${r.track}` : ""}</option>)}
          </select>
        </div>

        {entries.length === 0 ? (
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet — add them in Roster &amp; Teams.</p>
        ) : (
          <div className="result-grid">
            <span className="grid-header">Pos</span>
            <span className="grid-header">Driver</span>
            <span className="grid-header">Laps Led</span>
            <span className="grid-header">Incidents</span>
            <span className="grid-header">Status</span>
            {rows.map((row, idx) => (
              <RowInputs key={row.entry_id} row={row} idx={idx} updateRow={updateRow} />
            ))}
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        <button className="btn btn-primary" onClick={handleSave} disabled={busy || !raceId}>
          {busy ? "Saving…" : "Save Race Results"}
        </button>
        <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setRows(blankRows(entries))}>
          Reset Grid
        </button>
      </div>
    </section>
  );
}

function RowInputs({ row, idx, updateRow }) {
  return (
    <>
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem" }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      <input type="number" min="0" value={row.laps_led} onChange={e => updateRow(idx, "laps_led", e.target.value)} />
      <input type="number" min="0" value={row.incidents} onChange={e => updateRow(idx, "incidents", e.target.value)} />
      <select value={row.status} onChange={e => updateRow(idx, "status", e.target.value)}>
        <option value="finished">Finished</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
    </>
  );
}

export default function RaceEntryPage() {
  return <AdminGate><RaceEntryInner /></AdminGate>;
}
