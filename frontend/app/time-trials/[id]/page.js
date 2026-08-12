"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { TimeTrialLapsModal } from "@/components/TimeTrialLapsModal";
import { CompleteTimeTrialModal } from "@/components/CompleteTimeTrialModal";
import { ExportQualifyingModal } from "@/components/ExportQualifyingModal";
import { TimeTrialSettingsModal } from "@/components/TimeTrialSettingsModal";
import { formatRaceDate } from "@/lib/raceDate";
import { autoAssignClasses, averageLabel, normalizeLaps, rankEntries, summarizeEntries } from "@/lib/timeTrials";

// One Time Trial session — the sheet.
//
// Reading it: driver names down the side, every lap they submitted across, and
// the two derived columns (Best Time, Best Average Time) that everything else
// keys off. Both are one-click sortable. A driver's fastest lap is worked out in
// the browser from the laps themselves and shown in bold, so nobody has to mark
// it by hand and it can never disagree with the Best Time column beside it.
//
// Writing it: an admin types laps straight into the row. Nothing is saved until
// Save, so a mistyped lap is a keystroke to fix rather than a correction to a
// stored result.
//
// None of this is a race. No points, no finishing positions, and no entry in
// any standard statistic — the two ways out of this screen are the roster
// (Complete Session) and a race's qualifying grid (Export to Qualifying).

// A local sheet row. `id` is the stored document id once saved and a temporary
// key before that, so React keys and the placement assignments both survive the
// round trip.
let tempSeq = 0;
function blankRow(seed = {}) {
  return {
    id: `new-${++tempSeq}`,
    stored: false,
    name: "", number: "", driver_id: "", user_id: "", entry_id: "",
    laps: [], assigned_class_id: "", notes: "",
    ...seed,
  };
}

// How many lap columns the grid shows: every lap anybody has actually run, plus
// one empty column to type the next one into — capped by the session's own
// Maximum Laps where it has one.
function lapColumnCount(rows, maxLaps) {
  const used = rows.reduce((n, r) => Math.max(n, normalizeLaps(r.laps).length), 0);
  const wanted = used + 1;
  return maxLaps ? Math.min(Math.max(wanted, 1), maxLaps) : Math.max(wanted, 1);
}

