// iRacing `event_result` JSON → the same tabular shape the CSV/paste importer
// already understands (see lib/resultsImport.js).
//
// iRacing's own results export (the JSON behind /data/results/get, what you get
// from the results page rather than from SimRacerHub) carries the WHOLE event in
// one file: practice, qualifying, every heat, the consolation races and the
// feature all live side by side in `session_results[]`. That's exactly the shape
// of a league night here — Qualifying, Heat 1, B-Main, A-Main Feature — so one
// upload can fill every session grid, one segment at a time.
//
// This module does two things and nothing else:
//   parseIracingResults(text)  — recognise the file and split it into segments
//   segmentTable(segment)      — turn one segment into { headers, rows }
// The second hands back a table with headers the existing mapHeaders() already
// maps, so the whole downstream pipeline (column mapping, fuzzy driver
// matching, the review grid) is reused unchanged. Everything here is pure and
// never throws: an unrecognised file just yields null.

import { formatTime, formatGap } from "@/lib/raceTime";

// ── Units ─────────────────────────────────────────────────────────────────

// iRacing reports every duration in ten-thousandths of a second, and uses -1
// (sometimes 0) for "no time set". → seconds, or null.
export function iracingTime(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 10000;
}

// A lap/elapsed time as the clock string the results grid stores ("0:22.900").
export function formatIracingTime(raw) {
  const sec = iracingTime(raw);
  return sec == null ? "" : formatTime(sec);
}

// ── Segment classification ────────────────────────────────────────────────

// iRacing's simsession_type: 2 practice, 3 open practice, 4/5 qualifying,
// 6 race. Heat-format events name their race sessions ("HEAT 1", "B-MAIN",
// "FEATURE"), which is what tells the three race-ish session types apart.
const RACE_TYPES = new Set([6]);
const QUAL_TYPES = new Set([4, 5]);

// The app's session type a segment belongs in: "qualifying" | "heat" |
// "consolation" | "feature" | "race" | "practice". Matches the session types in
// components/SessionEditor.jsx, so a segment lands in the grid it belongs to.
export function segmentType(simsession) {
  const type = Number(simsession?.simsession_type);
  const name = String(simsession?.simsession_name || "").toUpperCase();
  if (QUAL_TYPES.has(type)) return "qualifying";
  if (!RACE_TYPES.has(type)) return "practice";
  if (/HEAT|QUALIFYING RACE|QUAL RACE/.test(name)) return "heat";
  // B/C/D-Main, the LCQ and the semis are consolation races; the A-Main (or a
  // lone "Main") is the feature. Consolation is tested first so the lettered
  // mains are claimed before the generic "MAIN" fallback below.
  if (/CONSOLATION|CONSI|LAST CHANCE|LCQ|[B-Z][-\s]?MAIN|SEMI/.test(name)) return "consolation";
  if (/FEATURE|MAIN|GRAND FINAL/.test(name)) return "feature";
  return "race";
}

// Tidy display label for a segment. iRacing shouts its session names
// ("B-MAIN"); title-case them so the picker reads like the rest of the app.
function segmentLabel(name) {
  return String(name || "Session")
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\bMain\b/g, "Main");
}

// ── Parsing ───────────────────────────────────────────────────────────────

// The event payload inside whatever wrapper the file has: the raw
// /data/results/get response ({ type: "event_result", data: {…} }), the bare
// event object, or an array of either (several subsessions saved together).
function eventDocs(parsed) {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const data = item.data && typeof item.data === "object" ? item.data : item;
    if (Array.isArray(data.session_results)) out.push(data);
  }
  return out;
}

// Is this text an iRacing results JSON? Cheap enough to run before the CSV
// parser on every paste/upload.
export function looksLikeIracingJson(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    return eventDocs(JSON.parse(t)).length > 0;
  } catch {
    return false;
  }
}

