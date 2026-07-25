"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { PointsEditorModal } from "@/components/PointsEditorModal";
import { ImportResultsModal } from "@/components/ImportResultsModal";
import { NONE_TEMPLATE } from "@/lib/pointsTemplates";
import { classGroups, entriesEligibleForRace, sortClasses } from "@/lib/classFilter";
import { pointsFor, configForTemplate, resolveSeasonConfig, defaultSessionFlags } from "@/lib/standings";
import { parseTime, formatTime, formatGap, parseLapsDown, deriveLaps } from "@/lib/raceTime";

const RESULT_FIELDS = ["finish_pos", "start_pos", "qual_time", "race_time", "interval", "fastest_lap_time", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "provisional", "points_adjustment", "manual_points", "status", "class_id"];
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
    fastest_lap_time: "",
    laps: "",
    laps_led: "0",
    incidents: "0",
    fastest_lap: false,
    halfway_leader: false,
    hard_charger: false,
    provisional: false,
    points_adjustment: "0",
    manual_points: "",
    status: "finished",
    // Which class this driver ran in. Seeded from their roster entry when a
    // driver is assigned, and saved onto the result so the class championships
    // stay historically correct if they're re-classed later.
    class_id: "",
  };
}

// A clean slate of numbered, driverless finishing positions.
function emptySlots(n) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => makeRow(i + 1));
}

// A provisional entry: a driver awarded a flat, custom points value without
// having raced (so they never take a finishing position or count toward stats).
let PROV_SEQ = 0;
function makeProvRow(src = {}) {
  PROV_SEQ += 1;
  return {
    slot_id: `prov-${PROV_SEQ}`,
    entry_id: src.entry_id ?? null,
    driver_name: src.driver_name ?? "",
    driver_number: src.driver_number ?? null,
    manual_points: src.manual_points != null ? String(src.manual_points) : "",
  };
}