// Driver picker for adding somebody to the sheet: the global driver pool and,
// when the trial is attached to a season, that season's roster. A placement
// night is run for drivers who are on no roster at all, so a name typed here
// that matches nobody is still perfectly valid — it just joins the sheet as a
// plain name until the roster is built from it.
function AddDriverBar({ pool, taken, onAdd, disabled }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();
  const matches = q
    ? pool.filter(p => p.name.toLowerCase().includes(q) && !taken.has(p.name.trim().toLowerCase())).slice(0, 8)
    : [];
  const exact = pool.some(p => p.name.toLowerCase() === q);

  function add(candidate) {
    onAdd(candidate);
    setQuery("");
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ position: "relative", maxWidth: 340, marginTop: 12 }}>
      <input ref={inputRef} value={query} disabled={disabled}
        placeholder="+ Add a driver to this session…"
        title="Type a name and press Enter. Drivers who aren't in the pool yet can still be added by name."
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!q) return;
            add(matches[0] || { name: query.trim() });
          } else if (e.key === "Escape") setOpen(false);
        }} />
      {open && q && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          background: "var(--surface-1, #14141c)", border: "1px solid var(--border)",
          borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: "auto",
        }}>
          {matches.map(m => (
            <button key={`${m.driver_id || m.entry_id || m.name}`} type="button" className="btn btn-ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0 }}
              onMouseDown={e => e.preventDefault()} onClick={() => add(m)}>
              {m.name}
              {m.source && <span style={{ color: "var(--ink-2)", fontSize: "0.76rem" }}> · {m.source}</span>}
            </button>
          ))}
          {!exact && (
            <button type="button" className="btn btn-ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0, color: "var(--accent-cyan)" }}
              onMouseDown={e => e.preventDefault()} onClick={() => add({ name: query.trim() })}>
              ＋ Add &ldquo;{query.trim()}&rdquo; by name
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TimeTrialPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { seasons } = useLeague();

  const [trial, setTrial] = useState(null);
  const [classes, setClasses] = useState([]);
  const [rows, setRows] = useState([]);
  const [pool, setPool] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sort, setSort] = useState({ key: "best", asc: true });
  const [expanded, setExpanded] = useState(null);   // row id whose laps are open
  const [completing, setCompleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/time-trials/${id}`);
      setTrial(data.trial);
      setClasses(data.classes || []);
      setRows((data.entries || []).map(e => ({ ...blankRow(), ...e, stored: true })));
      setSort(s => ({ ...s, key: data.trial.sort_key === "average" ? "average" : s.key }));
      setDirty(false);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Who can be added to the sheet: the global driver pool always, plus the
  // attached season's roster (which carries car numbers and the roster entry a
  // qualifying export files results against). Keyed on the season alone — the
  // trial doc changes every time a lap is saved, and the pool doesn't move with
  // it.
  useEffect(() => {
    if (!trial) return;
    let live = true;
    (async () => {
      const [drivers, entries] = await Promise.all([
        api("/api/drivers").catch(() => []),
        trial.season_id ? api(`/api/entries?season_id=${trial.season_id}`).catch(() => []) : Promise.resolve([]),
      ]);
      if (!live) return;
      const byName = new Map();
      for (const e of entries) {
        byName.set(String(e.name || "").trim().toLowerCase(), {
          name: e.name, driver_id: e.driver_id || "", user_id: e.user_id || "",
          entry_id: e.id, number: e.number ?? "", assigned_class_id: e.class_id || "", source: "roster",
        });
      }
      for (const d of drivers) {
        const key = String(d.name || "").trim().toLowerCase();
        if (!key || byName.has(key)) continue;
        byName.set(key, { name: d.name, driver_id: d.id, user_id: d.user_id || "", source: "driver pool" });
      }
      setPool([...byName.values()]);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trial?.season_id]);

  // ── Derived sheet ─────────────────────────────────────────────────────────
  const summarized = useMemo(
    () => summarizeEntries(rows, { averageLaps: trial?.average_laps }),
    [rows, trial?.average_laps]
  );

  // The display ORDER is held separately from the data, and settles only when
  // the sort changes or the field does (a driver added or removed, the sheet
  // loaded, a save). Ranking live off every keystroke would re-sort the table
  // under the cursor of the admin typing into it — a lap improving a driver's
  // best time would fling their row up the sheet mid-entry. So the columns sort
  // on click, exactly as asked, and stay put while laps are being typed.
  const [order, setOrder] = useState([]);
  const [rankNonce, setRankNonce] = useState(0);
  const rowsKey = rows.map(r => r.id).join("|");
  const summarizedRef = useRef(summarized);
  useEffect(() => { summarizedRef.current = summarized; }, [summarized]);
  useEffect(() => {
    setOrder(rankEntries(summarizedRef.current, sort).map(r => r.id));
  }, [sort, rowsKey, rankNonce]);
  const reRank = () => setRankNonce(n => n + 1);

  const sorted = useMemo(() => {
    const byId = new Map(summarized.map(r => [r.id, r]));
    const listed = order.map(id => byId.get(id)).filter(Boolean);
    // Anything the order hasn't caught up with yet (a row added this render)
    // still shows, at the back, rather than disappearing for a tick.
    const seen = new Set(listed.map(r => r.id));
    return [...listed, ...summarized.filter(r => !seen.has(r.id))];
  }, [summarized, order]);

  const lapCols = lapColumnCount(rows, trial?.max_laps);
  const classById = useMemo(() => Object.fromEntries(classes.map(c => [c.id, c])), [classes]);
  // The divisions this session places into: the ones picked when it was created,
  // falling back to every class the season runs.
  const placementClasses = useMemo(() => {
    const picked = (trial?.class_ids || []).map(cid => classById[cid]).filter(Boolean);
    return picked.length ? picked : classes;
  }, [trial?.class_ids, classById, classes]);
  const showPlacement = !!trial && (trial.is_placement || placementClasses.length > 0);
  const completed = trial?.status === "completed";
  const canEdit = isAdmin && !completed;

  // ── Editing ───────────────────────────────────────────────────────────────
  function patchRow(rowId, patch) {
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function setLap(rowId, lapIndex, value) {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const laps = [...(r.laps || [])];
      while (laps.length <= lapIndex) laps.push("");
      laps[lapIndex] = value;
      return { ...r, laps };
    }));
    setDirty(true);
  }

  function addDriver(candidate) {
    setRows(prev => [...prev, blankRow({
      name: candidate.name,
      driver_id: candidate.driver_id || "",
      user_id: candidate.user_id || "",
      entry_id: candidate.entry_id || "",
      number: candidate.number ?? "",
      assigned_class_id: candidate.assigned_class_id || "",
    })]);
    setDirty(true);
  }

  function removeRow(rowId) {
    setRows(prev => prev.filter(r => r.id !== rowId));
    setDirty(true);
  }

  // Fill the division column from the times: the field is ranked by whichever
  // column the sheet is sorted on and split evenly across the chosen divisions,
  // fastest first. It's a starting point, not a verdict — every cell stays
  // editable, and nothing is written until Save.
  function autoAssign() {
    const assignment = autoAssignClasses(summarized, placementClasses.map(c => c.id), { key: sort.key });
    if (!Object.keys(assignment).length) {
      return showToast("error", "Nobody has set a time yet, so there's nothing to sort.");
    }
    setRows(prev => prev.map(r => (assignment[r.id] ? { ...r, assigned_class_id: assignment[r.id] } : r)));
    setDirty(true);
    reRank();
    showToast("success", `Sorted ${Object.keys(assignment).length} drivers into ${placementClasses.length} division${placementClasses.length === 1 ? "" : "s"} by ${sort.key === "average" ? "average" : "best"} time. Review, then Save.`);
  }

  async function save() {
    setBusy(true);
    try {
      const payload = rows.map(r => ({
        // A row that has never been stored sends no id, so the server mints one.
        ...(r.stored ? { id: r.id } : {}),
        name: r.name, number: r.number, driver_id: r.driver_id, user_id: r.user_id, entry_id: r.entry_id,
        laps: r.laps, assigned_class_id: r.assigned_class_id, notes: r.notes,
      }));
      const saved = await api(`/api/time-trials/${id}/entries`, { method: "POST", body: { rows: payload } });
      setRows(saved.map(e => ({ ...blankRow(), ...e, stored: true })));
      setDirty(false);
      // Saving is the natural moment to re-rank: the sheet settles into the
      // order the newly-entered laps actually put it in.
      reRank();
      showToast("success", "Session saved.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    try {
      const updated = await api(`/api/time-trials/${id}`, { method: "PATCH", body: { status: "open" } });
      setTrial(t => ({ ...t, ...updated }));
      showToast("success", "Session reopened for entry.");
    } catch (err) {
      showToast("error", err.message);
    }
  }

  function clickSort(key) {
    setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  }
  const arrow = key => (sort.key === key ? (sort.asc ? " ▴" : " ▾") : "");

  if (error) return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>{error}</p></div>;
  if (!trial) return <div className="skeleton" style={{ height: 320 }} />;

  const expandedRow = summarized.find(r => r.id === expanded) || null;

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>⏱ {trial.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {[trial.track, trial.date ? formatRaceDate(trial.date) : null, trial.car,
              trial.max_laps ? `Max ${trial.max_laps} laps` : "Unlimited laps",
              averageLabel(trial.average_laps)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href="/time-trials" style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>All sessions</Link>
          {isAdmin && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Rename the session, change its lap limit, or attach it to a season"
              onClick={() => setSettingsOpen(true)}>
              ⚙ Settings
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Copy these best laps onto a scheduled race as its official Qualifying results"
              onClick={() => setExporting(true)}>
              ⇥ Export to Qualifying
            </button>
          )}
          {isAdmin && (completed ? (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={reopen}>
              Reopen Session
            </button>
          ) : (
            <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
              title="Close this session and, if you want, build the official roster from it"
              onClick={() => setCompleting(true)}>
              ✓ Complete Session
            </button>
          ))}
        </div>
      </div>

      {completed && (
        <div className="class-scope-banner" style={{ marginTop: 12 }}>
          <span className="class-scope-chip">Completed</span>
          <span>
            This session is closed for entry. It stays available to{" "}
            <strong>Export to Qualifying</strong> and to the <strong>Import from Time Trial</strong>{" "}
            button on any race&rsquo;s Qualifying tab. Reopen it to change a lap.
          </span>
        </div>
      )}

      {trial.notes && (
        <p style={{ marginTop: 12, fontSize: "0.86rem", color: "var(--ink-1)" }}>{trial.notes}</p>
      )}

      <div className="bonus-panel" style={{ marginTop: 14 }}>
        <div className="bonus-panel-title">Time trials don&rsquo;t touch the record books the way races do</div>
        <p className="bonus-panel-note" style={{ marginTop: 4 }}>
          Nothing here counts toward Wins, Top 5s, Average Finish, Championships or any other racing
          statistic — a hot-lap session isn&rsquo;t a race. The laps <strong>are</strong> eligible for
          the Global / Series / Class <Link href="/records" style={{ color: "var(--accent-cyan)" }}>Track Records</Link>,
          and they become official results only when you deliberately export them to a race&rsquo;s
          qualifying.
        </p>
      </div>

      {showPlacement && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
          <div className="field" style={{ margin: 0, maxWidth: 420 }}>
            <span className="field-label">Divisions</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {placementClasses.length
                ? placementClasses.map(c => {
                  const n = summarized.filter(r => r.assigned_class_id === c.id).length;
                  return <span key={c.id} className="class-scope-chip">{c.name} · {n}</span>;
                })
                : <span style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>
                  This session isn&rsquo;t attached to a season with classes yet — pick the season when you
                  complete it.
                </span>}
              {summarized.some(r => !r.assigned_class_id) && (
                <span className="page-badge is-muted">
                  {summarized.filter(r => !r.assigned_class_id).length} unassigned
                </span>
              )}
            </div>
          </div>
          {canEdit && placementClasses.length > 0 && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Split the ranked field evenly across the divisions, fastest first. You can still change any row."
              onClick={autoAssign}>
              ⇅ Sort into divisions by time
            </button>
          )}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="sticky-col">Driver</th>
              {showPlacement && <th style={{ textAlign: "left" }}>Division</th>}
              <th className="sortable" onClick={() => clickSort("best")}
                title="The driver's single fastest lap. Click to sort.">Best Time{arrow("best")}</th>
              <th className="sortable" onClick={() => clickSort("average")}
                title={`${averageLabel(trial.average_laps)}. Click to sort.`}>
                {averageLabel(trial.average_laps)}{arrow("average")}
              </th>
              <th>Laps</th>
              {Array.from({ length: lapCols }, (_, i) => <th key={i}>L{i + 1}</th>)}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5 + lapCols + (showPlacement ? 1 : 0)} style={{ color: "var(--ink-2)" }}>
                  No drivers on this sheet yet.{canEdit ? " Add one below." : ""}
                </td>
              </tr>
            )}
            {sorted.map((row, i) => (
              <tr key={row.id}>
                <td className="sticky-col" style={{ textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* The medals mean "quickest here", so they only appear when
                        the sheet is actually in best-first order. Flip a column
                        to slowest-first and the badges go plain rather than
                        crowning the slowest driver. */}
                    <span className={`rank-badge rank-${sort.asc && i === 0 ? "p1" : sort.asc && i === 1 ? "p2" : sort.asc && i === 2 ? "p3" : "default"}`}>
                      {row.best_seconds == null ? "—" : i + 1}
                    </span>
                    <button type="button" className="btn btn-ghost"
                      style={{ marginTop: 0, padding: "2px 6px", color: "var(--accent-cyan)", fontWeight: 600 }}
                      title="Show every lap this driver submitted"
                      onClick={() => setExpanded(row.id)}>
                      {row.name || <em style={{ color: "var(--ink-2)" }}>Unnamed</em>}
                      {row.number ? <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{row.number}</span> : null}
                    </button>
                  </div>
                </td>
                {showPlacement && (
                  <td style={{ textAlign: "left" }}>
                    {canEdit && placementClasses.length > 0 ? (
                      <select value={row.assigned_class_id || ""} style={{ minWidth: 130 }}
                        onChange={e => patchRow(row.id, { assigned_class_id: e.target.value })}>
                        <option value="">Unassigned</option>
                        {placementClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      row.assigned_class_id
                        ? <span className="class-scope-chip">{classById[row.assigned_class_id]?.name || "Class"}</span>
                        : <span style={{ color: "var(--ink-2)" }}>—</span>
                    )}
                  </td>
                )}
                <td style={{ fontWeight: 700, color: row.best_time ? "var(--accent-gold)" : "var(--ink-2)" }}>
                  {row.best_time || "—"}
                </td>
                <td>{row.avg_time || <span style={{ color: "var(--ink-2)" }}>—</span>}</td>
                <td>{row.laps_timed}</td>
                {Array.from({ length: lapCols }, (_, lapIdx) => {
                  const text = row.laps[lapIdx] ?? "";
                  // The driver's fastest lap, bolded automatically — derived
                  // from the laps themselves, never ticked by hand.
                  const isBest = row.best_lap === lapIdx + 1;
                  return (
                    <td key={lapIdx} style={{ padding: canEdit ? "4px 6px" : undefined }}>
                      {canEdit ? (
                        <input value={text} placeholder="—" inputMode="decimal"
                          style={{
                            width: 82, padding: "4px 6px", textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: isBest ? 700 : 400,
                            color: isBest ? "var(--accent-gold)" : undefined,
                          }}
                          title={isBest ? "This driver's fastest lap" : "Lap time, e.g. 1:23.456"}
                          onChange={e => setLap(row.id, lapIdx, e.target.value)} />
                      ) : (
                        <span style={{ fontWeight: isBest ? 700 : 400, color: isBest ? "var(--accent-gold)" : undefined }}>
                          {text || "—"}
                        </span>
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td>
                    <button className="icon-btn icon-btn-danger" type="button" title={`Remove ${row.name || "this driver"}`}
                      onClick={() => removeRow(row.id)}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <>
          <AddDriverBar
            pool={pool}
            taken={new Set(rows.map(r => String(r.name || "").trim().toLowerCase()).filter(Boolean))}
            onAdd={addDriver}
            disabled={busy}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save Session"}
            </button>
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={reRank}
              title="Re-order the sheet by the laps entered since it was last ranked">
              ⇅ Re-sort now
            </button>
            {dirty && <span style={{ fontSize: "0.8rem", color: "var(--accent-gold)" }}>Unsaved changes</span>}
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>
              Lap times take any clock format — <code>1:23.456</code>, <code>83.456</code>,{" "}
              <code>1:02:03.004</code>. The sheet holds its order while you type; it re-ranks when
              you sort, re-sort or save.
            </span>
          </div>
        </>
      )}

      {expandedRow && (
        <TimeTrialLapsModal
          entry={expandedRow}
          averageLaps={trial.average_laps}
          className={classById[expandedRow.assigned_class_id]?.name || ""}
          onClose={() => setExpanded(null)}
        />
      )}

      {completing && (
        <CompleteTimeTrialModal
          trial={trial}
          seasons={seasons}
          onClose={() => setCompleting(false)}
          onCompleted={(updated, res) => {
            setTrial(t => ({ ...t, ...updated }));
            // A roster run leaves the dialog open on its own summary of what it
            // wrote — the admin closes it when they've read it. "Complete only"
            // has nothing to report and closes itself.
            showToast("success", res
              ? `Roster updated — ${res.created} added, ${res.updated} re-classed.`
              : "Session completed.");
          }}
        />
      )}

      {settingsOpen && (
        <TimeTrialSettingsModal
          trial={trial}
          seasons={seasons}
          onClose={() => setSettingsOpen(false)}
          onSaved={updated => {
            setSettingsOpen(false);
            setTrial(t => ({ ...t, ...updated }));
            // A season change brings a different set of divisions with it, so
            // the sheet is re-read rather than patched.
            load();
            showToast("success", "Session settings saved.");
          }}
        />
      )}

      {exporting && (
        <ExportQualifyingModal
          trial={trial}
          seasons={seasons}
          onClose={() => setExporting(false)}
          onExported={() => router.refresh()}
        />
      )}
    </section>
  );
}