// Parse one or more iRacing results JSON documents into the segments they
// contain. Returns null when the text isn't an iRacing results file at all (the
// caller then falls back to the CSV/paste parser).
//
// Segments are keyed by subsession + simsession number, so re-uploading the
// same file — or uploading the same event twice — collapses into one entry
// rather than listing every session twice.
export function parseIracingResults(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    return null;
  }
  const docs = eventDocs(parsed);
  if (!docs.length) return null;

  const segments = [];
  const seen = new Set();
  for (const doc of docs) {
    const event = {
      subsession_id: doc.subsession_id ?? null,
      league_name: doc.league_name || "",
      season_name: doc.league_season_name || doc.season_name || "",
      series_name: doc.series_name || doc.session_name || "",
      track: [doc.track?.track_name, doc.track?.config_name].filter(Boolean).join(" — "),
      start_time: doc.start_time || "",
      event_laps_complete: doc.event_laps_complete ?? null,
    };
    for (const sim of doc.session_results) {
      const key = `${event.subsession_id ?? "?"}:${sim.simsession_number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const results = Array.isArray(sim.results) ? sim.results : [];
      segments.push({
        key,
        event,
        name: segmentLabel(sim.simsession_name),
        raw_name: sim.simsession_name || "",
        type: segmentType(sim),
        simsession_number: Number(sim.simsession_number) || 0,
        driver_count: results.length,
        results,
      });
    }
  }
  // Practice first, then qualifying, heats, consolations, feature — iRacing
  // numbers its simsessions in running order (negative → 0), so that ordering
  // already is the running order of the night.
  segments.sort((a, b) => a.simsession_number - b.simsession_number);
  return { event: segments[0]?.event ?? null, segments };
}

// ── Segment → table ───────────────────────────────────────────────────────

export const IRACING_HEADERS = [
  "Fin", "Start", "Car", "Driver", "Laps", "Led", "Inc",
  "Interval", "Best Lap", "Qual Time", "Status", "Points",
];

// iRacing positions are 0-based (P1 is 0) and -1 when there is none —
// qualifying results carry no starting position at all.
const pos = raw => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? String(n + 1) : "";
};

// Gap to the winner. iRacing gives it in ten-thousandths of a second, and -1
// for a car that finished a lap or more down. A lapped car's interval is the
// lap deficit against the winner's distance, written in the "NL" form the
// results grid uses (see lib/raceTime.js) so laps-down finishers keep working
// with the grid's lap derivation.
function intervalCell(row, leaderLaps, running) {
  const laps = Number(row.laps_complete) || 0;
  // A car that didn't see the flag has no gap to the winner — its distance is
  // its lap count, which the Laps column already carries.
  if (!laps || !running) return "";
  const sec = iracingTime(row.interval);
  if (sec != null) return formatGap(sec);
  if (Number(row.interval) === 0) return "";
  const down = (Number(leaderLaps) || 0) - laps;
  return down > 0 ? `${down}L` : "";
}

// How the driver's session ended, worded so the shared status parser reads it
// right: "Running" → finished, no laps at all → DNS, anything else (a
// disconnect, a tow, a DQ) → a DNF-worded string carrying iRacing's reason.
// "Disqualified" still reads as a DQ rather than a DNF — the status parser
// checks for that wording first.
function statusCell(row) {
  const reason = String(row.reason_out || "").trim();
  const laps = Number(row.laps_complete) || 0;
  if (!reason || /^running$/i.test(reason)) return laps > 0 ? "Running" : "DNS";
  return `DNF (${reason})`;
}

// One segment → { headers, rows } in the shape parseTable() returns, ready for
// mapHeaders() + buildRows(). Rows come out in finishing order.
export function segmentTable(segment) {
  const type = segment?.type || "race";
  const results = [...(segment?.results || [])].sort((a, b) => {
    const av = Number(a.finish_position); const bv = Number(b.finish_position);
    return (av < 0 ? Infinity : av) - (bv < 0 ? Infinity : bv);
  });
  const leaderLaps = Math.max(0, ...results.map(r => Number(r.laps_complete) || 0));
  const qualifying = type === "qualifying";

  const rows = results.map(r => {
    // In a qualifying segment the driver's best lap IS their qualifying time;
    // in a race it's their fastest lap of the run. `qual_lap_time` is only
    // populated on race sessions of events that qualified beforehand.
    const bestLap = formatIracingTime(r.best_lap_time);
    const status = statusCell(r);
    return [
      pos(r.finish_position),
      pos(r.starting_position),
      String(r.livery?.car_number ?? "").trim(),
      String(r.display_name ?? "").trim(),
      String(Number(r.laps_complete) || 0),
      String(Number(r.laps_lead) || 0),
      String(Number(r.incidents) || 0),
      intervalCell(r, leaderLaps, status === "Running"),
      bestLap,
      qualifying ? bestLap : formatIracingTime(r.qual_lap_time),
      status,
      String(r.league_points ?? r.champ_points ?? ""),
    ];
  });
  return { headers: [...IRACING_HEADERS], rows, delimiter: "iracing" };
}

// ── Choosing a segment ────────────────────────────────────────────────────

// The segment to preselect for the grid the importer was opened from. Prefer an
// exact name match ("Heat 1" ↔ "HEAT 1", "Feature" ↔ "FEATURE"), then any
// segment of the right session type, then the feature, then the last race run.
export function defaultSegment(segments, sessionType, sessionName) {
  if (!segments?.length) return null;
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = norm(sessionName);
  if (wanted) {
    const exact = segments.find(s => norm(s.raw_name) === wanted || norm(s.name) === wanted);
    if (exact) return exact;
  }
  const byType = segments.filter(s => s.type === sessionType);
  if (byType.length) {
    // Several heats: fall back on the number in the grid's name ("Heat 2").
    const num = String(sessionName || "").match(/\d+/)?.[0];
    if (num) {
      const numbered = byType.find(s => (s.raw_name.match(/\d+/) || [])[0] === num);
      if (numbered) return numbered;
    }
    return byType[0];
  }
  return segments.find(s => s.type === "feature")
    || [...segments].reverse().find(s => s.type !== "practice")
    || segments[0];
}