// Attaches a driver (roster entry) to a slot, pre-filling laps to the full
// race distance so lead-lap finishers don't need manual entry.
function assignEntry(row, entry, totalLaps) {
  const out = {
    ...row,
    entry_id: entry.id ?? entry.entry_id,
    driver_name: entry.name ?? entry.driver_name ?? "",
    driver_number: entry.number ?? entry.driver_number ?? null,
    class_id: entry.class_id ?? row.class_id ?? "",
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
//
// `groups` are the class sections the grid is split into, in running order (see
// sectionsFor). Each class is a race of its own: rows are grouped by class,
// positions run 1..N WITHIN each class, and the padding is sized to that class's
// share of the roster. A season with no classes has exactly one group holding
// the whole field, which is the pre-classes behaviour unchanged.
function buildRows(entries, existing, totalLaps, qualPos = {}, sessionType = "race", groups = [{ id: "" }]) {
  const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
  const filled = existing
    .filter(r => entryById.has(r.entry_id))
    .map(r => {
      const row = assignEntry(makeRow(r.finish_pos), entryById.get(r.entry_id), totalLaps);
      if (sessionType !== "qualifying" && qualPos[row.entry_id] != null) row.start_pos = String(qualPos[row.entry_id]);
      for (const f of RESULT_FIELDS) {
        if (r[f] == null) continue;
        // A saved result's class wins — that's the class the driver actually
        // raced in — but a BLANK one falls through to the class assignEntry
        // seeded from their roster entry, so results saved before the season had
        // classes pick up the driver's class instead of showing unclassified.
        // Mirrors classOfResult() on the server.
        if (f === "class_id" && r[f] === "") continue;
        row[f] = BOOL_FIELDS.has(f) ? !!r[f] : String(r[f]);
      }
      return row;
    });

  const groupIds = new Set(groups.map(g => g.id));
  // Anything whose class no longer matches a section (a deleted class, a driver
  // moved out of the event's class) lands in the last section rather than
  // disappearing from the grid.
  const bucketOf = classId => (groupIds.has(classId || "") ? (classId || "") : groups[groups.length - 1].id);

  const rows = [];
  for (const group of groups) {
    const mine = sortByFinish(filled.filter(r => bucketOf(r.class_id) === group.id));
    // Empty slots are stamped with their section's class so a driver dropped
    // into one is recorded in the right class without touching the dropdown.
    const rosterCount = entries.filter(e => bucketOf(e.class_id) === group.id).length;
    let pos = mine.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
    const target = Math.max(rosterCount, mine.length);
    const padded = [...mine];
    while (padded.length < target) { pos += 1; padded.push({ ...makeRow(pos), class_id: group.id }); }
    rows.push(...padded);
  }
  return rows;
}

// The class sections a session's grid splits into, in the admin's class order.
// An event pinned to one class shows only that class (plus any class already
// present in its saved results, so nothing is hidden); a shared event shows every
// class the season runs. The trailing "Unclassified" section appears only when
// something actually sits outside the classes — a driver not yet assigned one, or
// a result saved before the season had classes — so a fully classified season
// never shows an empty extra table.
function sectionsFor(classes, race, entries, rows) {
  if (!classes.length) return [{ id: "", name: "", is_default: true }];
  // Only classes already present in the SAVED ROWS widen a pinned event — the
  // roster spans every class, so keying off it would put an LMP2 table on a
  // GT3-only round. This is the "nothing vanishes" guarantee: a result recorded
  // in another class still gets a table to sit in.
  const present = new Set(rows.map(r => r.class_id).filter(Boolean));
  const pinned = race?.class_id || null;
  const active = sortClasses(classes.filter(c => !pinned || c.id === pinned || present.has(c.id)));
  if (!active.length) return [{ id: "", name: "", is_default: true }];
  const activeIds = new Set(active.map(c => c.id));
  // The trailing section is for drivers with NO class — an unclassified driver
  // can enter any event. A driver whose class simply isn't running this round
  // isn't unclassified, so they don't conjure one.
  const hasUnclassified =
    rows.some(r => r.entry_id && !activeIds.has(r.class_id || "")) ||
    entries.some(e => !e.class_id);
  return classGroups(active, hasUnclassified);
}

// Renumber finishing positions 1..N inside each class section, preserving the
// order rows already sit in. Every reorder/removal goes through here, so a class
// always reads 1, 2, 3… of its own — not of the combined field.
function renumberByClass(rows, groups) {
  const groupIds = new Set(groups.map(g => g.id));
  const bucketOf = classId => (groupIds.has(classId || "") ? (classId || "") : groups[groups.length - 1].id);
  const counters = {};
  return rows.map(r => {
    const key = bucketOf(r.class_id);
    counters[key] = (counters[key] || 0) + 1;
    return { ...r, finish_pos: String(counters[key]) };
  });
}

// Sort a flat row list into section order so each class's rows stay contiguous —
// the invariant every index-based operation (drag, paste, renumber) relies on.
function orderByClass(rows, groups) {
  const rank = new Map(groups.map((g, i) => [g.id, i]));
  const last = groups.length - 1;
  const rankOf = r => rank.get(r.class_id || "") ?? last;
  return [...rows]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rankOf(a.row) - rankOf(b.row) || a.i - b.i)
    .map(x => x.row);
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
  initialSession, onEntriesChanged, seriesName, classes = [],
}) {
  const names = sessionNames.length ? sessionNames : [LABELS[sessionType] || "Session"];
  const namesKey = names.join("|");
  const [session, setSession] = useState(
    initialSession && names.includes(initialSession) ? initialSession : names[0]
  );
  const [rows, setRows] = useState(() => emptySlots(entries.length));
  const [provRows, setProvRows] = useState([]); // provisional entries (points only, no stats)
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

  // The class sections this session's grid is split into, in the order the admin
  // arranged the classes. One entry with a blank id means "no classes" — a
  // single, whole-field grid, exactly as before classes existed — so every
  // operation below is written once and works for both cases.
  const groups = useMemo(() => sectionsFor(classes, race, entries, rows), [classes, race, entries, rows]);
  const classMode = groups.length > 1 || !!groups[0].name;

  // Which section a row belongs to. A row whose class matches no section (its
  // class was deleted mid-season) falls into the last one rather than being
  // dropped — this is the single rule that keeps rendering, validation and the
  // save payload agreeing on where every row lives, so nothing can be shown in
  // one place and silently omitted from another.
  const sectionOf = row => {
    const id = row.class_id || "";
    return groups.some(g => g.id === id) ? id : groups[groups.length - 1].id;
  };

  // Re-sort a mutated row list back into class-section order and renumber each
  // section 1..N. Sections are recomputed from the new rows, so a move that
  // creates (or empties) the Unclassified section lands in the right place in
  // the same pass. A season with no classes falls through unchanged.
  const resection = next => {
    const g = sectionsFor(classes, race, entries, next);
    return renumberByClass(orderByClass(next, g), g);
  };

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
      // Provisional results live in their own section — keep them out of the
      // finishing-order grid.
      const mains = existing.filter(r => !r.provisional);
      const provs = existing.filter(r => r.provisional);
      setRows(buildRows(entries, mains, race.total_laps, qp, sessionType, sectionsFor(classes, race, entries, mains)));
      const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
      setProvRows(provs.map(r => {
        const e = entryById.get(r.entry_id);
        return makeProvRow({ entry_id: r.entry_id, driver_name: e?.name ?? "", driver_number: e?.number ?? null, manual_points: r.manual_points });
      }));
    } catch {
      setQualPos({});
      setRows(buildRows(entries, [], race.total_laps, {}, sessionType, sectionsFor(classes, race, entries, [])));
      setProvRows([]);
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
    // Re-classing a driver moves their row into that class's section and
    // renumbers both sections, so the grid always reflects where the result will
    // actually be scored.
    if (field === "class_id" && classMode) {
      setRows(prev => {
        const moved = { ...prev[idx], class_id: value };
        return resection([...prev.filter((_, i) => i !== idx), moved]); // lands at the back of its new class
      });
      return;
    }
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  // Column paste ("fill-down"): drop a copied column of values into a grid
  // column starting at `startIdx`. The Driver column resolves each pasted name
  // to a roster entry (exact name first, then a contains-match), never reusing a
  // driver already placed; unmatched names are skipped. Every other column just
  // sets the raw value on the rows that have a driver. Only fills existing rows
  // — it never invents new finishing positions.
  function pasteColumn(field, startIdx, values) {
    // A paste fills down within ONE class section — it stops at the section
    // boundary instead of spilling a GT3 column into the LMP2 table below it.
    const limitFor = rows_ => {
      if (!classMode) return rows_.length;
      const cls = rows_[startIdx]?.class_id || "";
      let end = startIdx;
      while (end < rows_.length && (rows_[end].class_id || "") === cls) end += 1;
      return end;
    };
    if (field === "driver") {
      setRows(prev => {
        const norm = s => String(s ?? "").trim().toLowerCase();
        const used = new Set(prev.map(r => r.entry_id).filter(Boolean));
        const next = [...prev];
        const limit = limitFor(next);
        for (let k = 0; k < values.length; k++) {
          const i = startIdx + k;
          if (i >= limit) break;
          const name = norm(values[k]);
          if (!name) continue;                       // blank line — leave the row as-is
          if (next[i].entry_id) used.delete(next[i].entry_id);   // free this row's own driver
          const pick = entries.find(e => !used.has(e.id ?? e.entry_id) && norm(e.name ?? e.driver_name) === name)
            || entries.find(e => !used.has(e.id ?? e.entry_id) && norm(e.name ?? e.driver_name).includes(name));
          if (pick) { used.add(pick.id ?? pick.entry_id); next[i] = withDriver(next[i], pick); }
        }
        return next;
      });
      return;
    }
    setRows(prev => prev.map((r, i) => {
      if (i < startIdx || i >= startIdx + values.length || !r.entry_id) return r;
      return { ...r, [field]: String(values[i - startIdx] ?? "").trim() };
    }));
  }

  const totalLaps = Number(race?.total_laps) || null;

  // Assigns/creates a driver into a specific slot, seeding Start from the
  // driver's Qualifying position for race-type sessions.
  const withDriver = (row, entry) => {
    const out = assignEntry(row, entry, totalLaps);
    // In a class-sectioned grid the SECTION decides the class: the admin put this
    // driver in this table, so the result is recorded in that class even if their
    // roster class says otherwise (running up a class for one round). Without
    // sections, assignEntry's roster seed stands.
    if (classMode) out.class_id = row.class_id || "";
    if (sessionType !== "qualifying" && qualPos[out.entry_id] != null) out.start_pos = String(qualPos[out.entry_id]);
    return out;
  };
  function assignToSlot(slotId, entry) {
    setRows(prev => prev.map(r => (r.slot_id === slotId ? withDriver(r, entry) : r)));
  }
  // Empties a slot (mis-pick fix) — keeps the finishing position AND the class
  // section it sits in, drops the driver so it can be searched again.
  // Non-destructive: the season entry stays.
  function clearSlot(idx) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...makeRow(r.finish_pos), slot_id: r.slot_id, class_id: r.class_id } : r)));
  }
  // Adds a finishing position to the end of one class's section (or of the
  // single grid when the season runs no classes).
  function addSlot(classId = "") {
    setRows(prev => {
      const inClass = prev.filter(r => (r.class_id || "") === (classId || "")).length;
      const row = { ...makeRow(inClass + 1), class_id: classId || "" };
      return classMode ? resection([...prev, row]) : [...prev, row];
    });
  }
  // Drops a finishing position from the grid and renumbers the rest — within its
  // own class, so removing a GT3 row never renumbers the LMP2 section.
  function removeSlot(idx) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return classMode ? resection(next) : next.map((r, i) => ({ ...r, finish_pos: String(i + 1) }));
    });
  }

  const assignedIds = useMemo(() => new Set(rows.map(r => r.entry_id).filter(Boolean)), [rows]);
  const provAssignedIds = useMemo(() => new Set(provRows.map(r => r.entry_id).filter(Boolean)), [provRows]);
  // Drivers this event can draw on. An event pinned to a class offers that
  // class (plus unclassified drivers); a shared event offers the whole roster.
  // Only the PICKER is narrowed — `entries` stays whole everywhere else, so a
  // result already saved for a driver outside the class still loads and renders
  // rather than vanishing from the grid.
  const candidates = useMemo(() => entriesEligibleForRace(entries, race), [entries, race]);
  // Roster drivers not already placed in another slot (plus this slot's own
  // driver, so a filled row can be re-searched without hiding itself).
  const availableFor = row => candidates.filter(e => {
    const id = e.id ?? e.entry_id;
    return id === row.entry_id || !assignedIds.has(id);
  });
  // For a provisional slot: roster drivers not already in the finishing grid or
  // another provisional slot.
  const availableForProv = row => candidates.filter(e => {
    const id = e.id ?? e.entry_id;
    return id === row.entry_id || (!assignedIds.has(id) && !provAssignedIds.has(id));
  });

  function addProvRow() { setProvRows(prev => [...prev, makeProvRow()]); }
  function updateProvRow(slotId, patch) { setProvRows(prev => prev.map(r => (r.slot_id === slotId ? { ...r, ...patch } : r))); }
  function removeProvRow(slotId) { setProvRows(prev => prev.filter(r => r.slot_id !== slotId)); }
  function assignProv(slotId, entry) {
    updateProvRow(slotId, { entry_id: entry.id ?? entry.entry_id, driver_name: entry.name ?? entry.driver_name ?? "", driver_number: entry.number ?? entry.driver_number ?? null });
  }

  // The reference time intervals are measured against. In a multi-class session
  // each class has its own winner, so each class's gaps are read off ITS leader
  // — a GT3 car's "+2.345" is behind the GT3 winner, not the outright one.
  const sameClass = (a, b) => !classMode || (a.class_id || "") === (b.class_id || "");
  const leaderTimeOf = (rs, row) => {
    const L = rs.find(r => Number(r.finish_pos) === 1 && (!row || sameClass(r, row)));
    return L ? parseTime(L.race_time) : null;
  };

  // Editing Race Time: the leader's time is the reference. Typing it on a
  // non-leader derives that row's interval; typing it on the leader re-derives
  // every other row's Race Time from their interval.
  function updateRaceTime(idx, value) {
    setRows(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, race_time: value } : r));
      const edited = next[idx];
      const isLeader = Number(edited.finish_pos) === 1;
      const lt = leaderTimeOf(next, edited);
      if (isLeader) {
        // Only this class's field re-derives off it — the other classes have
        // their own leader and their own gaps.
        return next.map(r => {
          if (Number(r.finish_pos) === 1 || lt == null || !sameClass(r, edited)) return r;
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
        const lt = leaderTimeOf(next, next[idx]);
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
      // Drop them into their OWN class's section — the first empty slot there,
      // else a new position at the back of it.
      const wanted = classMode ? (entry.class_id || "") : null;
      const inSection = (r) => wanted == null || (r.class_id || "") === wanted;
      const idx = prev.findIndex(r => !r.entry_id && inSection(r));
      if (idx >= 0) return prev.map((r, i) => (i === idx ? withDriver(r, entry) : r));
      const count = prev.filter(inSection).length;
      const fresh = withDriver({ ...makeRow(count + 1), class_id: wanted ?? "" }, entry);
      return classMode ? resection([...prev, fresh]) : [...prev, fresh];
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
      const entry = entryById.get(im.entry_id);
      // Seed the slot with the driver's roster class first, so a class-sectioned
      // grid files each imported row under the right class.
      const row = withDriver({ ...makeRow(im.finish_pos), class_id: entry.class_id || "" }, entry);
      // Surface the imported car number when the matched roster entry doesn't
      // already carry one, so "Car Number" / "Car #" from the CSV isn't lost.
      const importedNum = im.car_number != null && String(im.car_number).trim() !== "" ? String(im.car_number).trim() : null;
      return {
        ...row,
        driver_number: row.driver_number ?? importedNum,
        finish_pos: num(im.finish_pos, row.finish_pos),
        start_pos: im.start_pos != null ? String(im.start_pos) : row.start_pos,
        laps: num(im.laps, row.laps),
        laps_led: num(im.laps_led, row.laps_led),
        incidents: num(im.incidents, row.incidents),
        interval: im.interval || row.interval,
        race_time: im.race_time || row.race_time,
        fastest_lap_time: im.fastest_lap_time || row.fastest_lap_time,
        qual_time: im.qual_time || row.qual_time,
        status: im.status || row.status,
        fastest_lap: !!im.fastest_lap,
      };
    });
    const sorted = sortByFinish(placed);
    const covered = new Set(placed.map(r => r.entry_id));
    const uncovered = entries.filter(e => !covered.has(e.id ?? e.entry_id));
    let pos = sorted.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
    const next = [...sorted];
    // One empty slot per roster driver the import didn't cover, carrying that
    // driver's class so it appears in the right section.
    for (const e of uncovered) { pos += 1; next.push({ ...makeRow(pos), class_id: e.class_id || "" }); }
    // Exports classify the whole field together, so an imported order is an
    // OVERALL one. Re-splitting it by class turns it into each class's own 1..N
    // — which is also a no-op when the export already listed class positions.
    setRows(classMode ? resection(next) : next);
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
      // Each class runs its own race, so a row can only be reordered inside its
      // own section — dropping it onto another class's row would silently
      // re-class the driver. Use the Class dropdown for that instead.
      if (classMode && (prev[dragIndex]?.class_id || "") !== (prev[idx]?.class_id || "")) return prev;
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      const renumbered = classMode
        ? renumberByClass(next, groups)
        : next.map((r, i) => ({ ...r, finish_pos: String(i + 1) }));
      if (sessionType === "qualifying") return renumbered;
      // Reordering can change who leads; re-derive intervals off the new P1 —
      // each class off its own.
      return renumbered.map(r => {
        if (Number(r.finish_pos) === 1) return { ...r, interval: "" };
        const lt = leaderTimeOf(renumbered, r);
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
    const provReady = provRows.filter(r => r.entry_id);
    if (!filled.length && !provReady.length) return showToast("error", "Assign at least one driver to a finishing position.");
    // Finishing positions are unique WITHIN a class — every class has its own P1
    // — so the clash check runs per class. Without classes that's the whole
    // field, exactly as before.
    for (const group of groups) {
      const inClass = filled.filter(r => !classMode || sectionOf(r) === group.id);
      const positions = inClass.map(r => Number(r.finish_pos));
      if (new Set(positions).size !== positions.length) {
        return showToast("error", classMode
          ? `Two ${group.name} drivers share the same finishing position.`
          : "Two drivers share the same finishing position.");
      }
    }
    const ids = filled.map(r => r.entry_id);
    if (new Set(ids).size !== ids.length) {
      return showToast("error", "A driver is entered in more than one position.");
    }
    const provIds = provReady.map(r => r.entry_id);
    if (new Set(provIds).size !== provIds.length) {
      return showToast("error", "A driver is listed twice in provisional entries.");
    }
    const filledIds = new Set(ids);
    if (provIds.some(id => filledIds.has(id))) {
      return showToast("error", "A provisional driver is also in the finishing order — remove one.");
    }

    // Provisionals are parked behind the field so they never collide with real
    // finishing positions; they carry only their flat manual points. Their class
    // comes from the driver's roster entry — they never raced, so there's no
    // section that placed them.
    const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
    const maxPosIn = classId => filled.reduce(
      (m, r) => ((!classMode || sectionOf(r) === (classId || "")) ? Math.max(m, Number(r.finish_pos) || 0) : m), 0);
    const provSeq = {};
    const provPayload = provReady.map(r => {
      const cls = classMode ? (entryById.get(r.entry_id)?.class_id || "") : "";
      provSeq[cls] = (provSeq[cls] || 0) + 1;
      return {
        entry_id: r.entry_id,
        class_id: cls,
        finish_pos: maxPosIn(cls) + provSeq[cls],
        provisional: true,
        manual_points: r.manual_points === "" ? 0 : Number(r.manual_points),
        laps: 0, laps_led: 0, incidents: 0, status: "finished",
      };
    });

    const payload = [...filled, ...provPayload];
    setBusy(true);
    try {
      await api("/api/results", {
        method: "POST",
        body: {
          race_id: race.id, season_id: seasonId, session, session_type: sessionType,
          points_template_id: templateId || null,
          // Every row carries the class it was entered under. In a sectioned
          // grid they're ALSO grouped by class, so the server records each split
          // from the group it was submitted in rather than inferring it — an
          // admin's explicit placement (a driver running up a class for one
          // round) survives the round trip.
          rows: payload,
          // sectionOf, not a bare class match, so a row whose class was deleted
          // mid-season still lands in a group and is saved rather than silently
          // dropped from the payload.
          ...(classMode ? {
            classes: groups.map(g => ({
              class_id: g.id,
              rows: payload.filter(r => sectionOf(r) === g.id),
            })),
          } : {}),
        },
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
  // The Class column only exists for a season that runs classes; a single-class
  // season keeps the grid exactly as it was.
  const hasClasses = classes.length > 0;

  const rowCommon = (row, idx) => ({
    available: availableFor(row),
    onAssign: entry => assignToSlot(row.slot_id, entry),
    onClear: () => clearSlot(idx),
    onRequestCreate: name => setCreateFor({ slotId: row.slot_id, name }),
    onRemove: () => (row.entry_id ? removeEntry(row) : removeSlot(idx)),
    onPasteColumn: pasteColumn,
  });

  // Each section's rows, carrying their index into the flat `rows` array — every
  // edit, drag and paste addresses rows by that index, so splitting the grid for
  // display doesn't change how anything is written.
  //
  // A row whose class matches no section renders in the last one (see
  // sectionOf) rather than vanishing from the grid.
  const rowsInSection = group => rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !classMode || sectionOf(row) === group.id);

  // One grid per class. Positions inside a section run 1..N for that class, so
  // each class is entered exactly as its own race — which is what it is.
  const renderSection = group => {
    const sectionRows = rowsInSection(group);
    const placed = sectionRows.filter(({ row }) => row.entry_id).length;
    return (
      <div key={group.id || "__all"} style={classMode ? { marginBottom: 26 } : undefined}>
        {classMode && (
          <div className="section-header" style={{ marginTop: 0, marginBottom: 6 }}>
            <h3 style={{ fontSize: "1rem", color: group.color || undefined }}>
              {group.name}
              <span style={{ marginLeft: 8, fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-2)" }}>
                {placed} of {sectionRows.length} position{sectionRows.length === 1 ? "" : "s"} filled
              </span>
            </h3>
          </div>
        )}
        {group.is_default && classMode && (
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>
            Drivers with no class set. They still score in the season&rsquo;s combined standings, but toward no
            class championship — set a class on the Roster (or in the Class column) to fold them into one.
          </p>
        )}
        {sessionType === "qualifying" ? (
          <div className={`qual-grid${hasClasses ? " has-class" : ""}`}>
            {["", "Pos", "Driver", ...(hasClasses ? ["Class"] : []), "Qual Time", pointsLabel, ""].map((h, i) => <span className="grid-header" key={h || i}>{h}</span>)}
            {sectionRows.map(({ row, idx }) => (
              <QualRow key={row.slot_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                classes={classes} hasClasses={hasClasses}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd}
                {...rowCommon(row, idx)} />
            ))}
          </div>
        ) : (
          <div className={`result-grid result-grid-wide${hasClasses ? " has-class" : ""}`}>
            {["", "Fin", "Start", "Driver", ...(hasClasses ? ["Class"] : []), "Race Time", "Int", "Best Lap", "Laps", "Led", "Inc", "FL", "½", "HC", "Adj", "Status", pointsLabel, ""].map((h, i) => (
              <span className="grid-header" key={h || i}>{h}</span>
            ))}
            {sectionRows.map(({ row, idx }) => (
              <RowInputs key={row.slot_id} row={row} idx={idx} updateRow={updateRow}
                updateRaceTime={updateRaceTime} updateInterval={updateInterval} updateStatus={updateStatus}
                autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                classes={classes} hasClasses={hasClasses}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd}
                {...rowCommon(row, idx)} />
            ))}
          </div>
        )}
        <button className="btn btn-ghost" type="button" onClick={() => addSlot(group.id)} style={{ marginTop: 10 }}>
          ＋ Add finishing position{classMode ? ` to ${group.name}` : ""}
        </button>
      </div>
    );
  };

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
        <button className="btn btn-ghost" type="button"
          title={entries.length
            ? "Import results from a CSV export or pasted table"
            : "Import results from a CSV export or pasted table — you can create drivers inline as you resolve each row"}
          style={{ marginTop: 0, whiteSpace: "nowrap" }} onClick={() => setImportOpen(true)} disabled={!entries.length && !seasonId}>
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
      <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
        ⌨ Press <strong>Enter</strong> in any cell to jump to the same column one row down. Or <strong>paste a whole column</strong> at once — copy a column of names or times (e.g. from a spreadsheet) and paste into the top cell to fill straight down.
      </p>

      {classMode && (
        <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
          This season runs classes, so results are entered <strong>one table per class</strong>, in the order the
          classes are ranked. Each class is scored as its own race — positions start at 1 in every table, and its
          winner is that class&rsquo;s winner. Every result is still tagged with its class, so it feeds the class
          championship <em>and</em> cascades into the season, series, game and all-time totals.
        </p>
      )}

      {!entries.length ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet — add one below to start entering results.</p>
      ) : loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>
            {sessionType === "qualifying"
              ? "Drag ⠿ to reorder."
              : "Drag ⠿ to reorder — finishing positions renumber automatically."}
            {classMode && " Rows reorder within their own class; use the Class column to move a driver between classes."}
          </p>
          {groups.map(renderSection)}
        </div>
      )}

      {sessionType !== "qualifying" && !loading && (
        <div style={{ marginTop: 22, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <h4 style={{ margin: "0 0 4px" }}>Provisional Entries</h4>
          <p style={{ margin: "0 0 10px", color: "var(--ink-1)", fontSize: "0.82rem" }}>
            Drivers who didn&rsquo;t make the race but are still awarded points. Each earns the flat points you enter here and does <strong>not</strong> count toward stats (starts, wins, average finish…).
          </p>
          {provRows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {provRows.map(row => (
                <div key={row.slot_id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                    {row.entry_id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem" }}>
                        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
                        <span>{row.driver_name}</span>
                        <button type="button" title="Change driver" className="btn btn-ghost"
                          style={{ marginTop: 0, padding: "0 6px", color: "var(--ink-2)", lineHeight: 1.4 }}
                          onClick={() => updateProvRow(row.slot_id, { entry_id: null, driver_name: "", driver_number: null })}>✕</button>
                      </div>
                    ) : (
                      <DriverCombobox available={availableForProv(row)} onAssign={e => assignProv(row.slot_id, e)}
                        onRequestCreate={name => setCreateFor({ slotId: row.slot_id, name, prov: true })} />
                    )}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--ink-1)", margin: 0 }}>
                    Points
                    <input type="number" value={row.manual_points} placeholder="0" style={{ width: 90 }}
                      onChange={e => updateProvRow(row.slot_id, { manual_points: e.target.value })} />
                  </label>
                  <button type="button" className="btn btn-danger" style={{ marginTop: 0, padding: "2px 10px", fontSize: "0.8rem" }}
                    onClick={() => removeProvRow(row.slot_id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-ghost" type="button" onClick={addProvRow} disabled={!entries.length} style={{ marginTop: 0 }}>
            ＋ Add provisional entry
          </button>
        </div>
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
          onCreated={entry => {
            if (createFor.prov) assignProv(createFor.slotId, entry);
            else assignToSlot(createFor.slotId, entry);
            setCreateFor(null); onEntriesChanged?.();
          }}
        />
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading || !entries.length} style={{ marginTop: 16 }}>
        {busy ? "Saving…" : `Save ${LABELS[sessionType] || "Results"}`}
      </button>
      {!!entries.length && (
        <button className="btn btn-ghost" style={{ marginLeft: 8 }}
          title="Clear every slot back to an empty finishing grid"
          onClick={() => setRows(buildRows(entries, [], race?.total_laps, {}, sessionType, sectionsFor(classes, race, entries, [])))}>
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
// Enter-to-advance: focus the same column's input one row down, so an admin can
// type a value, hit Enter, and drop straight into the row below (names, then
// times) without reaching for the mouse. Skips disabled cells (e.g. an empty
// row's time field) and only ever moves downward. `field` matches the
// data-grid-field tag on each navigable input; `idx` is the source row.
function focusNextGridInput(grid, field, idx) {
  if (!grid) return;
  const next = Array.from(grid.querySelectorAll(`[data-grid-field="${field}"]`))
    .map(el => ({ el, i: Number(el.getAttribute("data-grid-idx")) }))
    .filter(c => Number.isFinite(c.i) && c.i > idx && !c.el.disabled)
    .sort((a, b) => a.i - b.i)[0]?.el;
  if (next) { next.focus(); if (typeof next.select === "function") next.select(); }
}

// Shared Enter handler for every navigable grid cell: reads the column/row off
// the element's own data-grid tags and drops focus into the same column one row
// down. Wired onto each input so names, times, laps, etc. all advance the same
// way.
function gridEnterAdvance(e) {
  if (e.key !== "Enter") return;
  const el = e.currentTarget;
  const field = el.getAttribute("data-grid-field");
  const idx = Number(el.getAttribute("data-grid-idx"));
  if (!field || !Number.isFinite(idx)) return;
  e.preventDefault();
  focusNextGridInput(el.closest(".result-grid, .qual-grid"), field, idx);
}

// Split a clipboard payload into a column of values. A spreadsheet column copy
// arrives as newline-separated cells (often with a trailing newline); tabs are
// treated as newlines too so a single-column selection copied "sideways" still
// fills down. Returns >1 entry only for a genuine multi-row paste.
function parseColumnClipboard(text) {
  if (!text) return [];
  const parts = text.replace(/\r\n?/g, "\n").split(/[\n\t]/);
  while (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// Paste handler for a grid cell: a multi-value clipboard fills the column
// downward from this row (via onPasteColumn); a single value pastes normally.
function handleColumnPaste(e, field, idx, onPasteColumn) {
  if (!onPasteColumn) return;
  const values = parseColumnClipboard(e.clipboardData?.getData("text") ?? "");
  if (values.length <= 1) return;   // ordinary single-cell paste — let it through
  e.preventDefault();
  onPasteColumn(field, idx, values);
}

function DriverCombobox({ available, onAssign, onRequestCreate, gridIdx, onPasteColumn }) {
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
    else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      // Advance to the next row's name field only when we actually locked in a
      // driver (not when Enter opens the "create new driver" flow, which pops a
      // modal that should keep focus).
      const grid = gridIdx != null ? e.currentTarget.closest(".result-grid, .qual-grid") : null;
      choose(opt);
      if (opt?.type === "entry" && grid) {
        setTimeout(() => focusNextGridInput(grid, "driver", gridIdx), 0);
      }
    }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input ref={inputRef} value={query} placeholder="Search driver…"
        data-grid-field={gridIdx != null ? "driver" : undefined} data-grid-idx={gridIdx}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); place(); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onPaste={gridIdx != null ? (e => handleColumnPaste(e, "driver", gridIdx, onPasteColumn)) : undefined}
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
function DriverCell({ row, idx, dragging, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  if (!row.entry_id) {
    return <DriverCombobox available={available} onAssign={onAssign} onRequestCreate={onRequestCreate} gridIdx={idx} onPasteColumn={onPasteColumn} />;
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

// The per-row Class picker. Defaults to whatever class the driver is on in the
// roster (seeded by assignEntry); changing it here scopes THIS result to another
// class without touching the roster — useful when a driver runs up a class for
// one round.
function ClassCell({ row, idx, classes, updateRow }) {
  return (
    <select value={row.class_id ?? ""} disabled={!row.entry_id} title="Class this driver ran in"
      onChange={e => updateRow(idx, "class_id", e.target.value)}>
      <option value="">—</option>
      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function RowInputs({ row, idx, updateRow, updateRaceTime, updateInterval, updateStatus, autoFocus, points, classes = [], hasClasses, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  const hasDriver = !!row.entry_id;
  const isLeader = Number(row.finish_pos) === 1;
  // Shared per-cell wiring: column/row tags, Enter-to-next-row, and column
  // paste (fill-down). Spread onto every editable input.
  const gridProps = field => ({
    "data-grid-field": field, "data-grid-idx": idx,
    onKeyDown: gridEnterAdvance,
    onPaste: e => handleColumnPaste(e, field, idx, onPasteColumn),
  });
  const num = (field, min = 0, focus = false) => (
    <input type="number" min={min} value={row[field]} disabled={!hasDriver}
      {...gridProps(field)}
      onChange={e => updateRow(idx, field, e.target.value)} autoFocus={focus} />
  );
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} {...gridProps("finish_pos")} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <input type="number" min="1" title="Starting position (defaults from Qualifying)" placeholder="—" disabled={!hasDriver}
        value={row.start_pos} {...gridProps("start_pos")} onChange={e => updateRow(idx, "start_pos", e.target.value)} />
      <DriverCell row={row} idx={idx} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} onPasteColumn={onPasteColumn} />
      {hasClasses && <ClassCell row={row} idx={idx} classes={classes} updateRow={updateRow} />}
      <input placeholder={isLeader ? "1:23.456" : "1:24.567"} value={row.race_time} disabled={!hasDriver}
        {...gridProps("race_time")} onChange={e => updateRaceTime(idx, e.target.value)} />
      <input placeholder={isLeader ? "leader" : "+2.345 / 1L"} value={isLeader ? "" : row.interval} disabled={!hasDriver || isLeader}
        {...gridProps("interval")} onChange={e => updateInterval(idx, e.target.value)} />
      <input title="Driver's best lap time (e.g. 1:23.456) — the fastest of these across every race here is the track record"
        placeholder="1:23.456" value={row.fastest_lap_time} disabled={!hasDriver}
        {...gridProps("fastest_lap_time")} onChange={e => updateRow(idx, "fastest_lap_time", e.target.value)} />
      {num("laps")}
      {num("laps_led")}
      {num("incidents")}
      <Check title="Fastest lap" value={row.fastest_lap} disabled={!hasDriver} onChange={v => updateRow(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} disabled={!hasDriver} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger" value={row.hard_charger} disabled={!hasDriver} onChange={v => updateRow(idx, "hard_charger", v)} />
      <input type="number" title="Points adjustment — penalty (−) or bonus (+). Applied on top of scored points without changing the finishing position."
        placeholder="0" value={row.points_adjustment} disabled={!hasDriver}
        {...gridProps("points_adjustment")} onChange={e => updateRow(idx, "points_adjustment", e.target.value)} style={{ textAlign: "center" }} />
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

function QualRow({ row, idx, updateRow, autoFocus, points, classes = [], hasClasses, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  const hasDriver = !!row.entry_id;
  const gridProps = field => ({
    "data-grid-field": field, "data-grid-idx": idx,
    onKeyDown: gridEnterAdvance,
    onPaste: e => handleColumnPaste(e, field, idx, onPasteColumn),
  });
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} {...gridProps("finish_pos")} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <DriverCell row={row} idx={idx} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} onPasteColumn={onPasteColumn} />
      {hasClasses && <ClassCell row={row} idx={idx} classes={classes} updateRow={updateRow} />}
      <input placeholder="01:43.863" value={row.qual_time} disabled={!hasDriver}
        {...gridProps("qual_time")} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
      <RemoveButton row={row} onRemove={onRemove} />
    </>
  );
}
