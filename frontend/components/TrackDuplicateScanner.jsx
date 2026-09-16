"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { planGroupMerge } from "@/lib/trackMerge";

// The Tracks cleanup bench: find every circuit that is in the pool more than
// once, and fold each one back into a single venue.
//
// Why this exists. The Tracks database is filled in by hand, by whoever is
// setting up that week's round, so the same circuit arrives under whatever
// they typed — "Daytona", "Daytona Intl Speedway", "DAYTONA INTERNATIONAL
// SPEEDWAY". Each one is a separate venue as far as the app is concerned, and
// a venue's whole history is derived from the races pointing at it, so a
// circuit split four ways reports four small wrong histories. A driver with
// six Daytona wins shows two here and four there, and the per-track stats
// everybody actually looks at are quietly nonsense.
//
// Merging has always been possible one pair at a time. What was missing is the
// part nobody does by hand: reading three hundred names and noticing which of
// them are the same place. So the scan does that (lib/trackMerge.js), and this
// screen is the review — the same bargain the SimRacerHub driver import makes.
// It does the searching and proposes the answer; a human confirms it.
//
// Nothing here merges on its own. Every group is ticked, named and pressed by
// an admin, because the one mistake this tool could make is the expensive one:
// welding two DIFFERENT circuits together — Richmond Raceway onto Richmond
// Dragway, or a venue's road course onto its oval — is not undone by a press.
// So anything the scan is not certain about arrives unticked with the reason
// written on the row, and the merge is previewed against the real database
// before it runs.

const TYPE_BADGE = { exact: "Same name", strong: "Very close", possible: "Worth checking" };

// A venue's details on one line, the way an admin checks "is this the same
// place?" — location first, because that is the question.
function detailLine(track) {
  const bits = [track.location, track.track_type, track.length].filter(Boolean);
  return bits.length ? bits.join(" · ") : "No location, type or length on file";
}

function raceCount(n) {
  return `${n} race${n === 1 ? "" : "s"}`;
}

