"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { pointsFor, configForTemplate, resolveSeasonConfig } from "@/lib/standings";

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

function rowFromEntry(entry, position) {
  return {
    entry_id: entry.id,
    driver_name: entry.name,
    driver_number: entry.number ?? null,
    finish_pos: String(position),
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
  };
}

// entryId -> starting grid position, built by concatenating the preceding
// stage's results (each sorted by finish order) in the order its sessions
// are listed. Admins can always type over the auto-filled Start value.
function buildPriorGrid(allResults, priorType, priorNames) {
  const grid = {};
  if (!priorType || !priorNames?.length) return grid;
  let pos = 1;
  for (const name of priorNames) {
    const sessionResults = allResults
      .filter(r => r.session_type === priorType && (r.session || priorNames[0]) === name)
      .sort((a, b) => Number(a.finish_pos) - Number(b.finish_pos));
    for (const r of sessionResults) {
      if (!(r.entry_id in grid)) grid[r.entry_id] = pos;
      pos += 1;
    }
  }
  return grid;
}

function buildRows(entries, existing, priorGrid) {
  const byEntry = Object.fromEntries(existing.map(r => [r.entry_id, r]));
  return blankRows(entries).map(row => {
    const prev = byEntry[row.entry_id];
    const merged = { ...row };
    if (prev) {
      for (const f of RESULT_FIELDS) {
        if (prev[f] == null) continue;
        merged[f] = typeof row[f] === "boolean" ? !!prev[f] : String(prev[f]);
      }
    }
    if ((merged.start_pos === "" || merged.start_pos == null) && priorGrid[row.entry_id] != null) {
      merged.start_pos = String(priorGrid[row.entry_id]);
    }
    return merged;
  });
}

const LABELS = { qualifying: "Qualifying", race: "Race", heat: "Heat", consolation: "Consolation", feature: "Feature" };

