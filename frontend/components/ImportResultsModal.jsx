"use client";

import { useMemo, useRef, useState } from "react";
import { parseTable, mapHeaders, buildRows, MAPPABLE_FIELDS } from "@/lib/resultsImport";
import { importGt7Screenshots } from "@/lib/api";
import { DriverCreateModal } from "@/components/DriverCreateModal";

const SKIP = "__skip__";
const CREATE = "__create__";

const statusChip = {
  matched: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950", label: "matched" },
  suggested: { bg: "rgba(210,153,34,0.18)", fg: "#d29922", label: "check" },
  unmatched: { bg: "rgba(248,81,73,0.18)", fg: "#f85149", label: "no match" },
};

// Smart results importer. Paste a table (SimRacerHub, a spreadsheet, …) or
// upload a CSV (iRacing export, etc.); the parser detects the delimiter and
// columns and fuzzy-matches driver names against this season's roster. The
// admin can remap any column and resolve/skip individual drivers before
// applying — nothing is saved until they Apply and then Save the grid.
export function ImportResultsModal({ session, sessionType, entries, seasonId, seriesName, onDriverCreated, onApply, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);      // { headers, rows, delimiter }
  const [mapping, setMapping] = useState({});
  const [overrides, setOverrides] = useState({});  // rowIdx -> entry_id | SKIP
  const [extraEntries, setExtraEntries] = useState([]); // drivers created from this modal
  const [createFor, setCreateFor] = useState(null);     // { idx, name } while the create form is open
  const [dragActive, setDragActive] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);        // vision OCR request in flight
  const [ocrError, setOcrError] = useState("");
  const [ocrSource, setOcrSource] = useState(0);        // how many screenshots produced the current preview
  const fileRef = useRef(null);
  const imageRef = useRef(null);

  // The roster this import can resolve to: the season's entries plus any driver
  // created from the review table without leaving the modal. Newly created
  // entries carry real ids, so a row assigned to one imports like any other.
  const allEntries = useMemo(() => [...entries, ...extraEntries], [entries, extraEntries]);
  const sortedEntries = useMemo(
    () => [...allEntries].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [allEntries]
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
    () => (parsed ? buildRows(parsed, mapping, sortedEntries, { sessionType }) : { rows: [], warnings: [] }),
    [parsed, mapping, sortedEntries, sessionType]
  );

  function runParse(raw) {
    const t = parseTable(raw);
    setParsed(t);
    setMapping(mapHeaders(t.headers, t.rows.slice(0, 8)));
    setOverrides({});
    setOcrSource(0);
  }

  // Feed OCR-extracted GT7 rows into the exact same pipeline as a pasted table:
  // build a tiny { headers, rows } grid whose columns the auto-mapper resolves
  // to Finish / Driver / Best Lap, then let buildRows do fuzzy matching and the
  // fastest-lap calculation just as it does for a CSV.
  function loadOcrRows(rows, imageCount) {
    const headers = ["Pos", "Driver", "Best Lap"];
    const grid = rows.map(r => [String(r.position ?? ""), r.driver ?? "", r.best_lap ?? ""]);
    const t = { headers, rows: grid, delimiter: "ocr" };
    setParsed(t);
    setMapping(mapHeaders(headers));
    setOverrides({});
    setText("");
    setOcrSource(imageCount);
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const raw = String(reader.result || ""); setText(raw); runParse(raw); };
    reader.readAsText(file);
  }

  // Run GT7 screenshots through the vision OCR route. Accepts multiple images so
  // a full 16-car lobby (two screenshots) resolves in one pass.
  async function readImages(files) {
    const imgs = [...files].filter(f => f && f.type?.startsWith("image/"));
    if (!imgs.length) return;
    setOcrError("");
    setOcrBusy(true);
    try {
      const rows = await importGt7Screenshots(imgs);
      loadOcrRows(rows, imgs.length);
    } catch (err) {
      setOcrError(err.message || "Could not read the screenshots.");
    } finally {
      setOcrBusy(false);
    }
  }

  function onFile(e) { readFile(e.target.files?.[0]); }
  function onImages(e) { readImages(e.target.files || []); }
  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    // A GT7 import is images; a CSV import is a single text file. Route by type.
    if ([...files].some(f => f.type?.startsWith("image/"))) readImages(files);
    else readFile(files[0]);
  }

  // Create a brand-new driver for an unresolved row, then assign the row to it.
  function handleDriverCreated(entry) {
    setExtraEntries(prev => [...prev, entry]);
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
          <h3 style={{ margin: 0 }}>{ocrSource > 0 ? "GT7 Results Importer" : "Smart Import"} · {session}</h3>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>

        <p style={{ margin: "6px 0 10px", fontSize: "0.82rem", color: "var(--ink-1)" }}>
          Paste a results table (SimRacerHub, a spreadsheet, any game), upload a CSV (e.g. an iRacing export),
          or drop <strong>Gran Turismo 7 screenshots</strong> — the two shots a 16-car lobby needs are read and combined
          automatically. Columns and driver names are detected — review and adjust below, then Apply.
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
            marginBottom: 8, transition: "background 0.12s, border-color 0.12s",
          }}
        >
          <div style={{ fontSize: "1.3rem", lineHeight: 1 }}>{ocrBusy ? "⏳" : "⬆"}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--ink-0)", marginTop: 4 }}>
            {ocrBusy
              ? <strong>Reading screenshots…</strong>
              : <><strong>Drop a CSV or GT7 screenshots here</strong> or click to browse</>}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--ink-2)", marginTop: 2 }}>
            SimRacerHub / iRacing CSV — or paste a table below
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 0, padding: "4px 10px", fontSize: "0.78rem" }}
              disabled={ocrBusy}
              onClick={e => { e.stopPropagation(); imageRef.current?.click(); }}
            >
              🖼 Browse GT7 screenshots…
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: "none" }} onChange={onFile} />
          <input ref={imageRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onImages} />
        </div>
        {ocrError && (
          <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "#f85149" }}>⚠ {ocrError}</p>
        )}

        <textarea
          rows={6}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={"Fin,Start,Driver,Laps,Led,Inc\n1,3,Jane Doe,50,20,2\n2,1,John Smith,50,30,4"}
          style={{ width: "100%", padding: 10, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-elevated)", color: "var(--ink-0)", fontFamily: "monospace", fontSize: "0.82rem", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} disabled={!text.trim()} onClick={() => runParse(text)}>Parse</button>
          {parsed && <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={() => { setText(""); setParsed(null); setMapping({}); setOverrides({}); setOcrSource(0); setOcrError(""); }}>Clear</button>}
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

            {ocrSource > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
                🖼 Read from {ocrSource} GT7 screenshot{ocrSource === 1 ? "" : "s"} — verify positions, names, and lap times below before applying.
              </p>
            )}
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