// One circuit's worth of duplicates: the copies found, which one survives, what
// the merged venue ends up called, and what the merge would actually do.
//
// Exported so the review itself can be rendered and read in a test
// (lib/__tests__/trackDuplicateFlow.test.jsx) — the scanner around it lives in
// a Modal, which renders nothing until it has mounted in a browser.
export function GroupPanel({ group, open, onToggle, edit, onEdit, preview, previewing, busy, done, error, onMerge, onSkip }) {
  const survivor = group.tracks.find(t => t.id === edit.survivorId) || group.tracks[0];
  const checked = group.tracks.filter(t => t.id !== edit.survivorId && edit.checked.includes(t.id));
  const plan = planGroupMerge(group, { survivorId: edit.survivorId, checkedIds: edit.checked, name: edit.name });

  if (done) {
    return (
      <div className="bonus-panel" style={{ opacity: 0.75 }}>
        <div className="bonus-panel-title">✓ {done.track.name}</div>
        <p className="bonus-panel-note" style={{ marginTop: 4 }}>
          {done.tracks_merged} duplicate{done.tracks_merged === 1 ? "" : "s"} folded in
          {done.races_moved ? `, ${raceCount(done.races_moved)} moved across` : ", nothing had raced at them"}
          {done.races_renamed ? ` and ${done.races_renamed} relabelled` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="bonus-panel">
      <button type="button" className="list-group-header" onClick={onToggle} aria-expanded={open}
        style={{ width: "100%" }}>
        <span className="list-group-caret" style={{ transform: open ? "none" : "rotate(-90deg)" }}>▾</span>
        <span className="list-group-title">{edit.name || group.suggested_name}</span>
        <span className="list-group-count">{group.tracks.length} copies</span>
        {!group.clean && <span className="page-badge is-muted" style={{ marginLeft: 8 }}>Needs a look</span>}
      </button>

      {open && (
        <>
          <p className="bonus-panel-note" style={{ marginTop: 8 }}>
            {group.clean
              ? `These all look like one circuit. ${raceCount(group.races)} in total are filed across them.`
              : `These came up together, but they don't all agree. ${raceCount(group.races)} are filed across them — read the notes before ticking.`}
          </p>

          <div className="list-rows" style={{ marginTop: 10 }}>
            {group.tracks.map(t => {
              const isSurvivor = t.id === edit.survivorId;
              const ticked = isSurvivor || edit.checked.includes(t.id);
              return (
                <div key={t.id} className="list-row actions-inline"
                  style={{ alignItems: "flex-start", opacity: ticked ? 1 : 0.65 }}>
                  <label htmlFor={`dupe_${t.id}`} className="check-row check-row-center"
                    style={{
                      gap: 10, flex: 1, minWidth: 0, cursor: isSurvivor ? "default" : "pointer",
                      fontWeight: 400, textTransform: "none", letterSpacing: 0, margin: 0,
                    }}>
                    <input type="checkbox" id={`dupe_${t.id}`} checked={ticked} disabled={isSurvivor || busy}
                      onChange={() => onEdit(e => ({
                        ...e,
                        checked: e.checked.includes(t.id) ? e.checked.filter(x => x !== t.id) : [...e.checked, t.id],
                      }))} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: "var(--ink-0)", fontSize: "0.9rem" }}>
                        {t.name}
                        {isSurvivor && <span className="page-badge" style={{ marginLeft: 8 }}>Keeping this one</span>}
                      </span>
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>
                        {detailLine(t)} · {raceCount(t.races)}
                      </span>
                      {!isSurvivor && (
                        <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem", marginTop: 2 }}>
                          {TYPE_BADGE[t.confidence] || "Worth checking"} — {t.reason}
                          {t.matched_on ? ` · matched on ${t.matched_on}` : ""}
                        </span>
                      )}
                      {t.conflict && (
                        <span style={{ display: "block", color: "var(--accent-gold, #d29922)", fontSize: "0.76rem", marginTop: 4 }}>
                          ⚠ {t.conflict}
                        </span>
                      )}
                    </span>
                  </label>
                  {!isSurvivor && (
                    <button type="button" className="btn btn-ghost" style={{ marginTop: 0, whiteSpace: "nowrap" }}
                      disabled={busy} title="Keep this venue instead — it survives the merge and every link to it still works"
                      onClick={() => onEdit(e => ({
                        // The old survivor becomes one of the copies folded in,
                        // so swapping never quietly drops it out of the merge.
                        ...e,
                        survivorId: t.id,
                        checked: [...new Set([...e.checked.filter(x => x !== t.id), e.survivorId])],
                      }))}>
                      Keep this one
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor={`dupe_name_${group.key}`}>Name the merged track</label>
            <input id={`dupe_name_${group.key}`} value={edit.name} disabled={busy}
              onChange={ev => onEdit(e => ({ ...e, name: ev.target.value }))}
              placeholder={survivor?.name || ""} />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              What the venue is called afterwards. Every race that moves is relabelled with it, so the
              schedule, the results and the stats all read the same way.
            </span>
          </div>

          {previewing && <div className="skeleton" style={{ height: 54, marginTop: 10 }} />}

          {!previewing && preview && plan && (
            <div className="bonus-panel-row" style={{ marginTop: 10 }}>
              <span className="bonus-chip">{raceCount(preview.races_moved)} moved</span>
              <span className="bonus-chip">{preview.races_renamed} relabelled</span>
              <span className="bonus-chip">
                {preview.tracks_merged} venue{preview.tracks_merged === 1 ? "" : "s"} removed
              </span>
              {preview.filled?.length > 0 && (
                <span className="bonus-chip">fills in {preview.filled.join(", ")}</span>
              )}
            </div>
          )}

          {!previewing && preview && (
            <p className="bonus-panel-note">
              Nothing is deleted from the record books: the past winners, the venue leaderboard, the lap
              records and every driver&rsquo;s stats here are all worked out from those races, so they
              travel with them onto <strong>{plan?.name || survivor?.name}</strong>.
            </p>
          )}

          {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

          <button className="btn btn-primary" type="button" disabled={busy || !plan || previewing} onClick={onMerge}>
            {busy ? "Merging…" : plan
              ? `Merge ${checked.length} into “${plan.name}”`
              : "Tick the duplicates to merge"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onSkip}>
            Leave these alone
          </button>
        </>
      )}
    </div>
  );
}

export function TrackDuplicateScanner({ onClose, onMerged }) {
  const [scan, setScan] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [edits, setEdits] = useState({});       // group key -> { survivorId, checked, name }
  const [done, setDone] = useState({});         // group key -> merge response
  const [skipped, setSkipped] = useState([]);   // group keys the admin left alone
  const [openKey, setOpenKey] = useState(null);
  const [previews, setPreviews] = useState({});
  const [previewing, setPreviewing] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [errors, setErrors] = useState({});
  const [runningAll, setRunningAll] = useState(false);

  const load = useCallback(async () => {
    setScan(null);
    setLoadError(null);
    // A fresh scan is a fresh sitting. What was merged is gone from the pool and
    // what was left alone comes back as a group to decide again, so none of the
    // previous run's answers carry over — and their keys point at tracks that
    // may no longer exist.
    setDone({});
    setSkipped([]);
    setPreviews({});
    setErrors({});
    try {
      const res = await api("/api/admin/tracks/duplicates");
      setScan(res);
      // Each group starts on the scan's own answer: the busiest venue survives,
      // the copies it is sure about are ticked, the ones it isn't are not.
      setEdits(Object.fromEntries(res.groups.map(g => [g.key, {
        survivorId: g.survivor_id,
        checked: g.tracks.filter(t => t.suggested && t.id !== g.survivor_id).map(t => t.id),
        name: g.suggested_name,
      }])));
      setOpenKey(res.groups[0]?.key ?? null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = scan?.groups || [];
  const pending = groups.filter(g => !done[g.key] && !skipped.includes(g.key));
  const cleanPending = pending.filter(g => g.clean);

  const editFor = key => edits[key] || { survivorId: "", checked: [], name: "" };
  const setEdit = (key, fn) => setEdits(prev => ({ ...prev, [key]: fn(prev[key]) }));

  // Ask the server what the open group's merge would actually do, from the same
  // code that would do it. The admin approves a real number, not an estimate.
  const open = groups.find(g => g.key === openKey);
  const openEdit = open ? editFor(open.key) : null;
  const openPlan = open && openEdit
    ? planGroupMerge(open, { survivorId: openEdit.survivorId, checkedIds: openEdit.checked, name: openEdit.name })
    : null;
  const planKey = openPlan ? JSON.stringify(openPlan) : "";

  useEffect(() => {
    // Not while a merge is in flight: "merge every clear group" walks the list
    // and the tracks a preview would ask about are being deleted underneath it.
    if (!open || !openPlan || done[open.key] || busyKey || runningAll) return;
    let live = true;
    setPreviewing(open.key);
    // Debounced: the name field is a text input, and every keystroke changes
    // the plan.
    const timer = setTimeout(() => {
      api("/api/admin/tracks/merge", { method: "POST", body: { ...openPlan, dry_run: true } })
        .then(res => { if (live) setPreviews(p => ({ ...p, [open.key]: res })); })
        .catch(err => { if (live) setErrors(e => ({ ...e, [open.key]: err.message })); })
        .finally(() => { if (live) setPreviewing(null); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, openKey, busyKey, runningAll]);

  // Run one group's merge. Returns the response so "merge every clean group"
  // can run them one after another and keep a running total.
  const mergeGroup = useCallback(async (group) => {
    const edit = edits[group.key];
    const plan = planGroupMerge(group, { survivorId: edit.survivorId, checkedIds: edit.checked, name: edit.name });
    if (!plan) return null;
    setBusyKey(group.key);
    setErrors(e => ({ ...e, [group.key]: null }));
    try {
      const res = await api("/api/admin/tracks/merge", { method: "POST", body: plan });
      setDone(d => ({ ...d, [group.key]: res }));
      onMerged?.(res);
      return res;
    } catch (err) {
      setErrors(e => ({ ...e, [group.key]: err.message }));
      return null;
    } finally {
      setBusyKey(null);
    }
  }, [edits, onMerged]);

  // The one press the whole feature is named after — but only over the groups
  // the scan had nothing to say about. A group where the names disagree about
  // the layout, or where one venue merely sits inside another's name, is never
  // swept up by it: those are the ones a human has to look at, and they stay
  // waiting afterwards.
  async function mergeAllClean() {
    const total = cleanPending.reduce((n, g) => n + g.tracks.length - 1, 0);
    if (!window.confirm(
      `Merge ${cleanPending.length} group${cleanPending.length === 1 ? "" : "s"}, folding ${total} duplicate ` +
      `venue${total === 1 ? "" : "s"} into ${cleanPending.length} track${cleanPending.length === 1 ? "" : "s"}?\n\n` +
      `Every race held at them moves across and keeps its results, and each merged venue takes the name ` +
      `shown. Groups that need a look are left for you.\n\nThis can't be undone from here.`
    )) return;
    setRunningAll(true);
    for (const group of cleanPending) {
      setOpenKey(group.key);
      const res = await mergeGroup(group);
      if (!res) break;     // stop on the first failure rather than ploughing on
    }
    setRunningAll(false);
  }

  const mergedCount = Object.values(done).reduce((n, r) => n + (r.tracks_merged || 0), 0);
  const movedCount = Object.values(done).reduce((n, r) => n + (r.races_moved || 0), 0);
  const reviewed = groups.length - pending.length;

  return (
    <Modal wide title="Duplicate Tracks" onClose={busyKey || runningAll ? () => {} : onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
        The same circuit gets typed in again every time somebody sets up a round there, so one venue
        ends up in the pool as three. That splits its history three ways — the leaderboard, the past
        winners, the lap records and every driver&rsquo;s stats here are all worked out from the races
        pointing at it. This finds the copies and folds them back into one, without losing a race.
      </p>

      {scan === null && !loadError && (
        <div className="skeleton" style={{ height: 120 }} />
      )}

      {loadError && (
        <>
          <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {loadError}</p>
          <button className="btn btn-ghost" type="button" onClick={load}>Try again</button>
        </>
      )}

      {scan && groups.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon">✓</span>
          <p>
            No duplicates. All {scan.tracks_scanned} venue{scan.tracks_scanned === 1 ? "" : "s"} in the pool
            look like different circuits, so every track&rsquo;s stats are already counted in one place.
          </p>
        </div>
      )}

      {scan && groups.length > 0 && (
        <>
          <div className="bonus-panel-row" style={{ marginTop: 4 }}>
            <span className="bonus-chip">{scan.tracks_scanned} venues read</span>
            <span className="bonus-chip">
              {groups.length} circuit{groups.length === 1 ? "" : "s"} listed more than once
            </span>
            {reviewed > 0 && <span className="bonus-chip">{reviewed} of {groups.length} done</span>}
            {mergedCount > 0 && (
              <span className="bonus-chip">{mergedCount} folded in · {raceCount(movedCount)} moved</span>
            )}
          </div>

          {cleanPending.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" type="button" disabled={!!busyKey || runningAll}
                onClick={mergeAllClean}>
                {runningAll ? "Merging…" : `Merge the ${cleanPending.length} clear group${cleanPending.length === 1 ? "" : "s"}`}
              </button>
              <span style={{ marginLeft: 10, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                {pending.length > cleanPending.length
                  ? `The other ${pending.length - cleanPending.length} need a look first and are left as they are.`
                  : "Every group below, in one press — open one first if you'd rather check it yourself."}
              </span>
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {groups.map(g => (
              <GroupPanel
                key={g.key}
                group={g}
                open={openKey === g.key}
                onToggle={() => setOpenKey(k => (k === g.key ? null : g.key))}
                edit={editFor(g.key)}
                onEdit={fn => setEdit(g.key, fn)}
                preview={previews[g.key]}
                previewing={previewing === g.key}
                busy={busyKey === g.key || runningAll}
                done={done[g.key]}
                error={errors[g.key]}
                onMerge={() => mergeGroup(g)}
                onSkip={() => {
                  setSkipped(s => [...s, g.key]);
                  setOpenKey(pending.find(p => p.key !== g.key)?.key ?? null);
                }}
              />
            ))}
          </div>

          {skipped.length > 0 && pending.length === 0 && (
            <p style={{ marginTop: 12, fontSize: "0.82rem", color: "var(--ink-2)" }}>
              {skipped.length} group{skipped.length === 1 ? "" : "s"} left alone. They stay in the pool as
              they are, and this will find them again next time.
            </p>
          )}
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" type="button" disabled={!!busyKey || runningAll} onClick={onClose}>
          {pending.length === 0 && groups.length > 0 ? "Done" : "Close"}
        </button>
        {scan && groups.length > 0 && (
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
            disabled={!!busyKey || runningAll} onClick={load}>
            Scan again
          </button>
        )}
      </div>
    </Modal>
  );
}
