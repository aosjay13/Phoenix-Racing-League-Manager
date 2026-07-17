"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { pointsFor, configForTemplate, resolveSeasonConfig, defaultSessionFlags } from "@/lib/standings";
import { parseTime, formatTime, formatGap, parseLapsDown, deriveLaps } from "@/lib/raceTime";

const RESULT_FIELDS = ["finish_pos", "qual_time", "race_time", "interval", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "provisional", "status"];

function blankRow(entry, position) {
  return {
    entry_id: entry.id ?? entry.entry_id,
    driver_name: entry.name ?? entry.driver_name,
    driver_number: entry.number ?? entry.driver_number ?? null,
    finish_pos: String(position),
    qual_time: "",
    race_time: "",
    interval: "",
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

function blankRows(entries) {
  return entries.map((e, i) => blankRow(e, i + 1));
}

const rowFromEntry = (entry, position) => blankRow(entry, position);

function buildRows(entries, existing, totalLaps) {
  const byEntry = Object.fromEntries(existing.map(r => [r.entry_id, r]));
  const merged = blankRows(entries).map(row => {
    const prev = byEntry[row.entry_id];
    const out = { ...row };
    if (prev) {
      for (const f of RESULT_FIELDS) {
        if (prev[f] == null) continue;
        out[f] = typeof row[f] === "boolean" ? !!prev[f] : String(prev[f]);
      }
    } else {
      // Fresh row with no saved result yet: pre-fill laps to the full race
      // distance so lead-lap finishers don't need manual entry.
      const d = deriveLaps(out, totalLaps);
      if (d != null) out.laps = String(d);
    }
    return out;
  });
  // Display in finishing order so dragging to reorder is meaningful.
  return sortByFinish(merged);
}

function sortByFinish(rows) {
  return [...rows].sort((a, b) => {
    const av = a.finish_pos === "" || a.finish_pos == null ? Infinity : Number(a.finish_pos);
    const bv = b.finish_pos === "" || b.finish_pos == null ? Infinity : Number(b.finish_pos);
    return av - bv;
  });
}

const LABELS = { qualifying: "Qualifying", race: "Race", heat: "Heat", consolation: "Consolation", feature: "Feature" };

// Unified results grid for any session type — Qualifying, standard Race
// sessions, or (for heat-format events) Heats, Consolation, and the Feature.
// Renders horizontal sub-tabs across the sessions of this type (with an
// optional "+" to add a new named heat/consolation), a Points column
// computed from that session's own points template (falling back to the
// season default), and lets rows be dragged into the right finishing order.
//
// Starting position lives only on Qualifying (its Pos column) — there is no
// "Start" field on race/heat/consolation/feature rows. A driver's qualifying
// bonus/pole bonus is looked up from their actual Qualifying result for this
// race, not copied onto every other session, so Average Start and Poles are
// always computed from Qualifying results alone.
export function SessionEditor({
  race, seasonId, entries, sessionType, sessionNames,
  season, templates = [], sessionPoints = {}, onSessionPointsChange,
  sessionStats = {}, onSessionStatsChange, sessionPointsEnabled = {}, onSessionPointsEnabledChange,
  canAddSession = false, onAddSession, onRemoveSession, onRenameSession,
  initialSession, onEntriesChanged, seriesName,
}) {
  const names = sessionNames.length ? sessionNames : [LABELS[sessionType] || "Session"];
  const namesKey = names.join("|");
  const [session, setSession] = useState(
    initialSession && names.includes(initialSession) ? initialSession : names[0]
  );
  const [rows, setRows] = useState(() => blankRows(entries));
  const [qualPos, setQualPos] = useState({}); // entry_id -> this race's Qualifying finish position
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [justAddedId, setJustAddedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadSession(sess) {
    setSession(sess);
    setLoading(true);
    try {
      const all = await api(`/api/results?race_id=${race.id}`);
      const qp = Object.fromEntries(
        all.filter(r => r.session_type === "qualifying").map(r => [r.entry_id, Number(r.finish_pos)])
      );
      setQualPos(qp);
      const existing = all.filter(r => r.session_type === sessionType && (r.session || names[0]) === sess);
      setRows(buildRows(entries, existing, race.total_laps));
    } catch {
      setQualPos({});
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

  const totalLaps = Number(race?.total_laps) || null;
  const leaderTimeOf = rs => {
    const L = rs.find(r => Number(r.finish_pos) === 1);
    return L ? parseTime(L.race_time) : null;
  };

  // Editing Race Time: the leader's time is the reference. Typing it on a
  // non-leader derives that row's interval; typing it on the leader re-derives
  // every other row's Race Time from their interval.
  function updateRaceTime(idx, value) {
    setRows(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, race_time: value } : r));
      const isLeader = Number(next[idx].finish_pos) === 1;
      const lt = leaderTimeOf(next);
      if (isLeader) {
        return next.map(r => {
          if (Number(r.finish_pos) === 1 || lt == null) return r;
          const gap = parseTime(r.interval); // "+1.234" → seconds; laps-down → null
          if (parseLapsDown(r.interval) == null && gap != null) return { ...r, race_time: formatTime(lt + gap) };
          return r;
        });
      }
      const rt = parseTime(value);
      if (rt != null && lt != null) next[idx] = { ...next[idx], interval: formatGap(rt - lt) };
      return next;
    });
  }

  // Editing Interval: "NL" marks laps-down (and sets laps = total − N); a time
  // gap derives Race Time from the leader's time.
  function updateInterval(idx, value) {
    setRows(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, interval: value } : r));
      const ld = parseLapsDown(value);
      if (ld != null) {
        const patch = { ...next[idx], race_time: "" };
        const d = deriveLaps(patch, totalLaps);
        if (d != null) patch.laps = String(d);
        next[idx] = patch;
      } else {
        const lt = leaderTimeOf(next);
        const gap = parseTime(value);
        const patch = { ...next[idx] };
        if (gap != null && lt != null) patch.race_time = formatTime(lt + gap);
        const d = deriveLaps(patch, totalLaps); // lead-lap finisher → total
        if (d != null) patch.laps = String(d);
        next[idx] = patch;
      }
      return next;
    });
  }

  // Status change re-derives laps (finished lead-lap → total; DNF/DNS/DQ stays
  // manual so the admin can enter the lap they retired on).
  function updateStatus(idx, value) {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const patch = { ...r, status: value };
      const d = deriveLaps(patch, totalLaps);
      if (d != null) patch.laps = String(d);
      return patch;
    }));
  }

  function handleDriverAdded(entry) {
    setRows(prev => [...prev, rowFromEntry(entry, prev.length + 1)]);
    setJustAddedId(entry.id);
    onEntriesChanged?.();
  }

  // Drag a row's handle to drop it into a new finishing position — every
  // row's finish_pos is renumbered to match the new order, so admins never
  // have to hand-type positions to slot someone in; typing is still there
  // for quick single-row corrections.
  function handleDragStart(idx) { setDragIndex(idx); }
  function handleDragOver(idx, e) { e.preventDefault(); if (overIndex !== idx) setOverIndex(idx); }
  function handleDragEnd() { setDragIndex(null); setOverIndex(null); }
  function handleDrop(idx) {
    setRows(prev => {
      if (dragIndex == null || dragIndex === idx) return prev;
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      const renumbered = next.map((r, i) => ({ ...r, finish_pos: String(i + 1) }));
      if (sessionType === "qualifying") return renumbered;
      // Reordering can change who leads; re-derive intervals off the new P1.
      const lt = leaderTimeOf(renumbered);
      return renumbered.map(r => {
        if (Number(r.finish_pos) === 1) return { ...r, interval: "" };
        if (parseLapsDown(r.interval) != null || lt == null) return r;
        const rt = parseTime(r.race_time);
        if (rt != null) return { ...r, interval: formatGap(rt - lt) };
        const gap = parseTime(r.interval);
        if (gap != null) return { ...r, race_time: formatTime(lt + gap) };
        return r;
      });
    });
    setDragIndex(null);
    setOverIndex(null);
  }

  const templateId = sessionPoints[session] || "";
  const config = useMemo(() => {
    const base = resolveSeasonConfig(season || {});
    const template = templates.find(t => t.id === templateId);
    return configForTemplate(base, template);
  }, [season, templates, templateId]);

  // Per-session eligibility toggles. Qualifying is excluded — it never earns
  // championship points on its own and always feeds Poles/Average Start, so the
  // switches only apply to race-type sessions. Falls back to the session-type
  // default until an admin explicitly flips a switch.
  const flagDefaults = defaultSessionFlags(sessionType);
  const statsOn = session in sessionStats ? !!sessionStats[session] : flagDefaults.counts_stats;
  const pointsOn = session in sessionPointsEnabled ? !!sessionPointsEnabled[session] : flagDefaults.counts_points;
  const showToggles = sessionType !== "qualifying" && (onSessionStatsChange || onSessionPointsEnabledChange);

  const rowPoints = row => (sessionType === "qualifying"
    ? Number(config.qualPoints[row.finish_pos] ?? 0)
    : pointsFor(row, config, qualPos[row.entry_id] ?? null));

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

  async function submitRename(e) {
    e.preventDefault();
    const to = renameValue.trim();
    if (!to || to === session) { setRenaming(false); return; }
    try {
      await onRenameSession(session, to);
      setRenaming(false);
      // Select + reload the renamed session directly; its results were
      // migrated server-side, so they match on the new name regardless of
      // whether the parent's updated names prop has propagated yet.
      loadSession(to);
    } catch (err) {
      showToast("error", err.message);
    }
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

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        {onSessionPointsChange && (
          <div className="field" style={{ maxWidth: 280, margin: 0 }}>
            <label>Points system · {session}</label>
            <select value={templateId} onChange={e => onSessionPointsChange(session, e.target.value)}>
              <option value="">Season default</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {showToggles && (
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <Toggle label="Count towards Official Stats" checked={statsOn}
              onChange={v => onSessionStatsChange?.(session, v)} />
            <Toggle label="Award Championship Points" checked={pointsOn}
              onChange={v => onSessionPointsEnabledChange?.(session, v)} />
          </div>
        )}
        {onRenameSession && (
          renaming ? (
            <form onSubmit={submitRename} style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <div className="field" style={{ maxWidth: 200, margin: 0 }}>
                <label>Rename “{session}”</label>
                <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} placeholder="New name" />
              </div>
              <button className="btn btn-primary" type="submit" style={{ marginTop: 0 }}>Save</button>
              <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={() => setRenaming(false)}>Cancel</button>
            </form>
          ) : (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              onClick={() => { setRenameValue(session); setRenaming(true); }}>
              ✎ Rename “{session}”
            </button>
          )
        )}
      </div>

      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        {sessionType === "qualifying"
          ? "Position 1 is the pole. This is the only place starting position is recorded — Average Start and Poles are calculated from Qualifying results only."
          : <>Enter <strong>Race Time</strong> for the leader, then either a Race Time or an <strong>Int</strong> (gap behind leader, e.g. <code>+2.345</code>) for everyone else — each fills in the other. Use <code>1L</code>, <code>2L</code>… in Int for laps down.{totalLaps ? ` Laps auto-count off the ${totalLaps}-lap distance (laps down and DNF lap subtract from it).` : " Set Total Race Laps on the Race Info tab so laps auto-count."}</>}
      </p>

      {!rows.length ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet.</p>
      ) : loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : sessionType === "qualifying" ? (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder.</p>
          <div className="qual-grid">
            {["", "Pos", "Driver", "Qual Time", pointsLabel].map((h, i) => <span className="grid-header" key={h || i}>{h}</span>)}
            {rows.map((row, idx) => (
              <QualRow key={row.entry_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder — finishing positions renumber automatically.</p>
          <div className="result-grid result-grid-wide">
            {["", "Fin", "Driver", "Race Time", "Int", "Laps", "Led", "Inc", "FL", "½", "HC", "Prov", "Status", pointsLabel].map((h, i) => (
              <span className="grid-header" key={h || i}>{h}</span>
            ))}
            {rows.map((row, idx) => (
              <RowInputs key={row.entry_id} row={row} idx={idx} updateRow={updateRow}
                updateRaceTime={updateRaceTime} updateInterval={updateInterval} updateStatus={updateStatus}
                autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd} />
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

// Accessible on/off switch used for the per-session Stats/Points eligibility
// toggles. Styled inline so it needs no global CSS additions.
function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-1)", margin: 0 }}>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(!checked); } }}
        style={{
          position: "relative", width: 40, height: 22, borderRadius: 999, flexShrink: 0,
          background: checked ? "var(--accent-cyan)" : "var(--ink-2)",
          transition: "background 0.15s", display: "inline-block",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 20 : 2, width: 18, height: 18,
          borderRadius: "50%", background: "#fff", transition: "left 0.15s",
        }} />
      </span>
      {label}
    </label>
  );
}

function Check({ value, onChange, title }) {
  return (
    <input type="checkbox" title={title} checked={value} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)", margin: "auto" }} />
  );
}

// Drag handle: the sole draggable element for its row. dragOver/onDrop live
// here too (rather than spread across every cell) — a small, reliable drop
// target that's always the first thing in the row.
function DragHandle({ dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title="Drag to reorder"
      style={{
        cursor: "grab",
        textAlign: "center",
        color: "var(--ink-2)",
        fontSize: "1rem",
        opacity: dragging ? 0.35 : 1,
        borderTop: dragOver ? "2px solid var(--accent-cyan)" : "2px solid transparent",
        userSelect: "none",
      }}
    >
      ⠿
    </div>
  );
}

function RowInputs({ row, idx, updateRow, updateRaceTime, updateInterval, updateStatus, autoFocus, points, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const isLeader = Number(row.finish_pos) === 1;
  const num = (field, min = 0, focus = false) => (
    <input type="number" min={min} value={row[field]} onChange={e => updateRow(idx, field, e.target.value)} autoFocus={focus} />
  );
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      {num("finish_pos", 1, autoFocus)}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap", opacity: dragging ? 0.35 : 1 }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      <input placeholder={isLeader ? "1:23.456" : "1:24.567"} value={row.race_time} onChange={e => updateRaceTime(idx, e.target.value)} />
      <input placeholder={isLeader ? "leader" : "+2.345 / 1L"} value={isLeader ? "" : row.interval} disabled={isLeader}
        onChange={e => updateInterval(idx, e.target.value)} />
      {num("laps")}
      {num("laps_led")}
      {num("incidents")}
      <Check title="Fastest lap" value={row.fastest_lap} onChange={v => updateRow(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger" value={row.hard_charger} onChange={v => updateRow(idx, "hard_charger", v)} />
      <Check title="Provisional" value={row.provisional} onChange={v => updateRow(idx, "provisional", v)} />
      <select value={row.status} onChange={e => updateStatus(idx, e.target.value)}>
        <option value="finished">Running</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
    </>
  );
}

function QualRow({ row, idx, updateRow, autoFocus, points, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={autoFocus} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap", opacity: dragging ? 0.35 : 1 }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      <input placeholder="01:43.863" value={row.qual_time} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
    </>
  );
}
