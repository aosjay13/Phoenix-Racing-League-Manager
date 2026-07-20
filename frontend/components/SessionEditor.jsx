"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { PointsEditorModal } from "@/components/PointsEditorModal";
import { ImportResultsModal } from "@/components/ImportResultsModal";
import { NONE_TEMPLATE } from "@/lib/pointsTemplates";
import { pointsFor, configForTemplate, resolveSeasonConfig, defaultSessionFlags } from "@/lib/standings";
import { parseTime, formatTime, formatGap, parseLapsDown, deriveLaps } from "@/lib/raceTime";

const RESULT_FIELDS = ["finish_pos", "start_pos", "qual_time", "race_time", "interval", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "provisional", "status"];
const BOOL_FIELDS = new Set(["fastest_lap", "halfway_leader", "hard_charger", "provisional"]);

// Each grid row is a *finishing position* — it may or may not yet have a
// driver assigned. `entry_id === null` is an empty slot (rendered with a
// searchable driver dropdown); once a driver is picked it becomes a full
// result row. `slot_id` gives every row a stable React key even before it has
// an entry.
let SLOT_SEQ = 0;
function makeRow(position) {
  SLOT_SEQ += 1;
  return {
    slot_id: `slot-${SLOT_SEQ}`,
    entry_id: null,
    driver_name: "",
    driver_number: null,
    finish_pos: String(position),
    start_pos: "",
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

// A clean slate of numbered, driverless finishing positions.
function emptySlots(n) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => makeRow(i + 1));
}

// Attaches a driver (roster entry) to a slot, pre-filling laps to the full
// race distance so lead-lap finishers don't need manual entry.
function assignEntry(row, entry, totalLaps) {
  const out = {
    ...row,
    entry_id: entry.id ?? entry.entry_id,
    driver_name: entry.name ?? entry.driver_name ?? "",
    driver_number: entry.number ?? entry.driver_number ?? null,
  };
  const d = deriveLaps(out, totalLaps);
  if (d != null) out.laps = String(d);
  return out;
}

