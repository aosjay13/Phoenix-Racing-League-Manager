"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const RESULT_FIELDS = ["finish_pos", "start_pos", "qual_time", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "provisional", "status"];

function blankRows(entries) {
  return entries.map((e, i) => ({
    entry_id: e.id,
    driver_name: e.name,
    driver_number: e.number,
    finish_pos: String(i + 1),
    start_pos: "",
    qual_time: "",
    laps: "",
    laps_led: "0",
    incidents: "0",
    fastest_lap: false,
    halfway_leader: false,
    hard_charger: false,
    provisional: false,
    status: "finished",
  }));
}

function buildRows(entries, existing) {
  const byEntry = Object.fromEntries(existing.map(r => [r.entry_id, r]));
  return blankRows(entries).map(row => {
    const prev = byEntry[row.entry_id];
    if (!prev) return row;
    const merged = { ...row };
    for (const f of RESULT_FIELDS) {
      if (prev[f] == null) continue;
      merged[f] = typeof row[f] === "boolean" ? !!prev[f] : String(prev[f]);
    }
    return merged;
  });
}

// Self-contained results grid for one race: loads existing results, edits
// finishing order/points/flags, and overwrites the selected session in place.
export function RaceResultsEditor({ race, seasonId, entries, initialSession }) {
  const sessions = Array.isArray(race?.sessions) && race.sessions.length ? race.sessions : ["Race"];
  const [session, setSession] = useState(
    initialSession && sessions.includes(initialSession) ? initialSession : sessions[0]
  );
  const [rows, setRows] = useState(() => blankRows(entries));
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadSession(sess) {
    setSession(sess);
    setLoading(true);
    try {
      const all = await api(`/api/results?race_id=${race.id}`);
      const existing = all.filter(r => (r.session || sessions[0]) === sess);
      setRows(buildRows(entries, existing));
    } catch {
      setRows(blankRows(entries));
    } finally {
      setLoading(false);
    }
  }

  // (Re)load whenever the race or roster changes.
  useEffect(() => {
    loadSession(initialSession && sessions.includes(initialSession) ? initialSession : sessions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id, entries]);

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    const filled = rows.filter(r => r.finish_pos !== "");
    if (!filled.length) return showToast("error", "Enter at least one finishing position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same finishing position.");
    }
    setBusy(true);
    try {
      await api("/api/results", { method: "POST", body: { race_id: race.id, season_id: seasonId, session, rows: filled } });
      showToast("success", "Race results saved. Standings and profiles update instantly.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!entries.length) {
    return <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet — add them in Roster &amp; Teams.</p>;
  }

  return (
    <div>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        Start = qualifying position (P1 counts as pole). FL = fastest lap, ½ = halfway-point leader,
        HC = hard charger, Prov = provisional start. Bonus points apply automatically from season settings.
      </p>

      {sessions.length > 1 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Race in this event ({sessions.length})</label>
          <select value={session} onChange={e => loadSession(e.target.value)}>
            {sessions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="result-grid result-grid-wide">
            {["Fin", "Driver", "Start", "Qual Time", "Laps", "Led", "Inc", "FL", "½", "HC", "Prov", "Status"].map(h => (
              <span className="grid-header" key={h}>{h}</span>
            ))}
            {rows.map((row, idx) => (
              <RowInputs key={row.entry_id} row={row} idx={idx} updateRow={updateRow} />
            ))}
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading}>
        {busy ? "Saving…" : "Save Race Results"}
      </button>
      <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setRows(blankRows(entries))}>
        Reset Grid
      </button>
    </div>
  );
}

function Check({ value, onChange, title }) {
  return (
    <input type="checkbox" title={title} checked={value} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)", margin: "auto" }} />
  );
}

function RowInputs({ row, idx, updateRow }) {
  const num = (field, min = 0) => (
    <input type="number" min={min} value={row[field]} onChange={e => updateRow(idx, field, e.target.value)} />
  );
  return (
    <>
      {num("finish_pos", 1)}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap" }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      {num("start_pos", 1)}
      <input placeholder="01:43.863" value={row.qual_time} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      {num("laps")}
      {num("laps_led")}
      {num("incidents")}
      <Check title="Fastest lap" value={row.fastest_lap} onChange={v => updateRow(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger" value={row.hard_charger} onChange={v => updateRow(idx, "hard_charger", v)} />
      <Check title="Provisional" value={row.provisional} onChange={v => updateRow(idx, "provisional", v)} />
      <select value={row.status} onChange={e => updateRow(idx, "status", e.target.value)}>
        <option value="finished">Running</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
    </>
  );
}
