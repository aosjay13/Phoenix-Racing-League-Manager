"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseTable, mapHeaders, buildRows, MAPPABLE_FIELDS } from "@/lib/resultsImport";
import { parseIracingResults, looksLikeIracingJson, segmentTable, defaultSegment } from "@/lib/iracingImport";
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

// Session-type labels for the iRacing segment picker, so a segment says which
// grid it belongs in using the same words the editor's tabs do.
const SEGMENT_TYPE_LABEL = {
  qualifying: "Qualifying", heat: "Heat", consolation: "Consolation",
  feature: "Feature", race: "Race", practice: "Practice",
};

// Smart results importer. Three sources, one review table:
//   • paste a results table (SimRacerHub, a spreadsheet, any game)
//   • upload a CSV export
//   • upload iRacing's own results JSON — which carries the whole event
//     (qualifying, heats, B-Main, Feature) in one file, so you pick which
//     segment to import and repeat per session grid
// Columns and driver names are detected either way; the admin can remap any
// column and resolve/skip individual drivers before applying — nothing is saved
// until they Apply and then Save the grid.
export function ImportResultsModal({ session, sessionType, entries, seasonId, seriesName, onDriverCreated, onApply, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);      // { headers, rows, delimiter }
  const [mapping, setMapping] = useState({});
  const [overrides, setOverrides] = useState({});  // rowIdx -> entry_id | SKIP
  const [extraEntries, setExtraEntries] = useState([]); // drivers created from this modal
  const [createFor, setCreateFor] = useState(null);     // { idx, name } while the create form is open
  const [dragActive, setDragActive] = useState(false);
  const [iracing, setIracing] = useState(null);    // { event, segments } from an iRacing JSON
  const [segmentKey, setSegmentKey] = useState("");// which segment of that event is loaded
  const [source, setSource] = useState("");        // what was loaded, for the file chip
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

  // The iRacing segment currently feeding the review table, if any.
  const selectedSegment = useMemo(
    () => iracing?.segments.find(s => s.key === segmentKey) || null,
    [iracing, segmentKey]
  );

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
  function loadTable(t) {
    setParsed(t);
    setMapping(mapHeaders(t.headers, t.rows.slice(0, 8)));
    setOverrides({});
  }

  function reset() {
    setText(""); setParsed(null); setMapping({}); setOverrides({});
    setIracing(null); setSegmentKey(""); setSource("");
  }

  // Parse whatever was pasted or dropped. iRacing's results JSON is recognised
  // first (it holds every segment of the event); anything else goes through the
  // delimited-text parser.
  function runParse(raw, label = "") {
    const doc = parseIracingResults(raw);
    if (doc?.segments?.length) {
      const seg = defaultSegment(doc.segments, sessionType, session);
      setIracing(doc);
      setSegmentKey(seg?.key || "");
      setSource(label || "iRacing results JSON");
      loadTable(segmentTable(seg));
      return;
    }
    setIracing(null); setSegmentKey(""); setSource(label);
    loadTable(parseTable(raw));
  }

  // Switch which segment of a loaded iRacing event fills the review table.
  function selectSegment(key) {
    const seg = iracing?.segments.find(s => s.key === key);
    if (!seg) return;
    setSegmentKey(key);
    loadTable(segmentTable(seg));
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

  // Rows that will actually import (a driver resolved and not skipped).
  const applicable = built.rows
    .map((row, idx) => ({ row, idx, entry_id: resolvedEntryId(row, idx) }))
    .filter(x => x.entry_id);

  // Flag the same driver landing on two imported rows.
  const dupIds = useMemo(() => {
    const seen = {}, dup = new Set();
    for (const a of applicable) { if (seen[a.entry_id]) dup.add(a.entry_id); seen[a.entry_id] = true; }
    return dup;
  }, [applicable]);

  function apply() {
    const rows = applicable.map(({ row, entry_id }) => ({
      entry_id,
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
    }));
    onApply(rows);
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
          Paste a results table (SimRacerHub, a spreadsheet, any game), upload a CSV, or upload iRacing&rsquo;s
          results JSON — that one file holds every segment of the event, and you pick which to import.
          Columns and driver names are detected — review and adjust below, then Apply.
        </p>

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
            SimRacerHub CSV · iRacing results JSON (all segments) — or paste a table below
          </div>
          {source && (
            <div style={{ fontSize: "0.76rem", color: "var(--ink-1)", marginTop: 6 }}>
              Loaded: <strong>{source}</strong>
            </div>
          )}
          <input ref={fileRef} type="file" multiple accept=".csv,.tsv,.txt,.json,text/csv,application/json" style={{ display: "none" }} onChange={onFile} />
        </div>

        {iracing && (
          <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong style={{ fontSize: "0.85rem" }}>iRacing event</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
                {[iracing.event?.league_name || iracing.event?.series_name, iracing.event?.track,
                  iracing.event?.subsession_id ? `subsession ${iracing.event.subsession_id}` : null]
                  .filter(Boolean).join(" · ")}
              </span>
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-1)", marginTop: 8 }}>
              Race segment to import into <strong>{session}</strong>
              <select value={segmentKey} onChange={e => selectSegment(e.target.value)} style={{ width: "100%", marginTop: 2 }}>
                {iracing.segments.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.name} — {SEGMENT_TYPE_LABEL[s.type] || s.type}, {s.driver_count} driver{s.driver_count === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            {selectedSegment && selectedSegment.type !== sessionType && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
                ⚠ {selectedSegment.name} is {SEGMENT_TYPE_LABEL[selectedSegment.type] || selectedSegment.type} in
                iRacing, but you&rsquo;re importing into the {SEGMENT_TYPE_LABEL[sessionType] || sessionType} grid
                ({session}). Switch segments above if that isn&rsquo;t what you meant.
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
              One segment at a time — apply and save this one, then reopen Smart Import on the next session and
              pick its segment from the same file.
            </p>
          </div>
        )}

        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--ink-1)", margin: "2px 0 6px" }}>
          Or paste comma- or tab-separated results (or iRacing results JSON)
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

            {/* Preview + driver resolution */}
            <h4 style={{ margin: "16px 0 6px" }}>
              Preview{s && <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-1)" }}> · {s.matched} matched, {s.suggested} to check, {s.unmatched} unresolved of {s.total}</span>}
            </h4>
            <div style={{ overflowX: "auto" }}>
              <table className="stats-table" style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>{sessionType === "qualifying" ? "Pos" : "Fin"}</th>
                    {sessionType !== "qualifying" && <th>Start</th>}
                    <th style={{ textAlign: "left" }}>Imported name</th>
                    <th style={{ textAlign: "left" }}>Roster driver</th>
                    {sessionType === "qualifying"
                      ? <th>Qual Time</th>
                      : <><th>Laps</th><th>Led</th><th>Inc</th><th>FL</th><th>Status</th></>}
                  </tr>
                </thead>
                <tbody>
                  {built.rows.map((row, idx) => {
                    const chip = statusChip[row.match.status];
                    const resolved = resolvedEntryId(row, idx);
                    const dup = resolved && dupIds.has(resolved);
                    return (
                      <tr key={idx} style={resolved == null ? { opacity: 0.55 } : dup ? { background: "rgba(248,81,73,0.08)" } : undefined}>
                        <td>{row.values.finish_pos}</td>
                        {sessionType !== "qualifying" && <td>{row.values.start_pos ?? "—"}</td>}
                        <td style={{ textAlign: "left" }}>
                          {row.rawName || <em style={{ color: "var(--ink-2)" }}>(blank)</em>}
                          {row.rawName && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: chip.bg, color: chip.fg }}>{chip.label}</span>}
                          {dup && <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "#f85149" }}>dup</span>}
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
                        {sessionType === "qualifying" ? (
                          <td>
                            {row.values.qual_time || <em style={{ color: "var(--ink-2)" }}>—</em>}
                            {row.values.fastest_lap && <span title="Fastest lap of qualifying" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>FL</span>}
                          </td>
                        ) : (
                          <>
                            <td>{row.values.laps}</td>
                            <td>{row.values.laps_led}</td>
                            <td>{row.values.incidents}</td>
                            <td>{row.values.fastest_lap ? "✓" : ""}</td>
                            <td>{row.values.status}</td>
                          </>
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
                Apply {applicable.length} result{applicable.length === 1 ? "" : "s"}
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
          onClose={() => setCreateFor(null)}
          onCreated={handleDriverCreated}
        />
      )}
    </div>
  );
}