// Builds the editable grid from any saved results, then pads it with empty,
// numbered finishing slots — one for each roster driver still to be placed —
// so manual entry starts as a clean slate the admin fills from a searchable
// dropdown, rather than the whole roster being dumped in and reordered.
//
// Qualifying only feeds the **Start** column of race-type sessions (via
// qualPos), never the Finish order. A saved result's own start_pos wins over
// the qualifying default once entered.
function buildRows(entries, existing, totalLaps, qualPos = {}, sessionType = "race") {
  const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
  const filled = existing
    .filter(r => entryById.has(r.entry_id))
    .map(r => {
      const row = assignEntry(makeRow(r.finish_pos), entryById.get(r.entry_id), totalLaps);
      if (sessionType !== "qualifying" && qualPos[row.entry_id] != null) row.start_pos = String(qualPos[row.entry_id]);
      for (const f of RESULT_FIELDS) {
        if (r[f] == null) continue;
        row[f] = BOOL_FIELDS.has(f) ? !!r[f] : String(r[f]);
      }
      return row;
    });
  const sorted = sortByFinish(filled);
  let pos = sorted.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
  const rows = [...sorted];
  const target = Math.max(entries.length, sorted.length);
  while (rows.length < target) { pos += 1; rows.push(makeRow(pos)); }
  return rows;
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
  season, templates = [], sessionPoints = {}, onSessionPointsChange, onTemplatesChanged,
  sessionStats = {}, onSessionStatsChange, sessionPointsEnabled = {}, onSessionPointsEnabledChange,
  canAddSession = false, onAddSession, onRemoveSession, onRenameSession,
  initialSession, onEntriesChanged, seriesName,
}) {
  const names = sessionNames.length ? sessionNames : [LABELS[sessionType] || "Session"];
  const namesKey = names.join("|");
  const [session, setSession] = useState(
    initialSession && names.includes(initialSession) ? initialSession : names[0]
  );
  const [rows, setRows] = useState(() => emptySlots(entries.length));
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
  const [pointsModal, setPointsModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createFor, setCreateFor] = useState(null); // { slotId, name } while the inline-create modal is open

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
      setRows(buildRows(entries, existing, race.total_laps, qp, sessionType));
    } catch {
      setQualPos({});
      setRows(emptySlots(entries.length));
    } finally {
      setLoading(false);
    }
  }

  // Deliberately not keyed on `entries` — see prior sessions of this
  // component's history for why: it would wipe in-progress edits whenever a
  // driver is added mid-entry. New entries simply become available in the
  // per-slot dropdowns without disturbing the grid.
  useEffect(() => {
    loadSession(names.includes(session) ? session : names[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id, sessionType, namesKey]);

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  const totalLaps = Number(race?.total_laps) || null;

  // Assigns/creates a driver into a specific slot, seeding Start from the
  // driver's Qualifying position for race-type sessions.
  const withDriver = (row, entry) => {
    const out = assignEntry(row, entry, totalLaps);
    if (sessionType !== "qualifying" && qualPos[out.entry_id] != null) out.start_pos = String(qualPos[out.entry_id]);
    return out;
  };
  function assignToSlot(slotId, entry) {
    setRows(prev => prev.map(r => (r.slot_id === slotId ? withDriver(r, entry) : r)));
  }
  // Empties a slot (mis-pick fix) — keeps the finishing position, drops the
  // driver so it can be searched again. Non-destructive: the season entry stays.
  function clearSlot(idx) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...makeRow(r.finish_pos), slot_id: r.slot_id } : r)));
  }
  function addSlot() {
    setRows(prev => [...prev, makeRow(prev.length + 1)]);
  }
  // Drops a finishing position from the grid and renumbers the rest.
  function removeSlot(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, finish_pos: String(i + 1) })));
  }

  const assignedIds = useMemo(() => new Set(rows.map(r => r.entry_id).filter(Boolean)), [rows]);
  // Roster drivers not already placed in another slot (plus this slot's own
  // driver, so a filled row can be re-searched without hiding itself).
  const availableFor = row => entries.filter(e => {
    const id = e.id ?? e.entry_id;
    return id === row.entry_id || !assignedIds.has(id);
  });

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

  // A driver added from the bottom "Add a driver" bar drops into the first
  // empty finishing slot (or a new one at the back if the field is full).
  function handleDriverAdded(entry) {
    setRows(prev => {
      const idx = prev.findIndex(r => !r.entry_id);
      if (idx >= 0) return prev.map((r, i) => (i === idx ? withDriver(r, entry) : r));
      return [...prev, withDriver(makeRow(prev.length + 1), entry)];
    });
    setJustAddedId(entry.id);
    onEntriesChanged?.();
  }

  // Removes a driver added by mistake — entries are season-wide (the same
  // driver can be entered on every race/session), so this deletes their entry
  // outright rather than just clearing the slot, and the server cascades that
  // to any results already saved for them anywhere in the season.
  async function removeEntry(row) {
    if (!confirm(`Remove ${row.driver_name} from the season? This removes them from every race and session, not just ${session}, and deletes any results already saved for them. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/entries/${row.entry_id}`, { method: "DELETE" });
      // Clear the slot rather than deleting the row, so the finishing
      // position stays available to reassign.
      setRows(prev => prev.map(r => (r.entry_id === row.entry_id ? { ...makeRow(r.finish_pos), slot_id: r.slot_id } : r)));
      onEntriesChanged?.();
      showToast("success", `${row.driver_name} removed.`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  // Merge a batch of imported results into the grid, keyed by entry_id. Matched
  // drivers are placed into finishing order from the import; roster drivers the
  // import didn't cover go to the back as empty slots to fill by hand. Nothing
  // is persisted — the admin reviews and hits Save.
  function applyImport(imported) {
    const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
    const byId = new Map();
    for (const r of imported) if (entryById.has(r.entry_id)) byId.set(r.entry_id, r); // last wins on duplicates
    const num = (v, fallback) => (v === "" || v == null ? fallback : String(v));
    const placed = [...byId.values()].map(im => {
      const row = withDriver(makeRow(im.finish_pos), entryById.get(im.entry_id));
      return {
        ...row,
        finish_pos: num(im.finish_pos, row.finish_pos),
        start_pos: im.start_pos != null ? String(im.start_pos) : row.start_pos,
        laps: num(im.laps, row.laps),
        laps_led: num(im.laps_led, row.laps_led),
        incidents: num(im.incidents, row.incidents),
        interval: im.interval || row.interval,
        race_time: im.race_time || row.race_time,
        qual_time: im.qual_time || row.qual_time,
        status: im.status || row.status,
        fastest_lap: !!im.fastest_lap,
      };
    });
    const sorted = sortByFinish(placed);
    const covered = new Set(placed.map(r => r.entry_id));
    const uncovered = entries.filter(e => !covered.has(e.id ?? e.entry_id)).length;
    let pos = sorted.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
    const next = [...sorted];
    for (let i = 0; i < uncovered; i++) { pos += 1; next.push(makeRow(pos)); }
    setRows(next);
    setImportOpen(false);
    const n = byId.size;
    showToast("success", `Imported ${n} result${n === 1 ? "" : "s"}. Review the grid, then Save.`);
  }

  // Drag a row's handle to drop it into a new finishing position — every
  // row's finish_pos is renumbered to match the new order, so admins never
  // have to hand-type positions to slot someone in; the dropdown is still
  // there for quick single-row placement.
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
    const template = templateId === NONE_TEMPLATE.id ? NONE_TEMPLATE : templates.find(t => t.id === templateId);
    return configForTemplate(base, template);
  }, [season, templates, templateId]);

  // Qualifying's own points system (always the "Qualifying" session, regardless
  // of which tab is open) — used to resolve the qualifying-position bonus
  // folded into race-type rows below, so a points structure assigned
  // specifically to Qualifying is reflected here too, not just the season/race
  // default. See lib/standings.js:pointsFor's `qualConfig` param.
  const qualTemplateId = sessionPoints["Qualifying"] || "";
  const qualConfig = useMemo(() => {
    const base = resolveSeasonConfig(season || {});
    const template = qualTemplateId === NONE_TEMPLATE.id ? NONE_TEMPLATE : templates.find(t => t.id === qualTemplateId);
    return configForTemplate(base, template);
  }, [season, templates, qualTemplateId]);

  // Per-session eligibility toggles. Qualifying is excluded — it never earns
  // championship points on its own and always feeds Poles/Average Start, so the
  // switches only apply to race-type sessions. Falls back to the session-type
  // default until an admin explicitly flips a switch.
  const flagDefaults = defaultSessionFlags(sessionType);
  const statsOn = session in sessionStats ? !!sessionStats[session] : flagDefaults.counts_stats;
  const pointsOn = session in sessionPointsEnabled ? !!sessionPointsEnabled[session] : flagDefaults.counts_points;
  const showToggles = sessionType !== "qualifying" && (onSessionStatsChange || onSessionPointsEnabledChange);

  // Points only meaningful once a driver is in the slot.
  const rowPoints = row => (!row.entry_id ? "" : sessionType === "qualifying"
    ? Number(config.qualPoints[row.finish_pos] ?? 0)
    : pointsFor(row, config, qualPos[row.entry_id] ?? null, qualConfig));

  async function handleSave() {
    const filled = rows.filter(r => r.entry_id && r.finish_pos !== "");
    if (!filled.length) return showToast("error", "Assign at least one driver to a finishing position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same finishing position.");
    }
    const ids = filled.map(r => r.entry_id);
    if (new Set(ids).size !== ids.length) {
      return showToast("error", "A driver is entered in more than one position.");
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

  // Clears this session's saved results from the database and resets the grid
  // — the "delete a portion of the race" action; the session itself stays.
  async function handleDeleteResults() {
    if (!confirm(`Delete all saved ${session} results? The session stays — only its results are removed. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/results?race_id=${race.id}&session=${encodeURIComponent(session)}&session_type=${sessionType}`, { method: "DELETE" });
      showToast("success", `${session} results deleted.`);
      await loadSession(session);
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

  const existingNames = new Set(rows.map(r => r.driver_name).filter(Boolean).map(n => n.trim().toLowerCase()));
  const pointsLabel = sessionType === "qualifying" ? "Quali Pts" : "Points";

  const rowCommon = (row, idx) => ({
    available: availableFor(row),
    onAssign: entry => assignToSlot(row.slot_id, entry),
    onClear: () => clearSlot(idx),
    onRequestCreate: name => setCreateFor({ slotId: row.slot_id, name }),
    onRemove: () => (row.entry_id ? removeEntry(row) : removeSlot(idx)),
  });

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
        <button className="btn btn-ghost" type="button" title="Import results from a CSV export or pasted table"
          style={{ marginTop: 0, whiteSpace: "nowrap" }} onClick={() => setImportOpen(true)} disabled={!entries.length}>
          ⬆ Import Results
        </button>
        {onSessionPointsChange && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ maxWidth: 280, margin: 0 }}>
              <label>Points system · {session}</label>
              <select value={templateId}
                onChange={e => Promise.resolve(onSessionPointsChange(session, e.target.value, sessionType)).catch(err => showToast("error", err.message))}>
                <option value="">Season default</option>
                <option value={NONE_TEMPLATE.id}>{NONE_TEMPLATE.name}</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button className="btn btn-ghost" type="button" title="View, edit, or create the points structure for this session"
              style={{ marginTop: 0, whiteSpace: "nowrap" }} onClick={() => setPointsModal(true)}>
              ⚙ Edit Points Structure
            </button>
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
          ? "Position 1 is the pole. Each slot starts empty — click it, type a name, and pick the driver from the dropdown (or create a new one inline). This is the only place starting position is recorded — Average Start and Poles are calculated from Qualifying results only."
          : <>Each finishing position starts empty — click a slot, type a driver's name, and pick them from the dropdown (or create a new driver inline). Drag ⠿ to reorder; positions renumber automatically. Enter <strong>Race Time</strong> for the leader, then either a Race Time or an <strong>Int</strong> (gap behind leader, e.g. <code>+2.345</code>) for everyone else — each fills in the other. Use <code>1L</code>, <code>2L</code>… in Int for laps down.{totalLaps ? ` Laps auto-count off the ${totalLaps}-lap distance (laps down and DNF lap subtract from it).` : " Set Total Race Laps on the Race Info tab so laps auto-count."}</>}
      </p>

      {!entries.length ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet — add one below to start entering results.</p>
      ) : loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : sessionType === "qualifying" ? (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder.</p>
          <div className="qual-grid">
            {["", "Pos", "Driver", "Qual Time", pointsLabel, ""].map((h, i) => <span className="grid-header" key={h || i}>{h}</span>)}
            {rows.map((row, idx) => (
              <QualRow key={row.slot_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd}
                {...rowCommon(row, idx)} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder — finishing positions renumber automatically.</p>
          <div className="result-grid result-grid-wide">
            {["", "Fin", "Start", "Driver", "Race Time", "Int", "Laps", "Led", "Inc", "FL", "½", "HC", "Prov", "Status", pointsLabel, ""].map((h, i) => (
              <span className="grid-header" key={h || i}>{h}</span>
            ))}
            {rows.map((row, idx) => (
              <RowInputs key={row.slot_id} row={row} idx={idx} updateRow={updateRow}
                updateRaceTime={updateRaceTime} updateInterval={updateInterval} updateStatus={updateStatus}
                autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd}
                {...rowCommon(row, idx)} />
            ))}
          </div>
        </div>
      )}

      {!!entries.length && !loading && (
        <button className="btn btn-ghost" type="button" onClick={addSlot} style={{ marginTop: 10 }}>
          ＋ Add finishing position
        </button>
      )}

      <AddDriverToRace seasonId={seasonId} seriesName={seriesName} existingNames={existingNames} onCreated={handleDriverAdded} onError={msg => showToast("error", msg)} />

      {pointsModal && (
        <PointsEditorModal
          session={session} sessionType={sessionType} value={templateId}
          templates={templates} season={season}
          onAssign={onSessionPointsChange} onTemplatesChanged={onTemplatesChanged}
          onClose={() => setPointsModal(false)}
        />
      )}

      {importOpen && (
        <ImportResultsModal
          session={session} sessionType={sessionType} entries={entries}
          seasonId={seasonId} seriesName={seriesName}
          onDriverCreated={handleDriverAdded}
          onApply={applyImport} onClose={() => setImportOpen(false)}
        />
      )}

      {createFor && (
        <DriverCreateModal
          seasonId={seasonId} seriesName={seriesName} initialName={createFor.name}
          onClose={() => setCreateFor(null)}
          onCreated={entry => { assignToSlot(createFor.slotId, entry); setCreateFor(null); onEntriesChanged?.(); }}
        />
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading || !entries.length} style={{ marginTop: 16 }}>
        {busy ? "Saving…" : `Save ${LABELS[sessionType] || "Results"}`}
      </button>
      {!!entries.length && (
        <button className="btn btn-ghost" style={{ marginLeft: 8 }}
          title="Clear every slot back to an empty finishing grid"
          onClick={() => setRows(emptySlots(entries.length))}>
          Reset Grid
        </button>
      )}
      <button className="btn btn-danger" style={{ marginLeft: 8 }} onClick={handleDeleteResults} disabled={busy || loading}>
        🗑 Delete {session} Results
      </button>
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

function Check({ value, onChange, title, disabled }) {
  return (
    <input type="checkbox" title={title} checked={value} disabled={disabled} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)", margin: "auto", opacity: disabled ? 0.35 : 1 }} />
  );
}

// Searchable driver picker for an empty finishing slot. Filters the series
// roster (drivers not already placed) as you type; Enter/click locks a driver
// in, or opens inline creation for a brand-new one. The dropdown renders in a
// portal so it's never clipped by the grid's horizontal scroll container.
function DriverCombobox({ available, onAssign, onRequestCreate }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();
  const matches = (q ? available.filter(e => (e.name ?? e.driver_name ?? "").toLowerCase().includes(q)) : available).slice(0, 8);
  const exact = available.some(e => (e.name ?? e.driver_name ?? "").toLowerCase() === q);
  const options = [
    ...matches.map(e => ({ type: "entry", entry: e })),
    ...(q.length > 0 && !exact ? [{ type: "create" }] : []),
  ];

  function place() {
    const el = inputRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }
  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);

  function choose(opt) {
    if (!opt) return;
    if (opt.type === "entry") onAssign(opt.entry);
    else onRequestCreate(query.trim());
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input ref={inputRef} value={query} placeholder="Search driver…"
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); place(); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown} />
      {open && rect && options.length > 0 && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220), zIndex: 1000,
          background: "var(--surface-1, #14141c)", border: "1px solid var(--border)", borderRadius: 8,
          maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {options.map((opt, i) => (
            <button key={opt.type === "entry" ? (opt.entry.id ?? opt.entry.entry_id) : "__create"} type="button"
              className="btn btn-ghost"
              style={{
                display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0,
                background: i === active ? "var(--bg-elevated)" : "transparent",
                color: opt.type === "create" ? "var(--accent-cyan)" : "var(--ink-0)",
              }}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}>
              {opt.type === "entry" ? (
                <>
                  {(opt.entry.number ?? opt.entry.driver_number) != null && (
                    <span className="badge" style={{ marginRight: 6 }}>#{opt.entry.number ?? opt.entry.driver_number}</span>
                  )}
                  {opt.entry.name ?? opt.entry.driver_name}
                </>
              ) : (
                <>＋ Create new driver: &ldquo;{query.trim()}&rdquo;</>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// The driver cell: a searchable dropdown while empty, or the locked-in driver
// with a clear button once filled.
function DriverCell({ row, dragging, available, onAssign, onClear, onRequestCreate }) {
  if (!row.entry_id) {
    return <DriverCombobox available={available} onAssign={onAssign} onRequestCreate={onRequestCreate} />;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap", opacity: dragging ? 0.35 : 1 }}>
      {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
      <span>{row.driver_name}</span>
      <button type="button" title="Clear this position (keeps the driver on the roster)"
        onClick={onClear} className="btn btn-ghost"
        style={{ marginTop: 0, padding: "0 6px", fontSize: "0.85rem", color: "var(--ink-2)", lineHeight: 1.4 }}>
        ✕
      </button>
    </div>
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

// Rightmost row action: drops an empty slot, or removes a placed driver from
// the season entirely (destructive — clearing a mis-pick is the ✕ inside the
// driver cell instead).
function RemoveButton({ row, onRemove }) {
  const title = row.entry_id ? `Remove ${row.driver_name} from the season` : "Remove this finishing position";
  return (
    <button type="button" className="btn btn-danger" title={title}
      style={{ marginTop: 0, padding: "2px 8px", fontSize: "0.8rem" }} onClick={onRemove}>
      ✕
    </button>
  );
}

function RowInputs({ row, idx, updateRow, updateRaceTime, updateInterval, updateStatus, autoFocus, points, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate }) {
  const hasDriver = !!row.entry_id;
  const isLeader = Number(row.finish_pos) === 1;
  const num = (field, min = 0, focus = false) => (
    <input type="number" min={min} value={row[field]} disabled={!hasDriver}
      onChange={e => updateRow(idx, field, e.target.value)} autoFocus={focus} />
  );
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <input type="number" min="1" title="Starting position (defaults from Qualifying)" placeholder="—" disabled={!hasDriver}
        value={row.start_pos} onChange={e => updateRow(idx, "start_pos", e.target.value)} />
      <DriverCell row={row} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} />
      <input placeholder={isLeader ? "1:23.456" : "1:24.567"} value={row.race_time} disabled={!hasDriver} onChange={e => updateRaceTime(idx, e.target.value)} />
      <input placeholder={isLeader ? "leader" : "+2.345 / 1L"} value={isLeader ? "" : row.interval} disabled={!hasDriver || isLeader}
        onChange={e => updateInterval(idx, e.target.value)} />
      {num("laps")}
      {num("laps_led")}
      {num("incidents")}
      <Check title="Fastest lap" value={row.fastest_lap} disabled={!hasDriver} onChange={v => updateRow(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} disabled={!hasDriver} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger" value={row.hard_charger} disabled={!hasDriver} onChange={v => updateRow(idx, "hard_charger", v)} />
      <Check title="Provisional" value={row.provisional} disabled={!hasDriver} onChange={v => updateRow(idx, "provisional", v)} />
      <select value={row.status} disabled={!hasDriver} onChange={e => updateStatus(idx, e.target.value)}>
        <option value="finished">Running</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
      <RemoveButton row={row} onRemove={onRemove} />
    </>
  );
}

function QualRow({ row, idx, updateRow, autoFocus, points, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate }) {
  const hasDriver = !!row.entry_id;
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <DriverCell row={row} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} />
      <input placeholder="01:43.863" value={row.qual_time} disabled={!hasDriver} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
      <RemoveButton row={row} onRemove={onRemove} />
    </>
  );
}
