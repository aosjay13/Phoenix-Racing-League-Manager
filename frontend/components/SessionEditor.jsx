"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { PointsEditorModal } from "@/components/PointsEditorModal";
import { ImportResultsModal } from "@/components/ImportResultsModal";
import { NONE_TEMPLATE, isNoPointsTemplate } from "@/lib/pointsTemplates";
import { classIdForScope, classOfResult, entriesEligibleForRace, entriesInSessionClass, isClassScoped, resultInSessionClass } from "@/lib/classFilter";
import { pointsFor, pointsBreakdown, classConfigs, classScoresOwnPoints, configForClass, configForTemplate, inheritedSessionTemplate, resolveSeasonConfig, defaultSessionFlags } from "@/lib/standings";
import { AUTO_FLAG_FIELDS, applyAutoFlags, detectFlagLocks, autoMostLapsLedSlot } from "@/lib/autoFlags";
import { BANGER_BOOL_FIELDS, BANGER_RESULT_FIELDS, BANGER_STATS, bangerRates, blankBangerRow, hasBangerBonuses } from "@/lib/bangerRacing";
import { BRACKET_SIZES, bracketGridError, bracketPositionAt, bracketPositions, bracketRoundFor, bracketRounds, bracketSizeForField, bracketSizeLabel, normalizeBracketSize, ordinal } from "@/lib/bracketRacing";
import { parseTime, formatTime, formatGap, formatDelta, parseDelta, parseLapsDown, deriveLaps } from "@/lib/raceTime";
import { isRoundsRace, isTimedRace, scheduledLaps, scheduledRounds } from "@/lib/raceLength";

// Every field a saved result can restore into a grid row. The banger fields
// (Takedowns, Survival, Most Lethal) are always in the list: they're stored on
// every result, and a row only ever SHOWS them in a Demo Derby / Banger Racing
// series — see lib/bangerRacing.js.
const RESULT_FIELDS = ["finish_pos", "start_pos", "qual_time", "race_time", "interval", "fastest_lap_time", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "most_laps_led", "provisional", "points_adjustment", "manual_points", "status", "class_id", ...BANGER_RESULT_FIELDS];
const BOOL_FIELDS = new Set(["fastest_lap", "halfway_leader", "hard_charger", "most_laps_led", "provisional", ...BANGER_BOOL_FIELDS]);

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
    // Qualifying only, and derived rather than stored: the gap to the leader's
    // time and to the car one position up. Either can be typed instead of the
    // lap time — see syncQualGaps — but only qual_time is ever saved, so the
    // two always come back in step with the times on reload.
    qual_to_lead: "",
    qual_gap: "",
    race_time: "",
    interval: "",
    fastest_lap_time: "",
    laps: "",
    laps_led: "0",
    incidents: "0",
    fastest_lap: false,
    halfway_leader: false,
    hard_charger: false,
    most_laps_led: false,
    provisional: false,
    points_adjustment: "0",
    manual_points: "",
    status: "finished",
    // Which class this driver ran in. Seeded from their roster entry when a
    // driver is assigned, and saved onto the result so the class championships
    // stay historically correct if they're re-classed later.
    class_id: "",
    // Demo Derby / Banger Racing stats (Takedowns, Survival, Most Lethal).
    // Carried on every row — they're stored on every result — but only
    // RENDERED for a banger series. See lib/bangerRacing.js.
    ...blankBangerRow(),
  };
}

// A clean slate of numbered, driverless finishing positions.
//
// `positions` is the Bracket Style Racing layout when this session runs one
// (see lib/bracketRacing.js): the flat list of finishing positions the bracket
// produces — [1, 2, 3, 3, 4, 4, 4, 4] for an 8-driver ladder — which replaces
// the 1..N run and is what puts two drivers on 3rd. Null for every ordinary
// session, where the grid is exactly what it always was.
function emptySlots(n, positions = null) {
  if (positions?.length) return positions.map(p => makeRow(p));
  return Array.from({ length: Math.max(0, n) }, (_, i) => makeRow(i + 1));
}

// How many empty finishing-position rows a fresh sheet opens with. Padding to
// the whole roster's size used to leave a season of 100 signed-up drivers with
// 100 empty rows before anyone typed a thing; this keeps the initial sheet
// short, and "+ Add finishing position" / row removal (addSlot / removeSlot)
// still scale it to whatever field size the session actually needs.
const DEFAULT_ROW_COUNT = 10;

// A provisional entry: a driver awarded a flat, custom points value without
// having raced (so they never take a finishing position or count toward stats).
//
// `auto` means the points box is still following the grid — it fills itself
// with the points for the first finishing position nobody took (see
// autoProvPoints). Typing over it hands the value to the admin for good; a
// saved entry loads with auto off, since its value was already decided.
let PROV_SEQ = 0;
function makeProvRow(src = {}) {
  PROV_SEQ += 1;
  return {
    slot_id: `prov-${PROV_SEQ}`,
    entry_id: src.entry_id ?? null,
    driver_name: src.driver_name ?? "",
    driver_number: src.driver_number ?? null,
    class_id: src.class_id ?? "",
    manual_points: src.manual_points != null ? String(src.manual_points) : "",
    auto: src.auto ?? true,
  };
}

// Attaches a driver (roster entry) to a slot, pre-filling laps to the full
// race distance so lead-lap finishers don't need manual entry.
//
// `pinnedClassId` is the class this grid is declared to be — the class of a
// per-class session, or the "<class> only" round set on Race Info. When there
// is one it IS the driver's class here, ahead of the class their roster entry
// happens to list first: a driver in Pro and Am entered into the Am-only round
// ran in Am, not in whichever class was ticked first on the roster. Without one
// the grid falls back to the driver's primary class, exactly as before.
function assignEntry(row, entry, totalLaps, pinnedClassId = "") {
  const out = {
    ...row,
    entry_id: entry.id ?? entry.entry_id,
    driver_name: entry.name ?? entry.driver_name ?? "",
    driver_number: entry.number ?? entry.driver_number ?? null,
    class_id: pinnedClassId || entry.class_id || row.class_id || "",
  };
  const d = deriveLaps(out, totalLaps);
  if (d != null) out.laps = String(d);
  return out;
}

// Builds the editable grid from any saved results, then pads it with empty,
// numbered finishing slots — up to DEFAULT_ROW_COUNT, or further if the saved
// results already run past it — so manual entry starts as a clean slate the
// admin fills from a searchable dropdown, rather than the whole roster being
// dumped in and reordered. "+ Add finishing position" grows the grid further
// when the field is bigger than that.
//
// Qualifying only feeds the **Start** column of race-type sessions (via
// qualPos), never the Finish order. A saved result's own start_pos wins over
// the qualifying default once entered.
//
// `positions` is the bracket layout when this session runs one. It changes only
// the PADDING: saved results keep the finishing position they were saved with
// (a bracket that was entered as four 4th places comes back as four 4th
// places), and the empty slots below them take the positions the bracket still
// has room for, so a half-filled 8-driver ladder opens on the rounds left to
// enter rather than on 1..N.
//
// `pinnedClassId` is the class this grid is declared to be (see assignEntry):
// a saved result that recorded no class of its own shows that class rather than
// the driver's primary one, so an "<class> only" round opens on the class it is
// actually run in.
function buildRows(entries, existing, totalLaps, qualPos = {}, sessionType = "race", positions = null, pinnedClassId = "") {
  const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
  const filled = existing
    .filter(r => entryById.has(r.entry_id))
    .map(r => {
      const row = assignEntry(makeRow(r.finish_pos), entryById.get(r.entry_id), totalLaps, pinnedClassId);
      if (sessionType !== "qualifying" && qualPos[row.entry_id] != null) row.start_pos = String(qualPos[row.entry_id]);
      for (const f of RESULT_FIELDS) {
        if (r[f] == null) continue;
        // A saved result's class wins — that's the class the driver actually
        // raced in — but a BLANK one falls through to the class assignEntry
        // seeded (the grid's own class, else the driver's roster class), so
        // results saved before the season had classes pick up a class instead of
        // showing unclassified. Mirrors classOfResult() on the server.
        if (f === "class_id" && r[f] === "") continue;
        row[f] = BOOL_FIELDS.has(f) ? !!r[f] : String(r[f]);
      }
      return row;
    });
  // Most Laps Led used to be derived at read time rather than stored, so a
  // result saved before the column existed comes back with nothing set. Seed
  // those from laps led, so the grid opens showing the flag the standings have
  // been scoring all along — and so it isn't mistaken for an admin having
  // deliberately cleared it (see detectFlagLocks).
  if (sessionType !== "qualifying") {
    const savedById = new Map(existing.map(r => [r.entry_id, r]));
    // Seeded with the same rule the live grid derives (one winner, ties to the
    // better finish), so an old result opens on the pick the grid would make
    // itself and stays free to follow later edits.
    const ledSlot = autoMostLapsLedSlot(filled);
    for (const row of filled) {
      if (savedById.get(row.entry_id)?.most_laps_led == null) {
        row.most_laps_led = row.slot_id === ledSlot;
      }
    }
  }
  const sorted = sortByFinish(filled);
  const rows = [...sorted];
  if (positions?.length) {
    // A bracket is a fixed size, so the grid is exactly that many rows —
    // never the roster's length. Each empty row takes the bracket position at
    // its own index, which is the round it belongs to.
    for (let i = rows.length; i < positions.length; i++) rows.push(makeRow(positions[i]));
    return rows;
  }
  let pos = sorted.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
  const target = Math.max(DEFAULT_ROW_COUNT, sorted.length);
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

// ── Qualifying: Qual Time ⇄ To Lead ⇄ Gap ────────────────────────────────
//
// The sheet works from whichever of the three you have. Entering lap times
// fills both gap columns; entering a gap (to the leader, or to the car one
// position up) derives that row's lap time instead, so a sheet that only
// publishes gaps can be typed straight in. Rows are in position order, so
// "one position up" is simply the previous row that has a time.
//
// Only qual_time is persisted — the gaps are recomputed from the times on
// every load, which is what keeps them honest after a reorder or a correction.

// Fill in lap times from the gap columns. A row with no time takes whichever
// gap it has — To Lead first, since it's absolute (no chain of rounding to
// accumulate). `edited` is the gap cell just typed into ({ idx, field }): that
// one row re-derives its time from what was typed even if it already had one,
// which is what makes the columns work in both directions.
// `held` is the qual_time cell currently being typed into (or holding focus):
// that cell's text is never rewritten, even when it doesn't parse yet — a
// half-entered "1:" must not be "restored" from the row's stale gap columns
// mid-keystroke.
function deriveQualTimes(rows, edited = null, held = null) {
  const leaderTime = parseTime(rows.find(r => Number(r.finish_pos) === 1)?.qual_time);
  let prev = null;                       // last row above this one that has a time
  let changed = false;
  const next = rows.map((r, i) => {
    const editedField = edited && edited.idx === i && edited.field !== "qual_time" ? edited.field : null;
    const t = parseTime(r.qual_time);
    if (held && held.idx === i && held.field === "qual_time") { if (t != null) prev = t; return r; }
    if (t != null && !editedField) { prev = t; return r; }
    if (!r.entry_id) return r;
    const toLead = parseDelta(r.qual_to_lead);
    const gap = parseDelta(r.qual_gap);
    const isLeader = Number(r.finish_pos) === 1;
    let derived = null;
    // The cell being typed in wins outright; otherwise To Lead, then Gap.
    if (editedField === "qual_to_lead") derived = !isLeader && leaderTime != null ? leaderTime + toLead : null;
    else if (editedField === "qual_gap") derived = prev != null && gap != null ? prev + gap : null;
    else if (toLead != null && leaderTime != null && !isLeader) derived = leaderTime + toLead;
    else if (gap != null && prev != null) derived = prev + gap;
    if (derived == null || isNaN(derived) || derived < 0) { if (t != null) prev = t; return r; }
    prev = derived;
    const qual_time = formatTime(derived);
    if (qual_time === r.qual_time) return r;
    changed = true;
    return { ...r, qual_time };
  });
  return changed ? next : rows;          // same reference when nothing moved
}

// Recompute both gap columns from the lap times. A row with no time keeps
// whatever was typed into it (that's the input still waiting on a reference
// time); the leader's own gaps are always blank — it *is* the reference.
// `skip` is the cell the admin is typing in right now ({ idx, field }); its
// text is left exactly as typed so a half-entered "+0.3" is never rewritten to
// "+0.300" under the cursor. It normalizes as soon as focus leaves.
function computeQualGaps(rows, skip = null) {
  const leaderTime = parseTime(rows.find(r => Number(r.finish_pos) === 1)?.qual_time);
  let prev = null;
  let changed = false;
  const next = rows.map((r, i) => {
    const t = parseTime(r.qual_time);
    if (t == null) return r;
    const isLeader = Number(r.finish_pos) === 1;
    const held = f => skip && skip.idx === i && skip.field === f;
    const qual_to_lead = held("qual_to_lead") ? (r.qual_to_lead ?? "")
      : isLeader || leaderTime == null ? "" : formatDelta(t - leaderTime);
    const qual_gap = held("qual_gap") ? (r.qual_gap ?? "")
      : isLeader || prev == null ? "" : formatDelta(t - prev);
    prev = t;
    if (qual_to_lead === (r.qual_to_lead ?? "") && qual_gap === (r.qual_gap ?? "")) return r;
    changed = true;
    return { ...r, qual_to_lead, qual_gap };
  });
  return changed ? next : rows;          // same reference when nothing moved
}

// The grid cell that currently has focus, so the sync can leave it alone while
// it's being typed into. Returns null when focus is anywhere else.
function focusedGridCell() {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  const field = el?.dataset?.gridField;
  const idx = el?.dataset?.gridIdx;
  return field && idx != null && idx !== "" ? { field, idx: Number(idx) } : null;
}

// Derive, then recompute — run after any edit to a qualifying grid. `edited`
// is the cell that was just typed into, if any.
function syncQualGaps(rows, edited = null) {
  const active = edited ?? focusedGridCell();
  return computeQualGaps(deriveQualTimes(rows, edited, active), active);
}

// The three columns that feed each other.
const QUAL_TIME_FIELDS = new Set(["qual_time", "qual_to_lead", "qual_gap"]);

// ── Reading a pasted spreadsheet column ────────────────────────────────────
//
// Every column on the grid takes a pasted column (see pasteColumn), and the
// three that aren't plain text boxes need their cells interpreting first:
// checkboxes, the Status dropdown and the Class dropdown. Spreadsheets spell
// these a dozen ways, so the parsers below are deliberately generous — and
// deliberately return null for anything they don't recognise, which leaves that
// row exactly as it was rather than guessing.

// The tick-box columns.
const CHECK_FIELDS = new Set(["fastest_lap", "halfway_leader", "hard_charger", "most_laps_led", ...BANGER_BOOL_FIELDS]);

const CHECK_TRUE = new Set(["1", "true", "t", "yes", "y", "x", "✓", "✔", "on", "fl", "win", "won"]);
const CHECK_FALSE = new Set(["0", "false", "f", "no", "n", "off", "-", "–", "—", "."]);

// "TRUE" / "Y" / "x" / "1" → ticked; "FALSE" / "N" / "0" / "-" → unticked. An
// empty cell reads as unticked: a spreadsheet marks the one driver who got the
// fastest lap and leaves the rest of the column blank, and taking those blanks
// literally is the whole point of pasting the column.
function parseCheckCell(text) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return false;
  if (CHECK_TRUE.has(s)) return true;
  if (CHECK_FALSE.has(s)) return false;
  return null;
}

