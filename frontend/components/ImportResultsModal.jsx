"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseTable, mapHeaders, buildRows, MAPPABLE_FIELDS } from "@/lib/resultsImport";
import { parseIracingResults, looksLikeIracingJson, segmentTable, defaultSegment } from "@/lib/iracingImport";
import { hasSrhSessionStats, looksLikeSrhRef, srhEventLabel, srhPointsSummary } from "@/lib/srhImport";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { aliasValues } from "@/lib/aliases";
import { displayNameValues } from "@/lib/driverNames";
import { api } from "@/lib/api";

const SKIP = "__skip__";
const CREATE = "__create__";

const statusChip = {
  matched: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950", label: "matched" },
  suggested: { bg: "rgba(210,153,34,0.18)", fg: "#d29922", label: "check" },
  unmatched: { bg: "rgba(248,81,73,0.18)", fg: "#f85149", label: "no match" },
};

// Session-type labels for the event session picker, so a session says which
// grid it belongs in using the same words the editor's tabs do.
const SEGMENT_TYPE_LABEL = {
  qualifying: "Qualifying", heat: "Heat", consolation: "Consolation",
  feature: "Feature", race: "Race", practice: "Practice",
};

// Smart results importer. Four sources, one review table:
//   • import straight from SimRacerHub — paste the race's URL (or its id) and
//     the whole night comes back: qualifying, every heat, the consolation and
//     the feature, each one a session you can fill a grid from
//   • paste a results table (a spreadsheet, any game)
//   • upload a CSV export
//   • upload iRacing's own results JSON — which carries the whole event
//     (qualifying, heats, B-Main, Feature) in one file, so you pick which
//     segment to import and repeat per session grid
// Columns and driver names are detected either way; the admin can remap any
// column and resolve/skip individual drivers before applying — nothing is saved
// until they Apply and then Save the grid.
// Each row also carries a "Prov" tick: a driver who didn't really race but is
// still owed flat points. Ticking it sends that driver straight to the
// Provisional Entries section at the bottom of the results screen instead of
// taking a finishing position in the grid — an outcome neither of the driver
// dropdown's own options (— skip row —, + Create new driver…) can express.
// `defaultClassId` is the class the grid this import feeds is being entered for
// (a per-class session, or a "<class> only" round) — a driver created from the
// review table joins it, the same as one created on the grid itself.
// `autoFocusSrh` opens the modal with the cursor already in the SimRacerHub box
// — what the results screen's own "Import from SimRacerHub" button wants, so
// that path is paste-and-go rather than paste-after-hunting.
export function ImportResultsModal({ session, sessionType, entries, seasonId, seriesName, defaultClassId = "", autoFocusSrh = false, onDriverCreated, onApply, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);      // { headers, rows, delimiter }
  const [mapping, setMapping] = useState({});
  const [overrides, setOverrides] = useState({});  // rowIdx -> entry_id | SKIP
  const [prov, setProv] = useState({});            // rowIdx -> true when ticked "set to provisional"
  const [extraEntries, setExtraEntries] = useState([]); // drivers created from this modal
  const [createFor, setCreateFor] = useState(null);     // { idx, name } while the create form is open
  const [dragActive, setDragActive] = useState(false);
  // A whole event and its sessions, from an iRacing JSON or a SimRacerHub race
  // page: { source: "iracing" | "srh", event, segments }. Both are picked from
  // one session menu, so the shape they share is the one the UI works in.
  const [doc, setDoc] = useState(null);
  const [segmentKey, setSegmentKey] = useState("");// which session of that event is loaded
  const [source, setSource] = useState("");        // what was loaded, for the file chip
  const [srhRef, setSrhRef] = useState("");        // the SimRacerHub URL / id box
  const [srhBusy, setSrhBusy] = useState(false);
  const [srhError, setSrhError] = useState("");
  // Whether to carry the session's race statistics (cautions, caution laps,
  // lead changes) onto the event with this import. On by default, because a
  // source that reports them is the reason not to type them by hand.
  const [withRaceStats, setWithRaceStats] = useState(true);
  // Whether the points the source itself counted are what each row is scored
  // on. On by default whenever the loaded table carries a Points column, which
  // is the only time the switch is shown: a table that bothered to print points
  // is a table whose standings the admin wants to match, and re-deriving them
  // from this league's own structure is what makes the two disagree. Untick to
  // go back to scoring every finishing position here. Same bargain as the
  // season importer's switch — see SrhSeasonResultsModal.
  const [takePoints, setTakePoints] = useState(true);
  const [aliasesByDriver, setAliasesByDriver] = useState({}); // driver_id -> [alias value strings]
  const fileRef = useRef(null);

  // Pull the global driver pool once so we can match imported names not just
  // against each entry's display name but every other name the linked driver
  // goes by: their connected-account aliases (PSN, Xbox, Discord, iRacing…) and
  // the display names they're shown under overall and per game. Keyed by
  // driver_id, which every season entry carries.
  useEffect(() => {
    let alive = true;
    api("/api/drivers")
      .then(pool => {
        if (alive) setAliasesByDriver(Object.fromEntries(
          pool.map(d => [d.id, [...aliasValues(d.aliases), ...displayNameValues(d)]])
        ));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The roster this import can resolve to: the season's entries plus any driver
  // created from the review table without leaving the modal. Newly created
  // entries carry real ids, so a row assigned to one imports like any other.
  //
  // Deduplicated by entry id, because the two halves overlap. Creating a driver
  // here does two things: it appends the new entry to `extraEntries` (so the row
  // can be assigned to it immediately) and it asks the editor to refresh the
  // season roster — which comes back from the server carrying that same entry
  // and re-renders this modal with it in `entries`. Without the dedupe every
  // driver created during one import showed up twice in the Roster driver
  // dropdown (same name, same number, same id), which is only ever a display
  // problem: one entry was created, and the duplicate is two references to it.
  const allEntries = useMemo(() => {
    const byId = new Map();
    for (const e of [...entries, ...extraEntries]) {
      const id = e.id ?? e.entry_id;
      // Keyless entries can't be deduped or assigned to — keep them out rather
      // than collapsing them all onto one another.
      if (id == null) continue;
      if (!byId.has(id)) byId.set(id, e);
    }
    return [...byId.values()];
  }, [entries, extraEntries]);
  const sortedEntries = useMemo(
    () => [...allEntries].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [allEntries]
  );

  // Entries enriched with their driver's alias strings — the roster fuzzy
  // matching runs against. The dropdown still uses sortedEntries for display.
  const matchEntries = useMemo(
    () => sortedEntries.map(e => ({ ...e, aliases: aliasesByDriver[e.driver_id] || [] })),
    [sortedEntries, aliasesByDriver]
  );

  // The session of the loaded event currently feeding the review table, if any.
  const selectedSegment = useMemo(
    () => doc?.segments?.find(s => s.key === segmentKey) || null,
    [doc, segmentKey]
  );

  // What the loaded event is, for the line above the session menu.
  const docMeta = useMemo(() => {
    if (!doc) return "";
    if (doc.source === "srh") return srhEventLabel(doc.event);
    return [doc.event?.league_name || doc.event?.series_name, doc.event?.track,
      doc.event?.subsession_id ? `subsession ${doc.event.subsession_id}` : null]
      .filter(Boolean).join(" · ");
  }, [doc]);

  // The session's own race statistics, when the source reports them. These
  // describe the RUNNING of the race rather than any driver in it, so they go on
  // the event (its Race Info) rather than into a grid row — see lib/raceStats.js.
  // A qualifying or practice session reports none.
  const sessionStats = hasSrhSessionStats(selectedSegment?.stats) ? selectedSegment.stats : null;

  // Column count + labels for the mapping dropdowns.
  const columns = useMemo(() => {
    if (!parsed) return [];
    const n = Math.max(parsed.headers?.length || 0, ...parsed.rows.map(r => r.length), 0);
    return Array.from({ length: n }, (_, i) => ({ i, label: parsed.headers?.[i]?.trim() || `Column ${i + 1}` }));
  }, [parsed]);

  // Re-derive rows whenever the mapping changes; matching happens inside.
  // Pass sessionType so a qualifying import routes the lap time into Qual Time.
  const built = useMemo(
    () => (parsed ? buildRows(parsed, mapping, matchEntries, { sessionType }) : { rows: [], warnings: [] }),
    [parsed, mapping, matchEntries, sessionType]
  );

  // Load a parsed table into the review UI, re-deriving the column mapping.
  //
  // A source that says which drivers were paid without racing — SimRacerHub
  // flags them — arrives with those rows already ticked for Provisional
  // Entries, so the statistician confirms that reading rather than re-entering
  // it. Everything else starts untouched.
  function loadTable(t) {
    setParsed(t);
    setMapping(mapHeaders(t.headers, t.rows.slice(0, 8)));
    setOverrides({});
    setProv(Object.fromEntries((t?.provisional || []).flatMap((p, i) => (p ? [[i, true]] : []))));
  }

  function reset() {
    setText(""); setParsed(null); setMapping({}); setOverrides({}); setProv({});
    setDoc(null); setSegmentKey(""); setSource(""); setSrhError("");
    setWithRaceStats(true);
  }

  // One session of a loaded event → { headers, rows }. SimRacerHub's sessions
  // arrive from the API as tables already; an iRacing JSON is turned into one
  // here, from the segment's own rows.
  const tableOf = seg => (
    seg?.headers
      ? {
          headers: seg.headers, rows: seg.rows, delimiter: seg.delimiter || "srh",
          provisional: seg.provisional, points: seg.points,
        }
      : segmentTable(seg)
  );

  // Show a whole event (either source) and open it on the session that belongs
  // in the grid this importer was opened from.
  function loadDoc(next, label) {
    const seg = defaultSegment(next.segments, sessionType, session);
    setDoc(next);
    setSegmentKey(seg?.key || "");
    setSource(label);
    loadTable(tableOf(seg));
  }

  // Pull a SimRacerHub race in by URL or id. The fetch is server-side (SRH
  // sends no CORS headers), and what comes back is every session of the night —
  // nothing is saved, it only fills the review table below.
  async function importFromSrh(input) {
    const ref = String(input ?? "").trim() || srhRef.trim();
    if (!ref || srhBusy) return;
    setSrhBusy(true);
    setSrhError("");
    try {
      const res = await api(`/api/import-srh?url=${encodeURIComponent(ref)}`);
      if (!res?.segments?.length) throw new Error("That SimRacerHub race has no sessions on it yet.");
      setSrhRef(ref);
      setText("");
      loadDoc(
        { source: "srh", event: res.event, segments: res.segments, source_url: res.source_url },
        `SimRacerHub · ${srhEventLabel(res.event) || ref}`,
      );
    } catch (err) {
      // Leave anything already loaded alone — a mistyped id shouldn't throw
      // away a table the admin was part way through reviewing.
      setSrhError(err.message || "Could not import that SimRacerHub race.");
    } finally {
      setSrhBusy(false);
    }
  }

  // Parse whatever was pasted or dropped. A SimRacerHub link is fetched rather
  // than parsed (pasting one into the table box is a request to import that
  // race, not a one-row table); iRacing's results JSON is recognised next (it
  // holds every segment of the event); anything else goes through the
  // delimited-text parser.
  function runParse(raw, label = "") {
    if (looksLikeSrhRef(raw)) { importFromSrh(raw); return; }
    const iracingDoc = parseIracingResults(raw);
    if (iracingDoc?.segments?.length) {
      loadDoc({ source: "iracing", ...iracingDoc }, label || "iRacing results JSON");
      return;
    }
    setDoc(null); setSegmentKey(""); setSource(label);
    loadTable(parseTable(raw));
  }

  // Switch which session of the loaded event fills the review table.
  function selectSegment(key) {
    const seg = doc?.segments?.find(s => s.key === key);
    if (!seg) return;
    setSegmentKey(key);
    loadTable(tableOf(seg));
  }

  const readAsText = file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsText(file);
  });

  // Read one or more dropped/chosen files. Several iRacing JSONs (e.g. one saved
  // per segment, or several subsessions of the same night) are merged into a
  // single segment list — duplicates of the same session collapse. A CSV or
  // pasted table still uses just the first file, as before.
  async function readFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const texts = await Promise.all(files.map(readAsText));
    const jsons = texts.filter(looksLikeIracingJson);
    if (jsons.length) {
      // Keep the (large) JSON out of the textarea — the parsed segments are all
      // the UI needs from here on.
      setText("");
      const label = jsons.length > 1 ? `iRacing results JSON · ${jsons.length} files` : `iRacing results JSON · ${files[0].name}`;
      runParse(jsons.length === 1 ? jsons[0] : `[${jsons.join(",")}]`, label);
      return;
    }
    setText(texts[0]);
    runParse(texts[0], files[0].name);
  }

  function onFile(e) { readFiles(e.target.files); }
  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (files?.length) readFiles(files);
  }

  // Create a brand-new driver for an unresolved row, then assign the row to it.
  function handleDriverCreated(entry) {
    const id = entry.id ?? entry.entry_id;
    setExtraEntries(prev => (prev.some(e => (e.id ?? e.entry_id) === id) ? prev : [...prev, entry]));
    if (createFor) setOverrides(o => ({ ...o, [createFor.idx]: entry.id }));
    onDriverCreated?.(entry); // add to the grid + refresh the season roster
    setCreateFor(null);
  }

  const resolvedEntryId = (row, idx) => {
    const o = overrides[idx];
    if (o === SKIP) return null;
    if (o) return o;
    return row.match.entry_id;
  };

  // Provisional entries are a race-results idea — a qualifying sheet has no
  // section for them, so the column isn't offered there.
  const allowProvisional = sessionType !== "qualifying";
  // Ticked AND resolvable: a row whose driver was skipped imports nowhere at
  // all, so it can't be provisional either.
  const isProv = (row, idx) => allowProvisional && !!prov[idx] && resolvedEntryId(row, idx) != null;

  // SimRacerHub's itemised points for a review row, when the loaded table
  // carries them — they ride alongside the rows, see srhSegmentTable. Null for
  // a pasted table or an iRacing file, which say a total and nothing more.
  const srhPointsFor = idx => parsed?.points?.[idx] || null;
  // Is any of it worth a column? A table with no points at all shouldn't grow
  // an empty one.
  const showPoints = useMemo(
    () => built.rows.some((r, i) => r.values.points != null || srhPointsFor(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [built.rows, parsed]
  );

  // Rows that will actually import (a driver resolved and not skipped).
  const applicable = built.rows
    .map((row, idx) => ({ row, idx, entry_id: resolvedEntryId(row, idx), provisional: isProv(row, idx) }))
    .filter(x => x.entry_id);

  const provCount = applicable.filter(x => x.provisional).length;

  // Flag the same driver landing on two imported rows.
  const dupIds = useMemo(() => {
    const seen = {}, dup = new Set();
    for (const a of applicable) { if (seen[a.entry_id]) dup.add(a.entry_id); seen[a.entry_id] = true; }
    return dup;
  }, [applicable]);

  // What the source paid a review row, whatever source it came from: the
  // itemised SimRacerHub total when the page carried one, otherwise the plain
  // Points column a pasted table, a CSV or an iRacing file mapped. Null when
  // the table said nothing about points at all.
  const paidFor = (row, idx) => srhPointsFor(idx)?.total ?? row.values.points ?? null;

  function apply() {
    const rows = applicable.map(({ row, entry_id, provisional, idx }) => {
      // Taken as the row's own points outright when the switch is on. The
      // figure already contains whatever the source added or took away, so its
      // penalties and bonuses must NOT also go to Adj — that double-count is
      // the whole reason these two are decided together. Null hands the row
      // back to this league's own points structure, exactly as before.
      const paid = paidFor(row, idx);
      const override = takePoints && paid != null ? paid : null;
      return {
        entry_id,
        // Ticked "Prov": the editor parks this driver in Provisional Entries on
        // flat points rather than giving them a finishing position, so none of
        // the stats below are used for them.
        provisional,
        finish_pos: row.values.finish_pos,
        start_pos: row.values.start_pos,
        laps: row.values.laps,
        laps_led: row.values.laps_led,
        incidents: row.values.incidents,
        interval: row.values.interval,
        race_time: row.values.race_time,
        qual_time: row.values.qual_time,
        // The driver's best single lap time (clock string) — fills the grid's
        // "Best Lap" column and is what a track record is derived from. Was
        // previously dropped here, so SimRacerHub fastest-lap times never saved.
        fastest_lap_time: row.values.fastest_lap_time,
        // Car number read from the "Car Number" / "Car #" column, if any.
        car_number: row.values.car_number,
        status: row.values.status,
        fastest_lap: row.values.fastest_lap,
        // What the source paid this driver. A provisional entry's flat points
        // ARE this number — there's no finishing position to score one off — so
        // the editor puts it straight in their points box either way.
        points: paid,
        // The part of that total this app has no way to work out for itself: a
        // SimRacerHub penalty, a bonus of its own, its stage points. That net
        // goes in the grid's Adj column, on top of the points this league's
        // structure pays. Null from a source with no opinion on it, which
        // leaves a hand-typed Adj alone.
        //
        // Zero when the row carries the source's total instead, because the
        // total already contains them.
        points_adjustment: override != null ? 0 : (srhPointsFor(idx)?.carried ?? null),
        // The figure the row is scored on, straight into the grid's Points
        // cell, which pointsFor then pays instead of working one out from the
        // finishing position (see lib/standings.js). Every cell stays editable
        // on the results screen afterwards, and clearing one hands that row
        // back to the points structure.
        manual_points: override,
      };
    });
    // The event's race statistics ride alongside the rows rather than in them:
    // they belong to the race, so the editor holds them for its own Save to
    // write onto the event. Left out entirely when the source reported none, or
    // when the statistician unticked them — importing a heat's cautions onto
    // the event is rarely what's wanted.
    onApply(rows, sessionStats && withRaceStats
      ? { raceStats: sessionStats, sessionName: selectedSegment?.name || "" }
      : undefined);
  }

  const s = built.rows.length
    ? {
        total: built.rows.length,
        matched: built.rows.filter(r => r.match.status === "matched").length,
        suggested: built.rows.filter(r => r.match.status === "suggested").length,
        unmatched: built.rows.filter((r, i) => resolvedEntryId(r, i) == null).length,
      }
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="form-card" style={{ maxWidth: 900, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Smart Import · {session}</h3>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>

        <p style={{ margin: "6px 0 10px", fontSize: "0.82rem", color: "var(--ink-1)" }}>
          Import a race straight from SimRacerHub — one URL brings back every session of the night.
          Or paste a results table (a spreadsheet, any game), upload a CSV, or upload iRacing&rsquo;s
          results JSON, which likewise holds the whole event. Columns and driver names are detected —
          review and adjust below, then Apply.
        </p>

        {/* ── Import from SimRacerHub ──────────────────────────────────────
            The fast path, so it comes first. One URL fetches the whole night:
            qualifying, the heats, the consolation and the feature all arrive
            together and each can fill its own grid. */}
        <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "var(--bg-elevated)" }}>
          <strong style={{ fontSize: "0.85rem" }}>Import from SimRacerHub</strong>
          <p style={{ margin: "2px 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Paste the race&rsquo;s SimRacerHub URL (or just its id) and every session on it — Qualifying,
            Heats, Consolations, the Feature — comes back for review.
          </p>
          <form
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            onSubmit={e => { e.preventDefault(); importFromSrh(srhRef); }}
          >
            <input
              autoFocus={autoFocusSrh}
              value={srhRef}
              onChange={e => { setSrhRef(e.target.value); setSrhError(""); }}
              aria-label="SimRacerHub race URL or id"
              placeholder="https://www.simracerhub.com/scoring/season_race.php?schedule_id=…"
              style={{ flex: "1 1 280px", minWidth: 0, padding: "6px 10px", border: "1.5px solid var(--border)", borderRadius: 8, background: "var(--bg-base, var(--bg-elevated))", color: "var(--ink-0)", fontSize: "0.85rem" }}
            />
            <button type="submit" className="btn btn-primary" style={{ marginTop: 0, whiteSpace: "nowrap" }} disabled={!srhRef.trim() || srhBusy}>
              {srhBusy ? "Importing…" : "Import Results"}
            </button>
          </form>
          {srhError && (
            <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>⚠ {srhError}</p>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); if (!dragActive) setDragActive(true); }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
          onDrop={onDrop}
          style={{
            border: `1.5px dashed ${dragActive ? "var(--accent-cyan, #58a6ff)" : "var(--border)"}`,
            background: dragActive ? "rgba(88,166,255,0.08)" : "var(--bg-elevated)",
            borderRadius: 10, padding: "14px 16px", textAlign: "center", cursor: "pointer",
            marginBottom: 10, transition: "background 0.12s, border-color 0.12s",
          }}
        >
          <div style={{ fontSize: "1.3rem", lineHeight: 1 }}>⬆</div>
          <div style={{ fontSize: "0.85rem", color: "var(--ink-0)", marginTop: 4 }}>
            <strong>Drop a CSV or iRacing JSON here</strong> or click to browse
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--ink-2)", marginTop: 2 }}>
            SimRacerHub CSV · iRacing results JSON (all sessions) — or paste a table below
          </div>
          {source && (
            <div style={{ fontSize: "0.76rem", color: "var(--ink-1)", marginTop: 6 }}>
              Loaded: <strong>{source}</strong>
            </div>
          )}
          <input ref={fileRef} type="file" multiple accept=".csv,.tsv,.txt,.json,text/csv,application/json" style={{ display: "none" }} onChange={onFile} />
        </div>

        {doc && (
          <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong style={{ fontSize: "0.85rem" }}>{doc.source === "srh" ? "SimRacerHub event" : "iRacing event"}</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>{docMeta}</span>
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-1)", marginTop: 8 }}>
              Session to import into <strong>{session}</strong>
              <select value={segmentKey} onChange={e => selectSegment(e.target.value)} style={{ width: "100%", marginTop: 2 }}>
                {doc.segments.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.name} — {SEGMENT_TYPE_LABEL[s.type] || s.type}, {s.driver_count} driver{s.driver_count === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            {selectedSegment && selectedSegment.type !== sessionType && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
                ⚠ {selectedSegment.name} is {SEGMENT_TYPE_LABEL[selectedSegment.type] || selectedSegment.type} in
                {doc.source === "srh" ? " SimRacerHub" : " iRacing"}, but you&rsquo;re importing into the{" "}
                {SEGMENT_TYPE_LABEL[sessionType] || sessionType} grid ({session}). Switch sessions above if that
                isn&rsquo;t what you meant.
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
              One session at a time — apply and save this one, then reopen Smart Import on the next session and
              pick it from the same {doc.source === "srh" ? "race" : "file"}.
            </p>
          </div>
        )}

        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--ink-1)", margin: "2px 0 6px" }}>
          Or paste comma- or tab-separated results (or an iRacing results JSON, or a SimRacerHub race link)
        </label>
        <textarea
          rows={12}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={"Fin,Start,Driver,Laps,Led,Inc\n1,3,Jane Doe,50,20,2\n2,1,John Smith,50,30,4"}
          style={{ width: "100%", minHeight: 220, padding: 12, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--ink-0)", fontFamily: "monospace", fontSize: "0.92rem", lineHeight: 1.5, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} disabled={!text.trim()} onClick={() => runParse(text)}>Parse</button>
          {parsed && <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={reset}>Clear</button>}
        </div>

        {parsed && (
          <>
            {/* Column mapping */}
            <h4 style={{ margin: "16px 0 6px" }}>Column mapping</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {MAPPABLE_FIELDS.map(([field, label]) => (
                <label key={field} style={{ fontSize: "0.78rem", color: "var(--ink-1)" }}>
                  {label}
                  <select
                    value={mapping[field] ?? ""}
                    onChange={e => setMapping(m => { const next = { ...m }; if (e.target.value === "") delete next[field]; else next[field] = Number(e.target.value); return next; })}
                    style={{ width: "100%", marginTop: 2 }}
                  >
                    <option value="">— none —</option>
                    {columns.map(c => <option key={c.i} value={c.i}>{c.label}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {built.warnings.map((w, i) => (
              <p key={i} style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--accent-amber, #d29922)" }}>⚠ {w}</p>
            ))}

            {/* ── The race's own statistics ────────────────────────────────
                Cautions, caution laps and lead changes describe the RUNNING of
                the race rather than any driver in it, so they go on the event
                and print at the top of its results page — above the drivers,
                which is where they sit here too. Different Leaders is not
                offered: this app counts it off the Led column rather than
                storing a figure that could disagree with the grid. */}
            {sessionStats && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginTop: 12, background: "var(--bg-elevated)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: "0.85rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={withRaceStats} onChange={e => setWithRaceStats(e.target.checked)}
                    style={{ width: 16, height: 16, margin: 0 }} />
                  <strong>Race statistics from {selectedSegment?.name || "this session"}</strong>
                </label>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "8px 0 0", fontSize: "0.82rem", opacity: withRaceStats ? 1 : 0.45 }}>
                  {[["🟡", "Caution Flags", sessionStats.caution_flags],
                    ["🟠", "Caution Laps", sessionStats.caution_laps],
                    ["🔄", "Lead Changes", sessionStats.lead_changes]].map(([icon, label, value]) => (
                    <span key={label}>
                      <span aria-hidden="true">{icon}</span> {label}{" "}
                      <strong>{value == null ? "—" : value}</strong>
                    </span>
                  ))}
                </div>
                <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  These belong to the event, not to a driver, so they go on its <strong>Race Info</strong> and print at the
                  top of the results page. Nothing is saved until you Save {session} — the figures ride along with it.
                  {sessionStats.leaders != null && (
                    <> SimRacerHub also counted <strong>{sessionStats.leaders}</strong>{" "}
                      {sessionStats.leaders === 1 ? "leader" : "different leaders"}; this app works that out from the Led
                      column itself, so it isn&rsquo;t stored — the grid below is what decides it.</>
                  )}
                  {" "}Untick if you&rsquo;d rather keep the figures this event already has.
                </p>
              </div>
            )}

            {/* Preview + driver resolution */}
            <h4 style={{ margin: "16px 0 6px" }}>
              Preview{s && <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-1)" }}> · {s.matched} matched, {s.suggested} to check, {s.unmatched} unresolved of {s.total}{provCount ? `, ${provCount} provisional` : ""}</span>}
            </h4>
            {allowProvisional && (
              <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Tick <strong>Prov</strong> beside a driver who didn&rsquo;t really race but is still owed points — they go to
                Provisional Entries at the bottom of the results screen on flat points instead of taking a finishing position.
              </p>
            )}
            {/* ── Score on the source's own points ─────────────────────────
                Shown only when the loaded table carried points at all. This is
                the switch that decides whether this season's standings match
                the ones the source prints: with it on, the pasted Pts column is
                what each row is paid, so nothing has to be reconciled by hand
                afterwards. The season importer offers the same bargain in the
                same words — see SrhSeasonResultsModal. */}
            {showPoints && (
              <div className="check-row" style={{ margin: "0 0 10px" }}>
                <input id="import_take_points" type="checkbox" checked={takePoints}
                  onChange={e => setTakePoints(e.target.checked)} />
                <label htmlFor="import_take_points" style={{ fontSize: "0.82rem" }}>
                  <strong>Score every driver on the points in this table</strong>
                  <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem", marginTop: 2 }}>
                    {takePoints
                      ? "Each row is imported holding the figure in the Pts column — that scale, those bonuses, those penalties — so the standings here match the ones this table came from, with nothing to edit. Every figure is still editable per row on the results screen afterwards, and clearing one hands that row back to your own points structure."
                      : "Your own points structure scores every finishing position instead, and Pts below is only there to check against it. What this app can't work out for itself (a penalty, or a bonus of your league's own) still rides across in the grid's Adj column. The standings here will differ from the source's wherever the two scales do."}
                    {" "}A <strong>provisional</strong> entry takes the figure as its flat points either way, having no
                    finishing position to be scored off.
                  </span>
                </label>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="stats-table" style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>{sessionType === "qualifying" ? "Pos" : "Fin"}</th>
                    {sessionType !== "qualifying" && <th>Start</th>}
                    <th style={{ textAlign: "left" }}>Imported name</th>
                    <th style={{ textAlign: "left" }}>Roster driver</th>
                    {allowProvisional && (
                      <th title="Set to provisional — the driver is awarded flat points in the Provisional Entries section instead of taking a finishing position">
                        Prov
                      </th>
                    )}
                    {sessionType === "qualifying"
                      ? <th>Qual Time</th>
                      : <><th>Laps</th><th>Led</th><th>Inc</th><th>FL</th><th>Status</th></>}
                    {showPoints && (
                      <th title={takePoints
                        ? "What the source paid this driver — and, with the box above ticked, what this row is scored on. Hover a figure for the breakdown."
                        : "What the source paid this driver. A finishing row is scored by your own points structure, so this is here to check against it — hover a figure for the breakdown. A provisional entry's points are taken from it."}>
                        Pts
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {built.rows.map((row, idx) => {
                    const chip = statusChip[row.match.status];
                    const resolved = resolvedEntryId(row, idx);
                    const dup = resolved && dupIds.has(resolved);
                    const provRow = isProv(row, idx);
                    // A provisional driver's finishing stats aren't imported —
                    // fade them so the row reads as "points only" at a glance.
                    const statStyle = provRow ? { opacity: 0.4 } : undefined;
                    return (
                      <tr key={idx} style={resolved == null ? { opacity: 0.55 } : dup ? { background: "rgba(248,81,73,0.08)" } : undefined}>
                        <td style={statStyle}>{row.values.finish_pos}</td>
                        {sessionType !== "qualifying" && <td style={statStyle}>{row.values.start_pos ?? "—"}</td>}
                        <td style={{ textAlign: "left" }}>
                          {row.rawName || <em style={{ color: "var(--ink-2)" }}>(blank)</em>}
                          {row.rawName && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: chip.bg, color: chip.fg }}>{chip.label}</span>}
                          {dup && <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "#f85149" }}>dup</span>}
                          {provRow && <span title="Goes to Provisional Entries — flat points, no finishing position" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(163,113,247,0.18)", color: "#a371f7" }}>provisional</span>}
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <select
                            value={overrides[idx] ?? (row.match.entry_id || SKIP)}
                            onChange={e => {
                              if (e.target.value === CREATE) { setCreateFor({ idx, name: row.rawName }); return; }
                              setOverrides(o => ({ ...o, [idx]: e.target.value }));
                            }}
                            style={{ minWidth: 160 }}
                          >
                            <option value={SKIP}>— skip row —</option>
                            {sortedEntries.map(en => (
                              <option key={en.id} value={en.id}>
                                {en.name}{en.number != null ? ` (#${en.number})` : ""}
                              </option>
                            ))}
                            {seasonId && <option value={CREATE}>+ Create new driver…</option>}
                          </select>
                        </td>
                        {allowProvisional && (
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={provRow}
                              disabled={resolved == null}
                              aria-label={`Set ${row.rawName || "this row"} to provisional`}
                              title={resolved == null
                                ? "Pick a roster driver first — a skipped row can't be provisional"
                                : "Set to provisional — award flat points at the bottom of the results screen instead of a finishing position"}
                              onChange={e => setProv(p => ({ ...p, [idx]: e.target.checked }))}
                              style={{ width: 16, height: 16, margin: 0, cursor: resolved == null ? "not-allowed" : "pointer" }}
                            />
                          </td>
                        )}
                        {sessionType === "qualifying" ? (
                          <td style={statStyle}>
                            {row.values.qual_time || <em style={{ color: "var(--ink-2)" }}>—</em>}
                            {row.values.fastest_lap && <span title="Fastest lap of qualifying" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>FL</span>}
                          </td>
                        ) : (
                          <>
                            <td style={statStyle}>{row.values.laps}</td>
                            <td style={statStyle}>{row.values.laps_led}</td>
                            <td style={statStyle}>{row.values.incidents}</td>
                            <td style={statStyle}>{row.values.fastest_lap ? "✓" : ""}</td>
                            <td style={statStyle}>{row.values.status}</td>
                          </>
                        )}
                        {showPoints && (
                          <PointsCell row={row} points={srhPointsFor(idx)} provisional={provRow}
                            taken={takePoints && paidFor(row, idx) != null} />
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {dupIds.size > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                ⚠ The same roster driver is assigned to more than one row — fix before applying, or the last one wins.
              </p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} disabled={!applicable.length} onClick={apply}>
                Apply {applicable.length - provCount} result{applicable.length - provCount === 1 ? "" : "s"}
                {provCount ? ` + ${provCount} provisional` : ""}
              </button>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={onClose}>Cancel</button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
              Applying fills the grid — nothing is saved until you click Save {session}.
            </p>
          </>
        )}
      </div>

      {createFor && (
        <DriverCreateModal
          seasonId={seasonId}
          seriesName={seriesName}
          initialName={createFor.name}
          defaultClassId={defaultClassId}
          onClose={() => setCreateFor(null)}
          onCreated={handleDriverCreated}
        />
      )}
    </div>
  );
}

// The review table's Pts cell: what the source paid this driver, and which part
// of it the grid is about to take.
//
// `taken` — the "Score every driver on the points in this table" box — says the
// total IS this row's points. The Adj chip then goes away, because the total
// already contains everything it would have carried, and the hover text says so
// rather than describing a breakdown that no longer applies.
//
// Unticked, the row is scored by the league's own points structure off the
// position the grid holds, so the total here is for CHECKING against it rather
// than something the import writes. What the import does write then is the Adj
// figure beside it: the penalties and the bonuses this app has no way to derive
// for itself (see srhRowPoints in lib/srhImport.js). A provisional entry is the
// same either way — the total IS its points, because a driver who didn't race
// has no finishing position to be paid for.
function PointsCell({ row, points, provisional, taken = false }) {
  const total = points?.total ?? row.values.points;
  if (total == null) return <td />;
  const carried = provisional || taken ? 0 : Number(points?.carried || 0);
  const round = v => (Number.isInteger(v) ? v : Number(Number(v).toFixed(3)));
  // A pasted table has no itemised breakdown to hover, so it gets the one line
  // that matters instead of nothing at all.
  const title = srhPointsSummary(points, { provisional, taken })
    || (taken && !provisional ? `Imported as this row's points: ${round(total)}` : "");
  return (
    <td title={title || undefined} style={{ whiteSpace: "nowrap" }}>
      {round(total)}
      {carried !== 0 && (
        <span
          style={{
            marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem",
            background: carried < 0 ? "rgba(248,81,73,0.18)" : "rgba(46,160,67,0.18)",
            color: carried < 0 ? "#f85149" : "#3fb950",
          }}
        >
          Adj {carried > 0 ? "+" : ""}{round(carried)}
        </span>
      )}
      {provisional ? (
        <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "var(--ink-2)" }}>flat</span>
      ) : taken ? (
        <span title="This row is scored on this figure, not on your points structure"
          style={{ marginLeft: 6, fontSize: "0.68rem", color: "var(--ink-2)" }}>scored</span>
      ) : null}
    </td>
  );
}