// Unified results grid for any session type — Qualifying, standard Race
// sessions, or (for heat-format events) Heats, Consolation, and the Feature.
// Renders horizontal sub-tabs across the sessions of this type (with an
// optional "+" to add a new named heat/consolation), a Points column
// computed from that session's own points template (falling back to the
// season default), and auto-fills Start from the immediately preceding
// stage's finishing order — always editable to override manually.
export function SessionEditor({
  race, seasonId, entries, sessionType, sessionNames,
  priorSessionType = null, priorSessionNames = [],
  season, templates = [], sessionPoints = {}, onSessionPointsChange,
  canAddSession = false, onAddSession, onRemoveSession,
  initialSession, onEntriesChanged, seriesName,
}) {
  const names = sessionNames.length ? sessionNames : [LABELS[sessionType] || "Session"];
  const namesKey = names.join("|");
  const [session, setSession] = useState(
    initialSession && names.includes(initialSession) ? initialSession : names[0]
  );
  const [rows, setRows] = useState(() => blankRows(entries));
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [justAddedId, setJustAddedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadSession(sess) {
    setSession(sess);
    setLoading(true);
    try {
      const all = await api(`/api/results?race_id=${race.id}`);
      const priorGrid = buildPriorGrid(all, priorSessionType, priorSessionNames);
      const existing = all.filter(r => r.session_type === sessionType && (r.session || names[0]) === sess);
      setRows(buildRows(entries, existing, priorGrid));
    } catch {
      setRows(blankRows(entries));
    } finally {
      setLoading(false);
    }
  }

  // Deliberately not keyed on `entries` — see prior sessions of this
  // component's history for why: it would wipe in-progress edits whenever a
  // driver is added mid-entry.
  useEffect(() => {
    loadSession(names.includes(session) ? session : names[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id, sessionType, namesKey]);

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function handleDriverAdded(entry) {
    setRows(prev => [...prev, rowFromEntry(entry, prev.length + 1)]);
    setJustAddedId(entry.id);
    onEntriesChanged?.();
  }

  const templateId = sessionPoints[session] || "";
  const config = useMemo(() => {
    const base = resolveSeasonConfig(season || {});
    const template = templates.find(t => t.id === templateId);
    return configForTemplate(base, template);
  }, [season, templates, templateId]);

  const rowPoints = row => (sessionType === "qualifying" ? Number(config.qualPoints[row.finish_pos] ?? 0) : pointsFor(row, config));

  async function handleSave() {
    const filled = rows.filter(r => r.finish_pos !== "");
    if (!filled.length) return showToast("error", "Enter at least one finishing position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same finishing position.");
    }
    setBusy(true);
    try {
      await api("/api/results", {
        method: "POST",
        body: { race_id: race.id, season_id: seasonId, session, session_type: sessionType, points_template_id: templateId || null, rows: filled },
      });
      showToast("success", "Results saved. Standings and profiles update instantly.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  function submitNewSession(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || names.includes(name)) return;
    onAddSession?.(name);
    setNewName("");
    setAdding(false);
  }

  const existingNames = new Set(rows.map(r => r.driver_name.trim().toLowerCase()));
  const pointsLabel = sessionType === "qualifying" ? "Quali Pts" : "Points";

  return (
    <div>
      {(names.length > 1 || canAddSession) && (
        <div className="tab-row" style={{ marginTop: 0, marginBottom: 12, flexWrap: "wrap" }}>
          {names.map(n => (
            <button key={n} className={`tab${session === n ? " active" : ""}`} onClick={() => loadSession(n)}>
              {n}
              {canAddSession && onRemoveSession && names.length > 1 && (
                <span role="button" title={`Remove ${n}`} style={{ marginLeft: 6, opacity: 0.6 }}
                  onClick={e => { e.stopPropagation(); onRemoveSession(n); }}>✕</span>
              )}
            </button>
          ))}
          {canAddSession && (adding ? (
            <form onSubmit={submitNewSession} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ width: 110, padding: "4px 8px" }} />
              <button className="btn btn-primary" type="submit" style={{ marginTop: 0, padding: "4px 10px" }}>Add</button>
              <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => { setAdding(false); setNewName(""); }}>✕</button>
            </form>
          ) : (
            <button className="tab" type="button" onClick={() => setAdding(true)}>+</button>
          ))}
        </div>
      )}

      {onSessionPointsChange && (
        <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
          <label>Points Template · {session}</label>
          <select value={templateId} onChange={e => onSessionPointsChange(session, e.target.value)}>
            <option value="">Season default</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        {sessionType === "qualifying"
          ? "Position 1 is the pole. This order auto-fills the Start column of the next session."
          : "Start auto-fills from the preceding session's finishing order — edit it any time to override. FL = fastest lap, ½ = halfway-point leader, HC = hard charger, Prov = provisional start."}
      </p>

      {!rows.length ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet.</p>
      ) : loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : sessionType === "qualifying" ? (
        <div style={{ overflowX: "auto" }}>
          <div className="qual-grid">
            {["Pos", "Driver", "Qual Time", pointsLabel].map(h => <span className="grid-header" key={h}>{h}</span>)}
            {rows.map((row, idx) => (
              <QualRow key={row.entry_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="result-grid result-grid-wide">
            {["Fin", "Driver", "Start", "Qual Time", "Laps", "Led", "Inc", "FL", "½", "HC", "Prov", "Status", pointsLabel].map(h => (
              <span className="grid-header" key={h}>{h}</span>
            ))}
            {rows.map((row, idx) => (
              <RowInputs key={row.entry_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)} />
            ))}
          </div>
        </div>
      )}

      <AddDriverToRace seasonId={seasonId} seriesName={seriesName} existingNames={existingNames} onCreated={handleDriverAdded} onError={msg => showToast("error", msg)} />

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading || !rows.length} style={{ marginTop: 16 }}>
        {busy ? "Saving…" : `Save ${LABELS[sessionType] || "Results"}`}
      </button>
      {!!rows.length && (
        <button className="btn btn-ghost" style={{ marginLeft: 8 }}
          onClick={() => setRows(prev => prev.map((r, i) => rowFromEntry({ id: r.entry_id, name: r.driver_name, number: r.driver_number }, i + 1)))}>
          Reset Grid
        </button>
      )}
    </div>
  );
}

function Check({ value, onChange, title }) {
  return (
    <input type="checkbox" title={title} checked={value} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)", margin: "auto" }} />
  );
}

function RowInputs({ row, idx, updateRow, autoFocus, points }) {
  const num = (field, min = 0, focus = false) => (
    <input type="number" min={min} value={row[field]} onChange={e => updateRow(idx, field, e.target.value)} autoFocus={focus} />
  );
  return (
    <>
      {num("finish_pos", 1, autoFocus)}
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
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
    </>
  );
}

function QualRow({ row, idx, updateRow, autoFocus, points }) {
  return (
    <>
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={autoFocus} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap" }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      <input placeholder="01:43.863" value={row.qual_time} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
    </>
  );
}