// The Status column, in the words a results sheet actually uses.
const STATUS_WORDS = {
  running: "finished", finished: "finished", fin: "finished", finish: "finished",
  classified: "finished", ok: "finished", running_: "finished", r: "finished",
  dnf: "dnf", retired: "dnf", ret: "dnf", out: "dnf", "did not finish": "dnf",
  dns: "dns", ns: "dns", "did not start": "dns", "no show": "dns",
  dq: "dq", dsq: "dq", disq: "dq", disqualified: "dq",
};

function parseStatusCell(text) {
  const s = String(text ?? "").trim().toLowerCase();
  return s ? (STATUS_WORDS[s] ?? null) : null;
}

// The Class column, matched against the season's classes by name (then by id,
// for a column exported from this app). Unmatched names are left alone rather
// than blanked — a result with no class scores on the season's points instead
// of the class's, which is not something a typo should be able to cause.
function parseClassCell(text, classes = []) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return null;
  const byName = classes.find(c => String(c.name || "").trim().toLowerCase() === s);
  if (byName) return byName.id;
  const byId = classes.find(c => String(c.id).toLowerCase() === s);
  if (byId) return byId.id;
  const partial = classes.find(c => String(c.name || "").trim().toLowerCase().includes(s));
  return partial ? partial.id : null;
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
// points are looked up from their actual Qualifying result for this
// race, not copied onto every other session, so Average Start and Poles are
// always computed from Qualifying results alone.
//
// `isBangerRacing` says the thing being entered is ITSELF labelled Demo Derby /
// Banger Racing — the class on a split event, or the season/series on a shared
// one (isBangerScope in lib/bangerRacing.js). With it on the grid grows one
// extra column per derby stat (Takedowns, Survival Bonus, Most Lethal Bonus —
// all defined in lib/bangerRacing.js, so adding another needs no change here),
// prints the derby explainer and rate bar above itself, and the points structure
// editor opened from this screen offers a value for each. Off — every ordinary
// session, including one in a season that merely CONTAINS a derby class — the
// grid is exactly what it always was, with no derby text on it.
//
// `isBracketRacing` says the thing being entered is ITSELF flagged as Bracket
// Style Racing — the class on a split event, or the season/series on a shared
// one (isBracketScope in lib/bracketRacing.js). Off — which is every ordinary
// session, including one in a season that merely CONTAINS a bracket class — the
// grid runs a strict 1..N finishing order and refuses to save two drivers in
// the same position, exactly as it always did. With it on, the session IS a
// bracket — the grid takes its finishing positions from the elimination ladder,
// sized by the Bracket Size dropdown above it (4, 8, 16 or 32 drivers; the
// smallest ladder that holds the field until one is chosen). Several rows then
// legitimately share a position — two 3rd places for the semi-final losers,
// four 4ths for the quarter-finals — which is the one thing an ordinary results
// grid refuses to save. See lib/bracketRacing.js.
//
// `sessionClass` scopes the whole editor to ONE class of a split event (see
// lib/classFilter.js): the grid loads and saves only that class's results, the
// driver picker offers only that class's drivers, and finishing positions run
// 1..N within the class — so Pro and Amateur racing the same round each get
// their own pole and their own winner. Left null the editor behaves exactly as
// it did before per-class sessions: one combined grid for the whole field.
export function SessionEditor({
  race, seasonId, entries: allEntries, sessionType, sessionNames,
  season, templates = [], sessionPoints = {}, sessionPointsByClass = {},
  onSessionPointsChange, onTemplatesChanged,
  sessionStats = {}, onSessionStatsChange, sessionPointsEnabled = {}, onSessionPointsEnabledChange,
  canAddSession = false, onAddSession, onRemoveSession, onRenameSession,
  initialSession, onEntriesChanged, seriesName, series = null, classes = [],
  sessionClass = null, sessionClassName = "",
  isBangerRacing = false, derbyTarget = null, onDerbyPointsSave = null,
  isBracketRacing = false, bracketSize = null, onBracketSizeChange = null,
}) {
  const names = sessionNames.length ? sessionNames : [LABELS[sessionType] || "Session"];
  const namesKey = names.join("|");
  // Scoped to one class: every roster read below works off this class's drivers
  // rather than the whole field, so the grid is sized, filled and validated
  // against the class actually being entered.
  // Everything below reads `entries` — narrowed to the scoped class, or the
  // whole roster when the session isn't split.
  const scoped = isClassScoped(sessionClass);
  // The class id a driver created from inside this grid should join. Blank for
  // the Unclassified scope, which is exactly the class such a driver needs.
  const scopeClassId = scoped ? classIdForScope(sessionClass) : "";
  const entries = useMemo(() => entriesInSessionClass(allEntries, sessionClass), [allEntries, sessionClass]);

  // ── The class this grid IS ───────────────────────────────────────────────
  //
  // Set when the event states its own class, from either end:
  //   • a per-class session — this grid is that class's session; or
  //   • a "<class> only" round (races.class_id on Race Info) — the whole event
  //     is on one class's calendar.
  //
  // Both are an explicit statement of whose race this is, made once, so every
  // driver entered here is entered in THAT class: the Class cell fills with it
  // instead of with whatever class a driver's roster entry lists first, and a
  // driver added or created from inside the grid joins it. Blank on a shared
  // event (and on the Unclassified scope, which is unclassified by definition),
  // where each driver's own roster class is still the honest answer.
  //
  // Only a class the season still has counts — a class deleted or renamed out
  // from under the round would otherwise stamp every row with an id nothing
  // resolves.
  const pinnedClassId = useMemo(() => {
    if (scoped) return scopeClassId;
    if (race?.class_id && classes.some(c => c.id === race.class_id)) return race.class_id;
    return "";
  }, [scoped, scopeClassId, race?.class_id, classes]);

  // ── Bracket Style Racing ─────────────────────────────────────────────────
  //
  // The flag IS the format. When the series, season, or class being entered is
  // flagged as Bracket Style Racing, this session is an elimination ladder —
  // always. There is no "Standard racing" opt-out and no extra step: a race
  // with no size stored yet simply takes the smallest ladder that holds its
  // field, so the grid is a bracket from the first keystroke. The dropdown
  // below only chooses HOW BIG the ladder is (saved per race, since a league
  // can run an 8-car bracket one week and a 16 the next).
  //
  // Everything unflagged is untouched: no flag anywhere in scope means
  // `activeBracketSize` is null and the grid runs the ordinary strict 1..N
  // order exactly as it always has.
  //
  // `bracketLayout` is the flat list of finishing positions the ladder
  // produces — the grid's position column, and the thing that puts two drivers
  // on 3rd. Null (and every derived value empty) for an ordinary session.
  const activeBracketSize = useMemo(
    () => (isBracketRacing
      ? (normalizeBracketSize(bracketSize) ?? bracketSizeForField(entries.length))
      : null),
    [isBracketRacing, bracketSize, entries.length]
  );
  // Qualifying is NOT a bracket. In drag racing it's the timed session that
  // seeds the ladder, so its positions run 1..N and stay unique — which is also
  // what keeps Poles and Average Start meaning what they always meant. Only the
  // eliminations (the race-type sessions) take the bracket layout.
  const bracketLayout = useMemo(
    () => (activeBracketSize && sessionType !== "qualifying" ? bracketPositions(activeBracketSize) : null),
    [activeBracketSize, sessionType]
  );
  const bracketRoundList = useMemo(
    () => (bracketLayout ? bracketRounds(activeBracketSize) : []),
    [bracketLayout, activeBracketSize]
  );
  // The position a row at grid index `i` holds — the bracket's, or the plain
  // 1..N every ordinary session has always used. Every renumber below (drag to
  // reorder, remove a slot, add a slot) goes through this, so the two modes
  // can't drift apart.
  const positionAt = i => (bracketLayout ? bracketPositionAt(bracketLayout, i) : i + 1);
  // The layout the grid is currently laid out on, so the relayout effect below
  // can tell "the admin picked a different size" from "the grid was just
  // (re)loaded from the database".
  const appliedBracket = useRef(bracketLayout);

  const [session, setSession] = useState(
    initialSession && names.includes(initialSession) ? initialSession : names[0]
  );
  const [rows, setRows] = useState(() => emptySlots(DEFAULT_ROW_COUNT, bracketLayout));
  // Which of the auto-derived bonus flags (Fastest Lap / Hard Charger / Most
  // Laps Led) the admin has taken over by hand for this session — see
  // lib/autoFlags.js. A locked flag stops following the grid's data.
  const [flagLocks, setFlagLocks] = useState({});
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
  // Demo Derby rates being edited from the bar above the grid, keyed by bonus
  // (e.g. { takedown: "2" }). Null while nothing is being edited.
  const [derbyEdit, setDerbyEdit] = useState(null);
  const [derbySaving, setDerbySaving] = useState(false);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadSession(sess) {
    setSession(sess);
    setLoading(true);
    try {
      const fetched = await api(`/api/results?race_id=${race.id}`);
      // On a split event only this class's results exist for this grid — and
      // its qualifying map is this class's qualifying, so Start columns come
      // from the class's own grid positions rather than the outright order.
      const entryById0 = Object.fromEntries(allEntries.map(e => [e.id ?? e.entry_id, e]));
      const all = fetched.filter(r => resultInSessionClass(r, sessionClass, entryById0));
      const qp = Object.fromEntries(
        all.filter(r => r.session_type === "qualifying").map(r => [r.entry_id, Number(r.finish_pos)])
      );
      setQualPos(qp);
      const existing = all.filter(r => r.session_type === sessionType && (r.session || names[0]) === sess);
      // Provisional results live in their own section — keep them out of the
      // finishing-order grid.
      const mains = existing.filter(r => !r.provisional);
      const provs = existing.filter(r => r.provisional);
      const loaded = buildRows(entries, mains, scheduledLaps(race), qp, sessionType, bracketLayout, pinnedClassId);
      // The gap columns aren't stored — they're recomputed from the saved lap
      // times each time the sheet opens.
      const built = sessionType === "qualifying" ? computeQualGaps(loaded) : loaded;
      // Saved flags that disagree with what the grid would derive were set by
      // hand — keep them, and keep hands off that flag for the rest of the
      // session. Anything that already matches carries on auto-deriving.
      setFlagLocks(sessionType === "qualifying" ? {} : detectFlagLocks(built));
      setRows(built);
      const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
      setProvRows(provs.map(r => {
        const e = entryById.get(r.entry_id);
        return makeProvRow({
          entry_id: r.entry_id, driver_name: e?.name ?? "", driver_number: e?.number ?? null,
          class_id: pinnedClassId || e?.class_id || "", manual_points: r.manual_points, auto: false,
        });
      }));
    } catch {
      setQualPos({});
      setRows(emptySlots(DEFAULT_ROW_COUNT, bracketLayout));
      setFlagLocks({});
      setProvRows([]);
    } finally {
      appliedBracket.current = bracketLayout;
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
  }, [race?.id, sessionType, namesKey, sessionClass]);

  // …with one exception: the editor can mount before the roster has loaded —
  // linking straight to a results tab (the Schedule's ⏱ button) renders it as
  // soon as the race resolves, a tick before the entries land. The grid is
  // built from the roster, so it would come up permanently empty. Rebuild it
  // once the drivers arrive, but only while the grid is still empty — a grid
  // with rows in it is someone's work in progress and is never touched.
  // `loading` is in the deps because the roster can arrive while that first
  // (empty) load is still in flight — the rebuild then happens the moment it
  // finishes, rather than being skipped.
  useEffect(() => {
    if (loading || rows.length || !entries.length) return;
    loadSession(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, loading]);

  // Keep the derived bonus flags in step with the numbers as they're typed:
  // the quickest Best Lap gets FL, the biggest position gain gets HC, and the
  // most laps led gets MLL. Runs on every grid change, and re-runs when a lock
  // is released. applyAutoFlags returns the same array when nothing moves, so
  // this settles immediately rather than looping. Qualifying has none of these
  // columns and is skipped.
  useEffect(() => {
    if (sessionType === "qualifying" || loading) return;
    setRows(prev => applyAutoFlags(prev, flagLocks));
  }, [rows, flagLocks, sessionType, loading]);

  // Qualifying's counterpart: keep Qual Time / To Lead / Gap consistent however
  // the grid changed — a driver assigned or cleared, a row removed, a position
  // renumbered, an import applied. syncQualGaps returns the same array when
  // nothing moves, so this settles on the first pass rather than looping.
  useEffect(() => {
    if (sessionType !== "qualifying" || loading) return;
    setRows(prev => syncQualGaps(prev));
  }, [rows, sessionType, loading]);

  function updateRow(idx, field, value) {
    const qualTimeEdit = sessionType === "qualifying" && QUAL_TIME_FIELDS.has(field);
    setRows(prev => {
      const next = prev.map((r, i) => {
        if (i !== idx) return r;
        const patch = { ...r, [field]: value };
        // Deleting or retyping a lap time clears the gaps derived from it —
        // left in place they'd just re-derive the time that was deleted (or
        // its half-typed replacement) the moment focus moved. They refill
        // themselves as soon as the new time parses.
        if (qualTimeEdit && field === "qual_time" && parseTime(value) == null) {
          patch.qual_to_lead = "";
          patch.qual_gap = "";
        }
        return patch;
      });
      // Qual Time / To Lead / Gap all feed each other — whichever one was
      // typed, re-derive the other two off it.
      return qualTimeEdit ? syncQualGaps(next, { idx, field }) : next;
    });
  }

  // Tidy the qualifying gap columns once focus leaves the cell being typed in:
  // the sync holds the focused cell's raw text, so this is what turns a
  // finished "+0.3" into "+0.300". Deferred a tick so focus has already moved.
  function normalizeQualGaps() {
    setTimeout(() => setRows(prev => syncQualGaps(prev)), 0);
  }

  // Ticking or unticking one of the auto-derived boxes by hand hands that flag
  // to the admin for the rest of the session — the grid won't move it again,
  // even as more times or laps are entered. The other two keep auto-deriving.
  function updateFlag(idx, field, value) {
    setFlagLocks(prev => (prev[field] ? prev : { ...prev, [field]: true }));
    updateRow(idx, field, value);
  }

  // Column paste ("fill-down"): drop a copied column of values into a grid
  // column starting at `startIdx`. EVERY column on the grid takes one — names,
  // times, laps, the tick boxes, Class and Status included — so a results sheet
  // can be moved across a column at a time instead of a cell at a time.
  //
  // Whatever the column, a pasted value goes through the same code path typing
  // it by hand would: a column of race times fills the intervals under it, a
  // column of statuses re-derives lap counts, a column of ticks hands that flag
  // to the admin exactly as clicking one box does. Only existing rows are
  // filled — a paste never invents finishing positions — and rows without a
  // driver are skipped.
  function pasteColumn(field, startIdx, values) {
    // The rows a paste starting here covers, as [rowIndex, pastedText] pairs.
    const spanOf = rows => values
      .map((v, k) => [startIdx + k, v])
      .filter(([i]) => i >= 0 && i < rows.length);

    // The Driver column resolves each pasted name to a roster entry (exact name
    // first, then a contains-match), and no driver is ever placed twice.
    //
    // The rows the paste covers are released FIRST, before a single name is
    // matched. That is what makes pasting a running order over a grid that's
    // already filled work: a straight reorder asks for drivers who are all still
    // on the grid, and freeing each row's own driver only as its turn came round
    // meant every name that belonged to a row further down matched nothing —
    // pasting a reversed order left the grid half-shuffled and half-untouched.
    //
    // A blank line still means "leave this row alone", so those rows keep their
    // driver and that driver stays reserved. A name that matches nobody on the
    // roster clears its row: the driver who was there may well have just been
    // claimed by another row of the same paste, and an empty slot with the
    // picker in it says what happened where a silently stale name would not.
    if (field === "driver") {
      setRows(prev => {
        const norm = s => String(s ?? "").trim().toLowerCase();
        const idOf = e => e.id ?? e.entry_id;
        const span = spanOf(prev);
        const covered = new Map(span.map(([i, v]) => [i, norm(v)]));
        // Reserved: every driver this paste does not touch — the rows outside it,
        // and the rows it leaves alone with a blank line.
        const used = new Set(
          prev.map((r, i) => (r.entry_id && (!covered.has(i) || !covered.get(i)) ? r.entry_id : null)).filter(Boolean)
        );
        const next = [...prev];
        for (const [i, name] of covered) {
          if (!name) continue;
          const pick = entries.find(e => !used.has(idOf(e)) && norm(e.name ?? e.driver_name) === name)
            || entries.find(e => !used.has(idOf(e)) && norm(e.name ?? e.driver_name).includes(name));
          if (pick) { used.add(idOf(pick)); next[i] = withDriver(next[i], pick); }
          else next[i] = { ...makeRow(next[i].finish_pos), slot_id: next[i].slot_id };  // same as the ✕ button
        }
        return next;
      });
      return;
    }

    // The tick boxes. Three of them (plus Most Lethal) are normally derived from
    // the numbers on the grid, so a pasted column hands that flag to the admin
    // for the session exactly as clicking one box does — otherwise the auto
    // derivation would simply undo the paste on the next render.
    if (CHECK_FIELDS.has(field)) {
      if (AUTO_FLAG_FIELDS.includes(field)) {
        setFlagLocks(prev => (prev[field] ? prev : { ...prev, [field]: true }));
      }
      setRows(prev => {
        const next = [...prev];
        for (const [i, text] of spanOf(prev)) {
          if (!next[i].entry_id) continue;
          const on = parseCheckCell(text);
          if (on != null) next[i] = { ...next[i], [field]: on };
        }
        return next;
      });
      return;
    }

    // Class: a column of class NAMES out of a spreadsheet, resolved against the
    // season's classes. A cell that matches nothing leaves the row's class alone.
    if (field === "class_id") {
      setRows(prev => {
        const next = [...prev];
        for (const [i, text] of spanOf(prev)) {
          if (!next[i].entry_id) continue;
          const id = parseClassCell(text, classes);
          if (id != null) next[i] = { ...next[i], class_id: id };
        }
        return next;
      });
      return;
    }

    // Status, Race Time and Interval all derive something else on the row (lap
    // counts, the opposite time column), so each pasted cell is put through the
    // very same applier a typed one goes through, row by row and in order.
    const applier = field === "status" ? applyStatus
      : field === "race_time" ? applyRaceTime
      : field === "interval" ? applyInterval
      : null;
    if (applier) {
      setRows(prev => {
        let out = prev;
        for (const [i, text] of spanOf(prev)) {
          if (!out[i].entry_id) continue;
          const value = String(text ?? "").trim();
          if (field === "status") {
            const status = parseStatusCell(value);
            if (!status) continue;
            out = applyStatus(out, i, status);
          } else {
            out = applier(out, i, value);
          }
        }
        return out;
      });
      return;
    }

    setRows(prev => {
      const next = prev.map((r, i) => {
        if (i < startIdx || i >= startIdx + values.length || !r.entry_id) return r;
        return { ...r, [field]: String(values[i - startIdx] ?? "").trim() };
      });
      // A pasted column of times (or of gaps) fills the other two columns the
      // same way typing them one at a time would — every pasted row counts as
      // edited, so a column of gaps rewrites the times under it.
      //
      // Derivation runs over the whole pasted span BEFORE the gap columns are
      // recomputed, and that order matters: computeQualGaps rewrites the gaps of
      // every row that has a lap time, so re-running the full sync after each
      // row in turn overwrote the pasted gaps still waiting further down — a
      // pasted To Lead column moved only its first row and left the rest at
      // whatever the old times implied. Top to bottom, since a Gap is measured
      // off the row above.
      if (sessionType !== "qualifying" || !QUAL_TIME_FIELDS.has(field)) return next;
      let out = next;
      for (const [i] of spanOf(next)) {
        out = deriveQualTimes(out, { idx: i, field }, { idx: i, field });
      }
      return computeQualGaps(out);
    });
  }

  // Column paste for the Provisional Entries rows below the grid — the same
  // fill-down, over the two columns those rows have. Names resolve against the
  // drivers still available for a provisional slot; Points takes the raw value
  // and counts as a hand-entered one, so it stops auto-filling from the
  // finishing order.
  function pasteProvColumn(field, startIdx, values) {
    setProvRows(prev => {
      const next = [...prev];
      const norm = s => String(s ?? "").trim().toLowerCase();
      const used = new Set(prev.map(r => r.entry_id).filter(Boolean));
      for (let k = 0; k < values.length; k++) {
        const i = startIdx + k;
        if (i >= next.length) break;
        const text = String(values[k] ?? "").trim();
        if (field !== "driver") {
          next[i] = { ...next[i], manual_points: text, auto: false };
          continue;
        }
        if (!text) continue;
        if (next[i].entry_id) used.delete(next[i].entry_id);
        // A driver already in the finishing order can't also be a provisional
        // entry, so the grid's own drivers are off the table here.
        const free = e => {
          const id = e.id ?? e.entry_id;
          return !used.has(id) && !assignedIds.has(id);
        };
        const pick = candidates.find(e => free(e) && norm(e.name ?? e.driver_name) === norm(text))
          || candidates.find(e => free(e) && norm(e.name ?? e.driver_name).includes(norm(text)));
        if (!pick) continue;
        used.add(pick.id ?? pick.entry_id);
        next[i] = {
          ...next[i],
          entry_id: pick.id ?? pick.entry_id,
          driver_name: pick.name ?? pick.driver_name,
          driver_number: pick.number ?? pick.driver_number ?? null,
          class_id: pinnedClassId || pick.class_id || "",
        };
      }
      return next;
    });
  }

  // The scheduled lap count laps-completed is auto-derived from. Null on a
  // timed event — it has no scheduled distance to count down from, so laps are
  // typed in per driver instead of being filled from the total.
  const totalLaps = scheduledLaps(race);

  // The class this grid is running, used to fill a row that hasn't got one of
  // its own. A driver whose ROSTER entry carries no class — one created inline
  // while entering results, or added before the class existed — would otherwise
  // land on a row with no class at all, and a result with no class scores on
  // the SEASON's points rather than the class's. That is how one row in a grid
  // ends up paying a different rate per takedown than every other row.
  //
  // It only ever fills a BLANK Class cell; a row that already names a class
  // keeps it, so this can't rewrite results that are already right.
  //
  // In priority order:
  //   1. the class this grid IS — the per-class session's class, or the
  //      "<class> only" round set on Race Info (see pinnedClassId above). Both
  //      are explicit, so they outrank anything inferred below;
  //   2. the class most of the filled rows are already in;
  //   3. the season's only class, when it has just the one.
  const gridClassId = useMemo(() => {
    if (pinnedClassId) return pinnedClassId;
    if (scoped) return scopeClassId;   // the Unclassified scope: blank, on purpose
    const counts = {};
    for (const r of rows) if (r.entry_id && r.class_id) counts[r.class_id] = (counts[r.class_id] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) return top[0];
    return classes.length === 1 ? classes[0].id : "";
  }, [rows, classes, scoped, scopeClassId, pinnedClassId]);

  // Assigns/creates a driver into a specific slot, seeding Start from the
  // driver's Qualifying position for race-type sessions, and the class from the
  // class this grid IS — else from the driver's roster entry, falling back to
  // the class the rest of the grid is in, so nobody scores under the wrong
  // points structure by omission.
  const withDriver = (row, entry) => {
    const out = assignEntry(row, entry, totalLaps, pinnedClassId);
    if (sessionType !== "qualifying" && qualPos[out.entry_id] != null) out.start_pos = String(qualPos[out.entry_id]);
    if (!out.class_id && gridClassId) out.class_id = gridClassId;
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
  // Put every filled row in one class. A whole event usually belongs to a
  // single class, and stamping the class ONTO the results is what pins them
  // there for good: a result that records its class is never resolved by
  // fallback, so it can't drift into another class's championship when a driver
  // races more than one. Setting it row by row does the same thing — this is
  // just the whole-grid version.
  function setClassForAll(classId) {
    if (!classId) return;
    setRows(prev => prev.map(r => (r.entry_id ? { ...r, class_id: classId } : r)));
  }

  function addSlot() {
    setRows(prev => [...prev, makeRow(positionAt(prev.length))]);
  }
  // Drops a finishing position from the grid and renumbers the rest.
  //
  // This is what the row's ✕ does, ALWAYS — including on a row that has a driver
  // in it. It is grid-local: nothing is written until Save, and Save only ever
  // replaces this race's rows for this session (see POST /api/results), so
  // taking a driver out here takes them out of THIS session and nothing else.
  //
  // It used to branch — an empty row was dropped, but a row WITH a driver called
  // a removeEntry() that deleted the driver's season roster entry and cascaded
  // to every result they had in the whole season, wiping weeks of entered stats
  // from one ✕ on one results row. Removing somebody from a session because they
  // belong in another one is an everyday edit and must never be able to do that.
  // Season-roster removal lives on the Roster screen, which asks how many
  // results would go with them and confirms that specifically (RosterManager's
  // removeEntry, and the ?confirm=results guard in /api/entries/[id]).
  function removeSlot(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, finish_pos: String(positionAt(i)) })));
  }

  // CHANGING the bracket size re-lays the grid onto the new ladder: rows keep
  // their order and their drivers, and each takes the position its index now
  // holds, so an 8 becoming a 16 turns the four 4th places into eight 5ths
  // without anything being re-typed. Rows past the end of a SMALLER bracket are
  // kept when they hold a driver rather than silently binned; they sit on the
  // last position and the Save check below names the round that is over-filled.
  //
  // It deliberately does NOT run on load: a grid that has just been filled from
  // saved results shows the positions those results were actually saved with,
  // whatever they are. Rewriting them here would quietly edit history on screen
  // — an event flagged as a bracket after its results were entered 1..N would
  // look re-shaped without anyone touching it. Those positions are checked on
  // Save instead, where the admin is told which round doesn't fit.
  useEffect(() => {
    if (!bracketLayout || loading) return;
    if (appliedBracket.current === bracketLayout) return;
    appliedBracket.current = bracketLayout;
    setRows(prev => {
      const kept = prev.filter((r, i) => i < bracketLayout.length || r.entry_id);
      const next = kept.map((r, i) => {
        const pos = String(bracketPositionAt(bracketLayout, i));
        return r.finish_pos === pos ? r : { ...r, finish_pos: pos };
      });
      for (let i = next.length; i < bracketLayout.length; i++) next.push(makeRow(bracketLayout[i]));
      const same = next.length === prev.length && next.every((r, i) => r === prev[i]);
      return same ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketLayout, loading]);

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
    updateProvRow(slotId, {
      entry_id: entry.id ?? entry.entry_id,
      driver_name: entry.name ?? entry.driver_name ?? "",
      driver_number: entry.number ?? entry.driver_number ?? null,
      class_id: pinnedClassId || entry.class_id || "",
    });
  }
  // Picking a driver — by Enter, Tab or click — drops focus straight into that
  // row's Points box, so a provisional entry is name → Enter → points without
  // reaching for the mouse. The box only exists after the render that assigns
  // the driver, hence the deferred lookup.
  function focusProvPoints(slotId) {
    setTimeout(() => {
      const el = typeof document !== "undefined" && document.querySelector(`[data-prov-points="${slotId}"]`);
      if (el) { el.focus(); el.select?.(); }
    }, 0);
  }

  const leaderTimeOf = rs => {
    const L = rs.find(r => Number(r.finish_pos) === 1);
    return L ? parseTime(L.race_time) : null;
  };

  // Editing Race Time: the leader's time is the reference. Typing it on a
  // non-leader derives that row's interval; typing it on the leader re-derives
  // every other row's Race Time from their interval.
  //
  // Written as a rows → rows function rather than straight into setRows so a
  // pasted COLUMN of race times gets exactly the same derivation, applied row
  // by row, that typing them one at a time does (see pasteColumn).
  function applyRaceTime(rows, idx, value) {
    const next = rows.map((r, i) => (i === idx ? { ...r, race_time: value } : r));
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
  }

  function updateRaceTime(idx, value) {
    setRows(prev => applyRaceTime(prev, idx, value));
  }

  // Editing Interval: "NL" marks laps-down (and sets laps = total − N); a time
  // gap derives Race Time from the leader's time. Same rows → rows shape as
  // applyRaceTime, and for the same reason.
  function applyInterval(rows, idx, value) {
    const next = rows.map((r, i) => (i === idx ? { ...r, interval: value } : r));
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
  }

  function updateInterval(idx, value) {
    setRows(prev => applyInterval(prev, idx, value));
  }

  // Status change re-derives laps (finished lead-lap → total; DNF/DNS/DQ stays
  // manual so the admin can enter the lap they retired on).
  function applyStatus(rows, idx, value) {
    return rows.map((r, i) => {
      if (i !== idx) return r;
      const patch = { ...r, status: value };
      const d = deriveLaps(patch, totalLaps);
      if (d != null) patch.laps = String(d);
      return patch;
    });
  }

  function updateStatus(idx, value) {
    setRows(prev => applyStatus(prev, idx, value));
  }

  // A driver added from the bottom "Add a driver" bar drops into the first
  // empty finishing slot (or a new one at the back if the field is full).
  function handleDriverAdded(entry) {
    setRows(prev => {
      const idx = prev.findIndex(r => !r.entry_id);
      if (idx >= 0) return prev.map((r, i) => (i === idx ? withDriver(r, entry) : r));
      return [...prev, withDriver(makeRow(positionAt(prev.length)), entry)];
    });
    setJustAddedId(entry.id);
    onEntriesChanged?.();
  }

  // Merge a batch of imported results into the grid, keyed by entry_id. Matched
  // drivers are placed into finishing order from the import; roster drivers the
  // import didn't cover go to the back as empty slots to fill by hand. Nothing
  // is persisted — the admin reviews and hits Save.
  //
  // A row the importer ticked "Prov" skips the grid entirely and joins the
  // Provisional Entries section below it instead: flat points, no finishing
  // position, no stats. Qualifying has no such section, so the tick is ignored
  // there.
  function applyImport(imported) {
    const entryById = new Map(entries.map(e => [e.id ?? e.entry_id, e]));
    const allowProv = sessionType !== "qualifying";
    const byId = new Map();
    const provById = new Map();
    // Last wins on duplicates — including across the two buckets, so the final
    // row for a driver decides whether they're in the field or provisional.
    for (const r of imported) {
      if (!entryById.has(r.entry_id)) continue;
      if (allowProv && r.provisional) { provById.set(r.entry_id, r); byId.delete(r.entry_id); }
      else { byId.set(r.entry_id, r); provById.delete(r.entry_id); }
    }
    const num = (v, fallback) => (v === "" || v == null ? fallback : String(v));
    const placed = [...byId.values()].map(im => {
      const entry = entryById.get(im.entry_id);
      const row = withDriver(makeRow(im.finish_pos), entry);
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
    const next = [...sorted];
    if (bracketLayout) {
      // A bracket is a fixed size, so an import fills the ladder rather than
      // extending it — the relayout effect above then puts every row on the
      // position its index holds.
      for (let i = next.length; i < bracketLayout.length; i++) next.push(makeRow(bracketLayout[i]));
    } else {
      // The import IS the field: a file listing 20 finishers means 20 rows, not
      // 20 plus one blank for every other driver on the season roster — that
      // padding turned a 76-driver season into 76 rows and put Save back below
      // a long scroll. Pad only up to the same DEFAULT_ROW_COUNT floor a fresh
      // sheet opens on, so a short import still has room to type into, and
      // "+ Add finishing position" covers anyone the file missed.
      let pos = sorted.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
      while (next.length < DEFAULT_ROW_COUNT) { pos += 1; next.push(makeRow(pos)); }
    }
    setRows(next);
    // An import that names its own fastest lap (a column the file carried,
    // rather than one derived from lap times) keeps it; otherwise the grid
    // derives FL/HC/MLL from the imported numbers as usual.
    //
    // Fastest Lap is the ONLY one of these flags an import carries a value for.
    // Hard Charger, Most Laps Led and Most Lethal are never in the payload, so
    // every imported row arrives with them false — running the whole-grid lock
    // detector across that made them "disagree" with what the grid derives and
    // locked them OFF, which is why importing a CSV with a Led column never
    // ticked MLL. Lock only the flag the import actually has an opinion on and
    // leave the rest free to derive from the imported numbers.
    const { fastest_lap } = detectFlagLocks(next);
    setFlagLocks({ fastest_lap });

    // Provisional entries are added to whatever is already listed rather than
    // replacing it — an admin who typed a provisional by hand before importing
    // the file keeps it. Two exceptions keep the sheet consistent with the
    // import: a driver already listed provisionally isn't added twice, and one
    // the import just placed in the finishing order drops out of the
    // provisional list (they can't be in both, and Save would refuse).
    if (allowProv) {
      setProvRows(prev => {
        const kept = prev.filter(r => !(r.entry_id && byId.has(r.entry_id)));
        const listed = new Set(kept.map(r => r.entry_id).filter(Boolean));
        const added = [...provById.keys()]
          .filter(id => !listed.has(id))
          .map(id => {
            const e = entryById.get(id);
            // Points are left on auto, so they fill with the first finishing
            // position nobody took — same as a hand-added provisional entry.
            return makeProvRow({
              entry_id: id,
              driver_name: e?.name ?? "",
              driver_number: e?.number ?? null,
              class_id: pinnedClassId || e?.class_id || "",
            });
          });
        return kept.length === prev.length && !added.length ? prev : [...kept, ...added];
      });
    }

    setImportOpen(false);
    const n = byId.size, p = provById.size;
    showToast("success", `Imported ${n} result${n === 1 ? "" : "s"}${p ? ` + ${p} provisional entr${p === 1 ? "y" : "ies"}` : ""}. Review the grid, then Save.`);
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
      const renumbered = next.map((r, i) => ({ ...r, finish_pos: String(positionAt(i)) }));
      // Reordering changes who's on pole and who's one position up, so both
      // qualifying gap columns re-derive off the new order.
      if (sessionType === "qualifying") return syncQualGaps(renumbered);
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

  // ── Points structure ─────────────────────────────────────────────────────
  //
  // Four layers, most specific last: the SERIES' default points, the season's
  // own, the CLASS's structure when it scores on one, and the template assigned
  // to this session — whose place in the chain depends on who it was assigned
  // to (see `layered` below and makeScorer in lib/standings.js):
  //
  //   series → season → event-wide template → class → this class's template
  //
  // Switching class in the bar above swaps the class layer, so the Points
  // column (and the modal below it) re-reads the moment you change class —
  // exactly the way it already re-reads when you change session. The same chain
  // the standings score on, so the Points column here and the championship
  // there can never disagree.
  const seasonConfig = useMemo(() => resolveSeasonConfig(season || {}, series), [season, series]);
  const classBase = useMemo(() => classConfigs(seasonConfig, classes), [seasonConfig, classes]);
  // The base config for a class id: its own structure, else the season's. On a
  // combined grid this is asked per ROW, since a driver's points come from the
  // class they raced in even when every class shares one results table.
  const baseFor = classId => (classId && classBase[classId]) || seasonConfig;
  // The one class whose points structure is this grid's DEFAULT, from any way
  // an event states its class: the per-class scope on a split event, the class
  // the round is pinned to (races.class_id / a per-class session), or the
  // season's only class. Empty only on a genuinely shared multi-class grid,
  // where no single class is the honest default and each row's own class
  // answers instead (configForRow below). This is what makes a class's own
  // points structure the default for its races — not just on split events —
  // instead of the season's.
  const pointsClassId = scoped ? scopeClassId
    : (pinnedClassId || (classes.length === 1 ? classes[0].id : ""));
  const scopeClass = pointsClassId ? classes.find(c => c.id === pointsClassId) : null;
  const classOwnPoints = classScoresOwnPoints(scopeClass);
  // What "no session override" scores under, named for the dropdown.
  const pointsClassName = sessionClassName || scopeClass?.name || "Class";
  const baseLabel = classOwnPoints ? `Class Default — ${pointsClassName} points` : "Season default";
  // Classes of this season that score on structures of their own — the ones an
  // event-wide points template does NOT re-point (see `layered` below).
  const ownPointsClassNames = classes.filter(classScoresOwnPoints).map(c => c.name);
  const baseConfig = baseFor(pointsClassId || "");

  // This session's assigned template. On a split event the assignment is per
  // class — Pro's Race and Amateur's Race can score differently — falling back
  // to an event-wide assignment, then to the class/season structure above.
  const classSessionPoints = scoped ? (sessionPointsByClass[sessionClass] || {}) : {};
  const templateId = (scoped && session in classSessionPoints)
    ? (classSessionPoints[session] || "")
    : (sessionPoints[session] || "");
  const templateFor = id => (id === NONE_TEMPLATE.id ? NONE_TEMPLATE : templates.find(t => t.id === id));
  // The DEFAULT template for this session TYPE — "every heat scores on this",
  // named by the event (Race Info), by one class, or by the season, most
  // specific first. A session with an assignment of its own still overrides it;
  // without one, this is what the Points column below scores on, which is what
  // the standings score on too. `forClass` says the default came from a class,
  // which is what puts it on top of that class's structure rather than under it
  // (see inheritedSessionTemplate in lib/standings.js).
  const inheritedFor = classId => inheritedSessionTemplate({ session_type: sessionType }, {
    race,
    cls: classId ? classes.find(c => c.id === classId) || null : null,
    season,
  });
  const inherited = inheritedFor(pointsClassId || "");
  const typeDefaultId = inherited?.id || "";
  const typeDefault = useMemo(() => templateFor(typeDefaultId), [templates, typeDefaultId]);
  const effectiveTemplateId = templateId || typeDefaultId;
  const template = useMemo(() => templateFor(effectiveTemplateId), [templates, effectiveTemplateId]);
  // Was the template in force picked for THIS class, or for the event/season as a
  // whole? Only a class's own assignment lives in session_points_by_class — and
  // an inherited default answers for itself.
  const templateIsForClass = templateId
    ? (scoped && !!classSessionPoints[session])
    : !!inherited?.forClass;

  // Lay one class's chain up, putting the template at the level it was actually
  // assigned at — the same rule makeScorer scores on:
  //   • assigned to this class (or "No points", which zeroes everybody): it is
  //     the most specific layer, so it goes on TOP of the class's structure;
  //   • assigned to the event: it is the event's default, so it goes UNDER the
  //     class, which overrides it exactly as it overrides the season. Without
  //     that, one template picked for the event flattened every class's own
  //     scale back to the event's.
  const layered = (classId, tpl, forClass) => {
    if (!tpl) return baseFor(classId);
    const cls = classId ? classes.find(c => c.id === classId) : null;
    return (forClass || isNoPointsTemplate(tpl) || !cls)
      ? configForTemplate(baseFor(classId), tpl)
      : configForClass(configForTemplate(seasonConfig, tpl), cls);
  };

  const config = useMemo(
    () => layered(pointsClassId || "", template, templateIsForClass),
    [baseConfig, template, templateIsForClass, pointsClassId, classes, seasonConfig],
  );

  // What this session scores on with NO assignment of its own — the default for
  // its type when the event, the class or the season names one, else the plain
  // class/season structure. It's what the dropdown's first option means and what
  // the points editor shows behind it, so "use the default" always displays the
  // numbers that default actually pays.
  const defaultConfig = useMemo(
    () => (typeDefault ? layered(pointsClassId || "", typeDefault, !!inherited?.forClass) : baseConfig),
    [baseConfig, typeDefault, inherited?.forClass, pointsClassId, classes, seasonConfig],
  );
  // Names the default AND where it was set, so an admin looking at a heat that
  // scores 20 a win can see whether that came from this event, this class or the
  // season — the three places one can be named.
  const defaultLabel = typeDefault
    ? `${LABELS[sessionType] || "Session"} default · ${inherited.level} — ${typeDefault.name}`
    : baseLabel;

  // What this session pays for each derby stat, resolved through the same
  // season → class → session-template chain the Points column scores on.
  //
  // A combined grid has to look at every class as well as the scope itself: the
  // derby rates often live on the ONE banger class of an otherwise ordinary
  // season, so reading the season's structure alone would report "no derby
  // points" over a grid that scores them perfectly well.
  const derbyConfigs = scoped
    ? [config]
    : [config, ...classes.map(c => layered(c.id, template, false))];
  const payingConfigs = derbyConfigs.filter(c => hasBangerBonuses(c.bonuses));
  const derbyPays = payingConfigs.length > 0;
  const derbyRates = bangerRates((payingConfigs[0] || config).bonuses);
  // Several classes paying different rates — say so rather than quoting one
  // class's numbers over the whole field.
  const derbyVaries = new Set(payingConfigs.map(c => JSON.stringify(bangerRates(c.bonuses)))).size > 1;

  // A row's own configs. Scoped grids are all one class; a combined grid scores
  // each row under the class on that row — including that class's own heat /
  // consolation default, which another class on the same grid may not share.
  const configForRow = row => {
    if (scoped) return config;
    const rowClassId = row.class_id || "";
    if (templateId) return layered(rowClassId, template, false);
    const rowInherited = inheritedFor(rowClassId);
    return layered(rowClassId, templateFor(rowInherited?.id), !!rowInherited?.forClass);
  };

  // Assign a points system to this session — for THIS class when the event runs
  // its classes separately, so switching class and picking a template doesn't
  // re-point the class next door.
  const assignSessionPoints = (name, id, type) =>
    onSessionPointsChange(name, id, type, scoped ? sessionClass : null);

  // Per-session eligibility toggles, falling back to the session-type default
  // until an admin explicitly flips a switch. The stats toggle applies to every
  // session type: off on a race session drops it from Wins/Average Finish/…,
  // off on Qualifying drops it from Poles/Average Start — for a grid set purely
  // for visual purposes, which should show on the event page without landing on
  // anyone's record. The championship-points toggle stays race-only, since
  // qualifying never awards championship points on its own.
  const isQual = sessionType === "qualifying";
  // A heat/consolation points default — the event's, the class's or the
  // season's — also flips championship points on for that type by default:
  // naming a template for every heat says heats score. This grid's switch
  // therefore shows the same state the standings use.
  const flagDefaults = defaultSessionFlags(sessionType, { race, cls: scopeClass, season });
  const statsOn = session in sessionStats ? !!sessionStats[session] : flagDefaults.counts_stats;
  const pointsOn = session in sessionPointsEnabled ? !!sessionPointsEnabled[session] : flagDefaults.counts_points;
  const showStatsToggle = !!onSessionStatsChange;
  // Qualifying scores itself now, so it gets the same championship-points switch
  // every other session has: turn it off to run a qualifying session that sets
  // the grid and pays nothing.
  const showPointsToggle = !!onSessionPointsEnabledChange;

  // Points only meaningful once a driver is in the slot. Qualifying and race
  // rows go through the SAME scorer — pointsFor reads the qualifying scale for a
  // qualifying row and the race scale for a race row — so this column is the
  // championship's own arithmetic on every tab, and the numbers on the tabs of
  // one event add up to what that event contributed to the standings.
  const scoreRow = row => ({ ...row, session_type: sessionType });
  const rowPoints = row => (!row.entry_id ? "" : pointsFor(scoreRow(row), configForRow(row)));
  // …and the arithmetic behind it, on hover: every term that made the number,
  // so a total that looks wrong can be read rather than reverse-engineered.
  const rowPointsTitle = row => (!row.entry_id ? undefined
    : pointsBreakdown(scoreRow(row), configForRow(row)));

  // ── Provisional points auto-fill ─────────────────────────────────────────
  //
  // A provisional entry is saved just behind the field (handleSave parks them
  // at maxPos + 1, + 2, …), so the natural value for one is the points of the
  // first finishing position nobody took: a two-car finish means the first
  // provisional is worth P3. Each further provisional steps down one more
  // position, matching the order they're saved in. Filled in for the admin,
  // then editable — typing a value turns the auto-fill off for that row.
  const lastFinishPos = useMemo(
    () => rows.reduce((m, r) => (r.entry_id && r.finish_pos !== "" ? Math.max(m, Number(r.finish_pos) || 0) : m), 0),
    [rows]
  );
  const autoProvPoints = (row, i) => {
    const cfg = scoped ? config : configForTemplate(baseFor(row.class_id || ""), template);
    return Number(cfg.racePoints[lastFinishPos + i + 1] ?? 0);
  };

  useEffect(() => {
    if (sessionType === "qualifying" || loading) return;
    setProvRows(prev => {
      let changed = false;
      const next = prev.map((r, i) => {
        if (!r.auto) return r;
        const value = String(autoProvPoints(r, i));
        if (value === r.manual_points) return r;
        changed = true;
        return { ...r, manual_points: value };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provRows, lastFinishPos, config, template, sessionType, loading, scoped]);

  // Write the derby rates typed above the grid to the structure that scores this
  // session (see derbyPointsTarget) and re-score the Points column with them.
  // The whole point of it living here is that "what a takedown is worth" is set
  // in the same place the takedowns are typed, against the same structure the
  // grid scores on — no hunting through League Setup for the right level.
  async function saveDerbyPoints() {
    if (!onDerbyPointsSave || !derbyEdit) return;
    setDerbySaving(true);
    try {
      await onDerbyPointsSave(Object.fromEntries(
        Object.entries(derbyEdit).map(([k, v]) => [k, Number(v || 0)])
      ));
      setDerbyEdit(null);
      showToast("success", `Derby points saved to ${derbyTarget?.name || "this season"}. The Points column has re-scored.`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setDerbySaving(false);
    }
  }

  async function handleSave() {
    const filled = rows.filter(r => r.entry_id && r.finish_pos !== "");
    const provReady = provRows.filter(r => r.entry_id);
    if (!filled.length && !provReady.length) return showToast("error", "Assign at least one driver to a finishing position.");
    // Sharing a finishing position is an error in a race and the entire point
    // of a bracket: the two semi-final losers finished level because they never
    // raced each other. So the uniqueness rule applies to ordinary sessions
    // only; a bracket is checked against its own ladder instead — every
    // position must be one the bracket actually has, and no round may hold more
    // drivers than it eliminates. See lib/bracketRacing.js.
    if (bracketLayout) {
      const err = bracketGridError(filled, activeBracketSize);
      if (err) return showToast("error", err);
    } else {
      const positions = filled.map(r => Number(r.finish_pos));
      if (new Set(positions).size !== positions.length) {
        return showToast("error", "Two drivers share the same finishing position.");
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
    // finishing positions; they carry only their flat manual points.
    const maxPos = filled.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
    const provPayload = provReady.map((r, i) => ({
      entry_id: r.entry_id,
      finish_pos: maxPos + i + 1,
      provisional: true,
      manual_points: r.manual_points === "" ? 0 : Number(r.manual_points),
      laps: 0, laps_led: 0, incidents: 0, status: "finished",
    }));

    setBusy(true);
    try {
      await api("/api/results", {
        method: "POST",
        body: {
          race_id: race.id, season_id: seasonId, session, session_type: sessionType,
          // Replaces only this class's slice of the session, leaving the other
          // classes that raced the same round untouched.
          ...(scoped ? { session_class: sessionClass } : {}),
          // Only an assignment made FOR THIS SESSION is stamped on the results. A
          // type default is deliberately left off, so it stays a default: change
          // the event's heat template and every heat re-scores at once (see
          // resolveTemplateId in lib/standings.js).
          points_template_id: templateId || null, rows: [...filled, ...provPayload],
        },
      });
      showToast("success", scoped
        ? `${sessionClassName || "Class"} results saved. Standings and profiles update instantly.`
        : "Results saved. Standings and profiles update instantly.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  // Clears this session's saved results from the database and resets the grid
  // — the "delete a portion of the race" action; the session itself stays.
  async function handleDeleteResults() {
    const scopeLabel = scoped ? `${sessionClassName || "this class"}'s ${session}` : session;
    if (!confirm(`Delete all saved ${scopeLabel} results? The session stays — only its results are removed.${scoped ? " Other classes at this event keep theirs." : ""} This cannot be undone.`)) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ race_id: race.id, session, session_type: sessionType });
      if (scoped) qs.set("session_class", sessionClass);
      await api(`/api/results?${qs.toString()}`, { method: "DELETE" });
      showToast("success", `${scopeLabel} results deleted.`);
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
  // season keeps the grid exactly as it was. A grid already scoped to one class
  // doesn't need it either — every row in it is that class by definition.
  const hasClasses = classes.length > 0 && !scoped;
  // One header per banger stat, generated from the stat list — the grid, the
  // row inputs and these headers all read the same definitions, so a new banger
  // bonus appears in all three at once.
  const bangerHeaders = isBangerRacing ? BANGER_STATS.map(s => s.header) : [];
  // Rows with a driver but no class — the ones that would score on the season's
  // structure instead of the class's.
  const unclassedRows = hasClasses ? rows.filter(r => r.entry_id && !r.class_id) : [];
  const gridClassName = classes.find(c => c.id === gridClassId)?.name ?? "";
  // Rows in some class OTHER than the one this round is run in. New rows can't
  // land here — a pinned round fills every Class cell with its own class — so
  // these are either a deliberate choice or results entered before the round was
  // pinned, back when the cell followed the driver's roster class. Either way
  // they're left exactly as they are and simply pointed out, since the fix (one
  // pass of "Class for every row") is a click away and blindly rewriting saved
  // results isn't ours to make.
  const offClassRows = hasClasses && pinnedClassId
    ? rows.filter(r => r.entry_id && r.class_id && r.class_id !== pinnedClassId)
    : [];

  // Fill in a blank Class cell with the class the rest of the grid is in, on
  // rows loaded from already-saved results as well as newly assigned ones. A
  // saved result with no class scores on the season's points instead of the
  // class's — the same race paying one driver a different rate per takedown
  // than the rest — so the grid shows the class it will be saved with rather
  // than leaving the row silently unclassified. It's only applied when the rest
  // of the grid agrees on one class, it's visible in the Class column before
  // anything is written, and it takes effect on Save like any other edit.
  useEffect(() => {
    if (loading || !hasClasses || !gridClassId) return;
    setRows(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (!r.entry_id || r.class_id) return r;
        changed = true;
        return { ...r, class_id: gridClassId };
      });
      return changed ? next : prev;
    });
  }, [rows, hasClasses, gridClassId, loading]);


  const rowCommon = (row, idx) => ({
    available: availableFor(row),
    onAssign: entry => assignToSlot(row.slot_id, entry),
    onClear: () => clearSlot(idx),
    onRequestCreate: name => setCreateFor({ slotId: row.slot_id, name }),
    // Always just drops the row from THIS grid. It used to delete the whole
    // season entry when the row had a driver in it — see removeSlot's note.
    onRemove: () => removeSlot(idx),
    onPasteColumn: pasteColumn,
  });

  return (
    <div>
      {scoped && (
        <div className="class-scope-banner" style={{ marginBottom: 12 }}>
          <span className="class-scope-chip">{sessionClassName || "Class"}</span>
          <span>
            You are entering the <strong>{sessionClassName || "class"}</strong> {LABELS[sessionType]?.toLowerCase() || "session"} for this event.
            Positions here are {sessionClassName || "this class"}&rsquo;s own order — P1 is {sessionClassName || "the class"}&rsquo;s
            {sessionType === "qualifying" ? " pole" : " winner"}. Other classes at this event have their own grid; switch with the Class menu above.
            {classOwnPoints && <> Points below are scored on <strong>{sessionClassName || "this class"}&rsquo;s</strong> own points structure.</>}
          </span>
        </div>
      )}
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
        {/* Bracket Style Racing: this scope is flagged, so the race IS a
            bracket — the only choice here is the ladder size. Saved on the
            RACE, because a league can run an 8-car bracket one week and a 16
            the next. There is deliberately no "Standard racing" option: the
            flag on the series/season/class already said what format this is. */}
        {isBracketRacing && sessionType !== "qualifying" && (
          <div className="field" style={{ maxWidth: 260, margin: 0 }}>
            <label htmlFor="bracket-size">Bracket Size</label>
            <select id="bracket-size" value={activeBracketSize ?? ""}
              disabled={!onBracketSizeChange}
              onChange={e => Promise.resolve(onBracketSizeChange?.(Number(e.target.value)))
                .catch(err => showToast("error", err.message))}>
              {BRACKET_SIZES.map(size => (
                <option key={size} value={size}>{bracketSizeLabel(size)}</option>
              ))}
            </select>
            <span style={{ fontSize: "0.75rem", color: "var(--ink-2)" }}>
              This is a Bracket Style Racing event, so results are entered as an elimination ladder. The grid below is laid out from the size chosen here.
            </span>
          </div>
        )}
        {onSessionPointsChange && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ maxWidth: 280, margin: 0 }}>
              <label>Points system · {scopeClass ? `${pointsClassName} · ` : ""}{session}</label>
              <select value={templateId}
                onChange={e => Promise.resolve(assignSessionPoints(session, e.target.value, sessionType)).catch(err => showToast("error", err.message))}>
                <option value="">{defaultLabel}</option>
                <option value={NONE_TEMPLATE.id}>{NONE_TEMPLATE.name}</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {scopeClass ? (
                <span style={{ fontSize: "0.75rem", color: "var(--ink-2)" }}>
                  {classOwnPoints
                    ? `${pointsClassName} scores on its own points structure by default. A template picked here overrides it for this session.`
                    : scoped ? "Applies to this class's session only." : `This round belongs to ${pointsClassName}, which scores on the season's points structure.`}
                </span>
              ) : ownPointsClassNames.length > 0 && (
                // An event-wide template is the event's default, and a class
                // with its own points structure outranks it (see `layered`).
                // Say so here rather than letting the grid look like it scores
                // everyone on the template.
                <span style={{ fontSize: "0.75rem", color: "var(--ink-2)" }}>
                  Applies to the whole field — except {ownPointsClassNames.join(", ")}, which
                  score{ownPointsClassNames.length === 1 ? "s" : ""} on their own points structure.
                </span>
              )}
            </div>
            <button className="btn btn-ghost" type="button" title="View, edit, or create the points structure for this session"
              style={{ marginTop: 0, whiteSpace: "nowrap" }} onClick={() => setPointsModal(true)}>
              ⚙ Edit Points Structure
            </button>
          </div>
        )}
        {hasClasses && (
          <div className="field" style={{ maxWidth: 260, margin: 0 }}>
            <label>Class for every row</label>
            <select defaultValue="" onChange={e => { setClassForAll(e.target.value); e.target.value = ""; }}>
              <option value="">Set all rows to…</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ fontSize: "0.75rem", color: "var(--ink-2)" }}>
              Stamps the class onto each result, which is what keeps it in that class&rsquo;s
              championship for good. Save after setting it.
            </span>
          </div>
        )}
        {(showStatsToggle || showPointsToggle) && (
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {showStatsToggle && (
              <Toggle label="Count towards Official Stats" checked={statsOn}
                onChange={v => onSessionStatsChange?.(session, v)} />
            )}
            {showPointsToggle && (
              <Toggle label="Award Championship Points" checked={pointsOn}
                onChange={v => onSessionPointsEnabledChange?.(session, v)} />
            )}
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
      {isQual && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
          ⏱ <strong>Qual Time</strong>, <strong>To Lead</strong> and <strong>Gap</strong> fill each other in —
          enter whichever your timing sheet gives you. Type lap times and both gaps appear (To Lead is the
          gap to pole, Gap is to the car one position up); type a gap instead — e.g. <code>+0.312</code> — and
          the lap time is worked out from the pole time (To Lead) or the car above (Gap). Pole sets the
          reference, so its own gaps stay blank. Only the lap times are saved; the gaps are recalculated
          from them, so they stay right after a reorder or a correction.
        </p>
      )}
      {isQual && showStatsToggle && !statsOn && (
        <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.82rem" }}>
          ⚠ <strong>Official Stats are off for {session}.</strong> The grid below still shows on the event page,
          but these positions don&rsquo;t count toward Poles or Average Start — use this for a qualifying session
          run for visual purposes only.
        </p>
      )}
      {!isQual && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
          ✓ <strong>FL</strong>, <strong>HC</strong> and <strong>MLL</strong> tick themselves as you type:
          the quickest <strong>Best Lap</strong> takes Fastest Lap (one lap time entered is the fastest one),
          the biggest gain from <strong>Start</strong> to <strong>Fin</strong> takes Hard Charger (a tie goes to
          whoever finished highest), and the highest <strong>Led</strong> count takes Most Laps Led.
          Tick or untick any of them yourself and that one stops moving — your call sticks.
          These are stats either way; they only affect points if your season or points structure pays a bonus for them.
        </p>
      )}
      {hasClasses && unclassedRows.length > 0 && (
        <p style={{ marginTop: 0, color: "var(--accent-gold, #e2b714)", fontSize: "0.82rem" }}>
          ⚠ <strong>{unclassedRows.length} row{unclassedRows.length === 1 ? " has" : "s have"} no class set</strong>
          {unclassedRows.length <= 4 && <> — {unclassedRows.map(r => r.driver_name).join(", ")}</>}.
          A result with no class scores on the <strong>season&rsquo;s</strong> points, not
          {gridClassName ? <> <strong>{gridClassName}</strong>&rsquo;s</> : " the class's"} — which is how one
          driver ends up paid a different rate per takedown than everyone else in the same race. Set the
          Class on those rows (or use <strong>Class for every row</strong> above) and Save.
        </p>
      )}
      {offClassRows.length > 0 && (
        <p style={{ marginTop: 0, color: "var(--accent-gold, #e2b714)", fontSize: "0.82rem" }}>
          ⚠ This round is <strong>{gridClassName || "one class"}</strong> only, but{" "}
          <strong>{offClassRows.length} row{offClassRows.length === 1 ? " is" : "s are"} in another class</strong>
          {offClassRows.length <= 4 && <> — {offClassRows.map(r => r.driver_name).join(", ")}</>}. Every new row
          here is {gridClassName || "this round's class"}; these were set to something else. Leave them if that&rsquo;s
          deliberate, or use <strong>Class for every row</strong> above and Save.
        </p>
      )}
      {isBangerRacing && (
        <>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
            💥 This is a <strong>Demo Derby / Banger Racing</strong> {sessionType === "qualifying" ? "session" : "event"}, so each row also
            records <strong>TD</strong> (takedowns), <strong>SUR</strong> (survived the longest) and{" "}
            <strong>LTH</strong> (most lethal — most takedowns, ticked automatically off the TD column).
            These stats show on this series&rsquo; Standings and Stats only.
          </p>
          {/* What the numbers being typed are actually WORTH, right where
              they're typed. A derby that silently scores nothing — because no
              rate was ever set, or the session doesn't award points at all — is
              indistinguishable from a broken one until the standings come out,
              so both cases say so here instead. */}
          {/* What a takedown is worth, set where the takedowns are typed. It
              writes to the structure this grid actually scores on, so there is
              no way to set the rate somewhere the session doesn't read. */}
          <div className={`banger-rate-bar${derbyPays ? "" : " is-unset"}`}>
            <span className="banger-chip">💥 Derby points</span>
            {derbyEdit ? (
              <>
                {BANGER_STATS.map(stat => (
                  <label key={stat.key} className="banger-rate-field">
                    {stat.name}{stat.type === "number" ? " (each)" : ""}
                    <input type="number" min="0" value={derbyEdit[stat.bonus.key] ?? "0"}
                      onChange={e => setDerbyEdit(f => ({ ...f, [stat.bonus.key]: e.target.value }))} />
                  </label>
                ))}
                <button className="btn btn-primary" type="button" style={{ marginTop: 0, padding: "4px 12px" }}
                  disabled={derbySaving} onClick={saveDerbyPoints}>
                  {derbySaving ? "Saving…" : `Save for all of ${derbyTarget?.name || "the season"}`}
                </button>
                <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
                  disabled={derbySaving} onClick={() => setDerbyEdit(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: "0.82rem", color: derbyPays ? "var(--ink-1)" : "var(--accent-gold, #e2b714)" }}>
                  {derbyPays ? (
                    <>
                      {derbyRates.map((r, i) => (
                        <span key={r.name}>
                          {i > 0 && " · "}
                          <strong>{r.name}</strong> {r.rate ? `${r.rate} pt${r.rate === 1 ? "" : "s"}${r.per ? " each" : ""}` : "0"}
                        </span>
                      ))}
                      {derbyVaries ? " — classes with their own derby rates score on theirs" : ""}
                    </>
                  ) : (
                    <>
                      ⚠ <strong>Nothing is set</strong>, so takedowns and both bonuses score{" "}
                      <strong>0</strong> — the Points column won&rsquo;t move as you type them.
                    </>
                  )}
                </span>
                {onDerbyPointsSave && derbyTarget && (
                  <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 12px" }}
                    title={`Set what each derby stat is worth. Saved to the ${derbyTarget.name} season, so it applies to every race in it — not just this one.`}
                    onClick={() => setDerbyEdit(Object.fromEntries(
                      BANGER_STATS.map(stat => [stat.bonus.key, String(Number(config.bonuses?.[stat.bonus.key] || 0))])
                    ))}>
                    {derbyPays ? "✎ Change" : "＋ Set derby points"}
                  </button>
                )}
              </>
            )}
            {onDerbyPointsSave && derbyTarget && (
              <span style={{ fontSize: "0.74rem", color: "var(--ink-2)" }}>
                set once for {derbyTarget.name} — applies to every race in it
              </span>
            )}
          </div>
          {isQual && (
            <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
              ℹ Qualifying never awards championship points, so derby stats entered here are recorded as
              stats only. Enter the ones that should score on the race session.
            </p>
          )}
          {!isQual && showPointsToggle && !pointsOn && (
            <p style={{ marginTop: 0, color: "var(--accent-gold, #e2b714)", fontSize: "0.82rem" }}>
              ⚠ <strong>{session} isn&rsquo;t awarding championship points</strong> — the
              &ldquo;Award Championship Points&rdquo; switch above is off, so nothing entered here reaches
              the standings, derby bonuses included.
            </p>
          )}
        </>
      )}
      {/* What the ladder actually is, spelled out where the positions are
          typed — an admin filling in four 4th places needs to see that four
          4th places is right, not a mistake the grid will reject on Save. */}
      {isBracketRacing && bracketRoundList.length > 0 && (
        <>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
            🏆 This is a <strong>Bracket Style Racing</strong> event — a{" "}
            <strong>{bracketSizeLabel(activeBracketSize).toLowerCase()}</strong>. The{" "}
            <strong>Fin</strong> column follows the ladder rather than running 1, 2, 3, 4…, so everyone
            knocked out in the same round shares a position. Drag ⠿ to move a driver between rounds;
            positions re-apply themselves from the bracket.
          </p>
          <div className="bracket-round-bar">
            <span className="bracket-chip">🏆 Rounds</span>
            {bracketRoundList.map(r => (
              <span key={r.position} className="bracket-round" title={`${r.count} driver${r.count === 1 ? "" : "s"} finish ${ordinal(r.position)}`}>
                <strong>{ordinal(r.position)}</strong> {r.description}
                {r.count > 1 && <em> ×{r.count}</em>}
              </span>
            ))}
          </div>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
            These are ordinary racing finishes: a bracket 3rd counts as a straight <strong>3</strong> in
            Average Finish, both 3rd-place drivers are paid the <strong>same</strong> points, and the
            results feed Wins, Podiums, Top 5s and the Overall and per-Game stats like any other race.
          </p>
        </>
      )}
      {isBracketRacing && isQual && !!activeBracketSize && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
          🏆 This is a <strong>Bracket Style Racing</strong> event, but qualifying is what SEEDS the
          ladder rather than part of it — positions here run 1, 2, 3, 4… down the field as always, one
          driver each, and still feed Poles and Average Start. The shared positions belong to the
          eliminations; enter those on the race session.
        </p>
      )}
      {!isQual && isTimedRace(race) && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
          ⏱ This is a <strong>timed</strong> event, so there&rsquo;s no scheduled lap total to count down
          from — enter each driver&rsquo;s <strong>Laps</strong> yourself.
        </p>
      )}
      {!isQual && isRoundsRace(race) && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
          🔁 This event is run in <strong>rounds</strong>
          {scheduledRounds(race) ? ` (${scheduledRounds(race)})` : ""}, so there&rsquo;s no scheduled lap
          total to count down from — enter each driver&rsquo;s <strong>Laps</strong> yourself.
        </p>
      )}
      <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.78rem" }}>
        ⌨ Press <strong>Enter</strong> in any cell to jump to the same column one row down. Or <strong>paste a whole column</strong> at once — copy a column from a spreadsheet and paste into the cell you want it to start at, and it fills straight down.
        <br />
        Every column takes one: names, times, laps, adjustments{hasClasses ? ", Class" : ""} and Status, and the tick boxes
        {isBangerRacing ? " (FL, ½, HC, MLL, Survival, Most Lethal)" : " (FL, ½, HC, MLL)"} — click the box and paste a column of
        <strong> TRUE/FALSE</strong>, <strong>Y/N</strong>, <strong>1/0</strong> or <strong>x</strong>. Status reads Running / DNF / DNS / DQ. To re-paste names over a grid that&rsquo;s
        already filled, click a driver&rsquo;s name first.
      </p>

      {!entries.length ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>
          {scoped
            ? `No drivers are in ${sessionClassName || "this class"} yet — assign drivers to it on Drivers ▸ Roster & Teams, or add one below and set their class.`
            : "No drivers on the roster yet — add one below to start entering results."}
        </p>
      ) : loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : sessionType === "qualifying" ? (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder.</p>
          <div className={`qual-grid${hasClasses ? " has-class" : ""}${isBangerRacing ? " has-banger" : ""}`}>
            {["", "Pos", "Driver", ...(hasClasses ? ["Class"] : []), "Qual Time", "To Lead", "Gap", ...bangerHeaders, pointsLabel, ""].map((h, i) => <span className="grid-header" key={h || i}>{h}</span>)}
            {rows.map((row, idx) => (
              <QualRow key={row.slot_id} row={row} idx={idx} updateRow={updateRow} updateFlag={updateFlag} onGapBlur={normalizeQualGaps} autoFocus={row.entry_id === justAddedId} points={rowPoints(row)}
                classes={classes} hasClasses={hasClasses} isBangerRacing={isBangerRacing}
                bracketRound={bracketLayout ? bracketRoundFor(activeBracketSize, row.finish_pos) : null}
                dragging={dragIndex === idx} dragOver={overIndex === idx && dragIndex !== idx}
                onDragStart={() => handleDragStart(idx)} onDragOver={e => handleDragOver(idx, e)} onDrop={() => handleDrop(idx)} onDragEnd={handleDragEnd}
                {...rowCommon(row, idx)} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.78rem" }}>Drag ⠿ to reorder — finishing positions renumber automatically.</p>
          <div className={`result-grid result-grid-wide${hasClasses ? " has-class" : ""}${isBangerRacing ? " has-banger" : ""}`}>
            {["", "Fin", "Start", "Driver", ...(hasClasses ? ["Class"] : []), "Race Time", "Int", "Best Lap", "Laps", "Led", "Inc", "FL", "½", "HC", "MLL", ...bangerHeaders, "Adj", "Status", pointsLabel, ""].map((h, i) => (
              <span className="grid-header" key={h || i}>{h}</span>
            ))}
            {rows.map((row, idx) => (
              <RowInputs key={row.slot_id} row={row} idx={idx} updateRow={updateRow} updateFlag={updateFlag}
                updateRaceTime={updateRaceTime} updateInterval={updateInterval} updateStatus={updateStatus}
                autoFocus={row.entry_id === justAddedId} points={rowPoints(row)} pointsTitle={rowPointsTitle(row)}
                classes={classes} hasClasses={hasClasses} isBangerRacing={isBangerRacing}
                bracketRound={bracketLayout ? bracketRoundFor(activeBracketSize, row.finish_pos) : null}
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

      {sessionType !== "qualifying" && !loading && (
        <div style={{ marginTop: 22, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <h4 style={{ margin: "0 0 4px" }}>Provisional Entries</h4>
          <p style={{ margin: "0 0 10px", color: "var(--ink-1)", fontSize: "0.82rem" }}>
            Drivers who didn&rsquo;t make the race but are still awarded points. Each earns the flat points you enter here and does <strong>not</strong> count toward stats (starts, wins, average finish…).
          </p>
          <p style={{ margin: "0 0 10px", color: "var(--ink-2)", fontSize: "0.78rem" }}>
            ⌨ Type a name and press <strong>Enter</strong> (or <strong>Tab</strong>) to lock the driver in and jump to Points.
            Points fill in automatically with the first finishing position nobody took
            {lastFinishPos > 0 ? <> — P{lastFinishPos + 1} for the first entry here, then down from there</> : null}. Type over it for your own value; ↺ puts the auto-fill back.
          </p>
          {provRows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {provRows.map((row, i) => (
                <div key={row.slot_id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                    {row.entry_id ? (
                      <div tabIndex={-1} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", outlineOffset: 2 }}
                        title="Paste a column of driver names here to fill these entries from this row down"
                        onPaste={e => handleColumnPaste(e, "driver", i, pasteProvColumn, { always: true })}>
                        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
                        <span>{row.driver_name}</span>
                        <button type="button" title="Change driver" className="btn btn-ghost"
                          style={{ marginTop: 0, padding: "0 6px", color: "var(--ink-2)", lineHeight: 1.4 }}
                          onClick={() => updateProvRow(row.slot_id, { entry_id: null, driver_name: "", driver_number: null, class_id: "" })}>✕</button>
                      </div>
                    ) : (
                      <DriverCombobox available={availableForProv(row)} commitOnTab gridIdx={i} onPasteColumn={pasteProvColumn}
                        onAssign={e => { assignProv(row.slot_id, e); focusProvPoints(row.slot_id); }}
                        onRequestCreate={name => setCreateFor({ slotId: row.slot_id, name, prov: true })} />
                    )}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--ink-1)", margin: 0 }}>
                    Points
                    <input type="number" value={row.manual_points} placeholder="0" style={{ width: 90 }}
                      data-prov-points={row.slot_id}
                      title={row.auto
                        ? `Auto-filled with P${lastFinishPos + i + 1} points — the first position nobody finished in. Type over it to set your own.`
                        : "Your own value — click ↺ to go back to the auto-filled points."}
                      onPaste={e => handleColumnPaste(e, "manual_points", i, pasteProvColumn)}
                      onChange={e => updateProvRow(row.slot_id, { manual_points: e.target.value, auto: false })} />
                    {!row.auto && (
                      <button type="button" className="btn btn-ghost" title="Back to the auto-filled points"
                        style={{ marginTop: 0, padding: "0 6px", color: "var(--ink-2)", lineHeight: 1.4 }}
                        onClick={() => updateProvRow(row.slot_id, { auto: true })}>↺</button>
                    )}
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

      <AddDriverToRace seasonId={seasonId} seriesName={seriesName} existingNames={existingNames}
        defaultClassId={pinnedClassId} onCreated={handleDriverAdded} onError={msg => showToast("error", msg)} />

      {pointsModal && (
        <PointsEditorModal
          session={session} sessionType={sessionType} value={templateId}
          templates={templates} baseConfig={defaultConfig} baseLabel={defaultLabel}
          classLabel={scopeClass ? pointsClassName : ""} banger={isBangerRacing}
          onAssign={assignSessionPoints} onTemplatesChanged={onTemplatesChanged}
          onClose={() => setPointsModal(false)}
        />
      )}

      {importOpen && (
        <ImportResultsModal
          session={session} sessionType={sessionType} entries={entries}
          seasonId={seasonId} seriesName={seriesName} defaultClassId={pinnedClassId}
          onDriverCreated={handleDriverAdded}
          onApply={applyImport} onClose={() => setImportOpen(false)}
        />
      )}

      {createFor && (
        <DriverCreateModal
          seasonId={seasonId} seriesName={seriesName} initialName={createFor.name} defaultClassId={pinnedClassId}
          onClose={() => setCreateFor(null)}
          onCreated={entry => {
            if (createFor.prov) { assignProv(createFor.slotId, entry); focusProvPoints(createFor.slotId); }
            else assignToSlot(createFor.slotId, entry);
            setCreateFor(null); onEntriesChanged?.();
          }}
        />
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading || !entries.length} style={{ marginTop: 16 }}>
        {busy ? "Saving…" : `Save ${scoped && sessionClassName ? `${sessionClassName} ` : ""}${LABELS[sessionType] || "Results"}`}
      </button>
      {!!entries.length && (
        <button className="btn btn-ghost" style={{ marginLeft: 8 }}
          title="Clear every slot back to an empty finishing grid"
          onClick={() => { setRows(emptySlots(DEFAULT_ROW_COUNT, bracketLayout)); setFlagLocks({}); }}>
          Reset Grid
        </button>
      )}
      <button className="btn btn-danger" style={{ marginLeft: 8 }} onClick={handleDeleteResults} disabled={busy || loading}>
        🗑 Delete {scoped && sessionClassName ? `${sessionClassName} ` : ""}{session} Results
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

// A grid tick box. `gridProps` carries the same column/row tags, Enter-to-next-
// row and column-paste wiring every other cell gets — a focused checkbox does
// receive paste events, so a TRUE/FALSE column out of a spreadsheet fills
// straight down here exactly as a column of lap times does.
function Check({ value, onChange, title, disabled, gridProps }) {
  return (
    <input type="checkbox" title={title} checked={value} disabled={disabled} onChange={e => onChange(e.target.checked)}
      {...(gridProps || {})}
      style={{ margin: "auto" }} />
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
// downward from this row (via onPasteColumn); a single value pastes normally,
// so pasting one lap time into one box still behaves like an ordinary paste.
//
// `always` is for the cells that have no text box to paste into — a tick box, a
// dropdown, a driver cell that's already filled. A native paste does nothing at
// all there, so a single value is handled here too rather than being dropped.
function handleColumnPaste(e, field, idx, onPasteColumn, { always = false } = {}) {
  if (!onPasteColumn) return;
  const values = parseColumnClipboard(e.clipboardData?.getData("text") ?? "");
  if (!values.length) return;
  if (values.length === 1 && !always) return;   // ordinary single-cell paste — let it through
  e.preventDefault();
  onPasteColumn(field, idx, values);
}

// `commitOnTab` also locks the highlighted driver in on Tab, so tabbing out of
// the box moves on with the name entered rather than losing what was typed —
// used by the Provisional Entries rows, where Tab lands on Points.
function DriverCombobox({ available, onAssign, onRequestCreate, gridIdx, onPasteColumn, commitOnTab = false }) {
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
    else if (e.key === "Tab" && commitOnTab && !e.shiftKey) {
      const opt = options[active];
      // Only a real driver commits on Tab — the create-a-driver option needs a
      // deliberate Enter/click, not a stray tab out of the field.
      if (query.trim() && opt?.type === "entry") { e.preventDefault(); choose(opt); }
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
//
// The filled state has no input to paste into, which used to mean a column of
// names could only be pasted onto a grid whose Driver column was still empty —
// exactly the wrong way round for fixing a running order that's already been
// entered. So the filled cell is a paste target in its own right: click it and
// paste, and the whole column re-resolves from there down. tabIndex is -1 so
// this doesn't add a second tab stop to a row that already has the ✕ button.
function DriverCell({ row, idx, dragging, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  if (!row.entry_id) {
    return <DriverCombobox available={available} onAssign={onAssign} onRequestCreate={onRequestCreate} gridIdx={idx} onPasteColumn={onPasteColumn} />;
  }
  return (
    <div
      tabIndex={-1}
      title="Paste a column of driver names here to fill the running order from this row down"
      onPaste={e => handleColumnPaste(e, "driver", idx, onPasteColumn, { always: true })}
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap", opacity: dragging ? 0.35 : 1, outlineOffset: 2 }}
    >
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

// Rightmost row action: drops this finishing position from the grid. Never
// touches the season roster or any other session — see removeSlot.
function RemoveButton({ row, onRemove }) {
  const title = row.entry_id
    ? `Remove this position — takes ${row.driver_name} out of this session only, and keeps them on the roster and in every other session`
    : "Remove this finishing position";
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
function ClassCell({ row, idx, classes, updateRow, gridProps }) {
  return (
    <select value={row.class_id ?? ""} disabled={!row.entry_id}
      title="Class this driver ran in — a pasted column of class names fills straight down"
      {...(gridProps || {})}
      onChange={e => updateRow(idx, "class_id", e.target.value)}>
      <option value="">—</option>
      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// The Demo Derby / Banger Racing cells for one row — a numeric input for a
// counted stat (Takedowns), a checkbox for a bonus flag (Survival, Most
// Lethal). Generated from BANGER_STATS, so a new banger stat needs no edit
// here. `updateFlag` is used for the flags so hand-ticking one hands it to the
// admin for the session, exactly like FL/HC/MLL.
function BangerCells({ row, idx, updateRow, updateFlag, gridProps, pickerProps }) {
  const hasDriver = !!row.entry_id;
  return (
    <>
      {BANGER_STATS.map(stat => (stat.type === "bool" ? (
        <Check key={stat.key} title={stat.title} value={!!row[stat.key]} disabled={!hasDriver}
          gridProps={pickerProps(stat.key)}
          onChange={v => (updateFlag ? updateFlag(idx, stat.key, v) : updateRow(idx, stat.key, v))} />
      ) : (
        <input key={stat.key} type="number" min="0" title={stat.title} value={row[stat.key] ?? "0"} disabled={!hasDriver}
          {...gridProps(stat.key)} onChange={e => updateRow(idx, stat.key, e.target.value)} />
      )))}
    </>
  );
}

function RowInputs({ row, idx, updateRow, updateFlag, updateRaceTime, updateInterval, updateStatus, autoFocus, points, pointsTitle, classes = [], hasClasses, isBangerRacing, bracketRound = null, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  const hasDriver = !!row.entry_id;
  const isLeader = Number(row.finish_pos) === 1;
  // Shared per-cell wiring: column/row tags, Enter-to-next-row, and column
  // paste (fill-down). Spread onto every cell in the row — inputs, tick boxes
  // and dropdowns alike, so every column takes a pasted spreadsheet column.
  const gridProps = (field, opts) => ({
    "data-grid-field": field, "data-grid-idx": idx,
    onKeyDown: gridEnterAdvance,
    onPaste: e => handleColumnPaste(e, field, idx, onPasteColumn, opts),
  });
  // A tick box or a dropdown has no text box for a native paste to land in, so
  // even a single pasted value is handled here as a one-row fill.
  const pickerProps = field => gridProps(field, { always: true });
  const num = (field, min = 0, focus = false) => (
    <input type="number" min={min} value={row[field]} disabled={!hasDriver}
      {...gridProps(field)}
      onChange={e => updateRow(idx, field, e.target.value)} autoFocus={focus} />
  );
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} title={bracketRound?.label} {...gridProps("finish_pos")} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <input type="number" min="1" title="Starting position (defaults from Qualifying)" placeholder="—" disabled={!hasDriver}
        value={row.start_pos} {...gridProps("start_pos")} onChange={e => updateRow(idx, "start_pos", e.target.value)} />
      <DriverCell row={row} idx={idx} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} onPasteColumn={onPasteColumn} />
      {hasClasses && <ClassCell row={row} idx={idx} classes={classes} updateRow={updateRow} gridProps={pickerProps("class_id")} />}
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
      <Check title="Fastest lap — ticked automatically for the quickest Best Lap time entered. Change it and it stays where you put it."
        value={row.fastest_lap} disabled={!hasDriver} gridProps={pickerProps("fastest_lap")} onChange={v => updateFlag(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} disabled={!hasDriver}
        gridProps={pickerProps("halfway_leader")} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger — ticked automatically for the biggest gain from Start to Fin (ties go to whoever finished highest). Change it and it stays where you put it."
        value={row.hard_charger} disabled={!hasDriver} gridProps={pickerProps("hard_charger")} onChange={v => updateFlag(idx, "hard_charger", v)} />
      <Check title="Most laps led — ticked automatically for the highest Led count (a tie is shared). Change it and it stays where you put it."
        value={row.most_laps_led} disabled={!hasDriver} gridProps={pickerProps("most_laps_led")} onChange={v => updateFlag(idx, "most_laps_led", v)} />
      {isBangerRacing && <BangerCells row={row} idx={idx} updateRow={updateRow} updateFlag={updateFlag} gridProps={gridProps} pickerProps={pickerProps} />}
      <input type="number" title="Points adjustment — penalty (−) or bonus (+). Applied on top of scored points without changing the finishing position."
        placeholder="0" value={row.points_adjustment} disabled={!hasDriver}
        {...gridProps("points_adjustment")} onChange={e => updateRow(idx, "points_adjustment", e.target.value)} style={{ textAlign: "center" }} />
      <select title="Status — DNS (did not start) scores nothing and counts toward no stat; DNF and DQ are both scored as classified finishes and both add to the driver's DNF total. A pasted column of Running/DNF/DNS/DQ fills straight down."
        value={row.status} disabled={!hasDriver} {...pickerProps("status")} onChange={e => updateStatus(idx, e.target.value)}>
        <option value="finished">Running</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
      <div className="points-cell" title={pointsTitle} style={{ textAlign: "center", fontWeight: 600, cursor: pointsTitle ? "help" : undefined }}>{points}</div>
      <RemoveButton row={row} onRemove={onRemove} />
    </>
  );
}

function QualRow({ row, idx, updateRow, updateFlag, onGapBlur, autoFocus, points, classes = [], hasClasses, isBangerRacing, bracketRound = null, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, available, onAssign, onClear, onRequestCreate, onPasteColumn }) {
  const hasDriver = !!row.entry_id;
  const isPole = Number(row.finish_pos) === 1;
  const gridProps = (field, opts) => ({
    "data-grid-field": field, "data-grid-idx": idx,
    onKeyDown: gridEnterAdvance,
    onPaste: e => handleColumnPaste(e, field, idx, onPasteColumn, opts),
  });
  const pickerProps = field => gridProps(field, { always: true });
  return (
    <>
      <DragHandle dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      <input type="number" min="1" value={row.finish_pos} {...gridProps("finish_pos")} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={hasDriver && autoFocus} />
      <DriverCell row={row} idx={idx} dragging={dragging} available={available} onAssign={onAssign} onClear={onClear} onRequestCreate={onRequestCreate} onPasteColumn={onPasteColumn} />
      {hasClasses && <ClassCell row={row} idx={idx} classes={classes} updateRow={updateRow} gridProps={pickerProps("class_id")} />}
      <input placeholder="01:43.863" value={row.qual_time} disabled={!hasDriver}
        title="Lap time. Fills To Lead and Gap as you type — or type one of those instead and this fills itself."
        {...gridProps("qual_time")} onBlur={onGapBlur} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      {/* To Lead / Gap are two ways of saying the same thing as Qual Time, and
          any one of the three fills the other two. Pole has neither — it's the
          time everything else is measured against. */}
      <input placeholder={isPole ? "pole" : "+0.312"} value={isPole ? "" : (row.qual_to_lead ?? "")} disabled={!hasDriver || isPole}
        title="Gap to pole. Type it and the lap time fills itself from the pole time."
        {...gridProps("qual_to_lead")} onBlur={onGapBlur} onChange={e => updateRow(idx, "qual_to_lead", e.target.value)} />
      <input placeholder={isPole ? "—" : "+0.087"} value={isPole ? "" : (row.qual_gap ?? "")} disabled={!hasDriver || isPole}
        title="Gap to the car one position up. Type it and the lap time fills itself from that car's time."
        {...gridProps("qual_gap")} onBlur={onGapBlur} onChange={e => updateRow(idx, "qual_gap", e.target.value)} />
      {isBangerRacing && <BangerCells row={row} idx={idx} updateRow={updateRow} updateFlag={updateFlag} gridProps={gridProps} pickerProps={pickerProps} />}
      <div className="points-cell" style={{ textAlign: "center", fontWeight: 600 }}>{points}</div>
      <RemoveButton row={row} onRemove={onRemove} />
    </>
  );
}
