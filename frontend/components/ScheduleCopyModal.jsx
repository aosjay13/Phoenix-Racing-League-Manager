"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Copy a whole season's SCHEDULE into another season, in the same series or a
// different one.
//
// The same job Copy Race does, done for every round at once — and it is the
// same request, the same planner and the same rules underneath (see
// app/api/races/copy/route.js). A league running the same calendar in two
// classes, or carrying last year's twelve rounds into next year's season, was
// otherwise doing Copy Race twelve times.
//
// Both ends are pickable, as they are there, so the one dialog covers both
// directions: pulling a calendar into the season being built, and pushing the
// one on screen somewhere else. It opens on the season the admin is standing in
// as the SOURCE.
//
// The one place it deliberately differs: a schedule copies WITHOUT last
// season's results unless they are asked for. "Copy the schedule" means the
// calendar — a dozen rounds of someone else's results arriving in a new class's
// season is a great deal to undo, and nothing about the phrase suggests it.
// Copy Race keeps its own default, because one event is usually copied for the
// results it scored.
export function ScheduleCopyModal({ seasonId, onClose, onCopied }) {
  const [seasons, setSeasons] = useState(null);
  const [fromSeasonId, setFromSeasonId] = useState(seasonId || "");
  const [toSeasonId, setToSeasonId] = useState("");
  const [races, setRaces] = useState(null);
  const [includeResults, setIncludeResults] = useState(false);
  const [addMissing, setAddMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // the server's report, once the copy has run

  useEffect(() => {
    api("/api/races/copy")
      .then(d => setSeasons(d.seasons || []))
      .catch(err => { setSeasons([]); setError(err.message); });
  }, []);

  // The chosen source season's rounds, so the dialog can show what is about to
  // be copied rather than a number. Refetched whenever the source changes.
  useEffect(() => {
    setRaces(null);
    if (!fromSeasonId) return undefined;
    let alive = true;
    api(`/api/races/copy?season_id=${fromSeasonId}`)
      .then(d => { if (alive) setRaces(d.races || []); })
      .catch(() => { if (alive) setRaces([]); });
    return () => { alive = false; };
  }, [fromSeasonId]);

  // Default the destination to the season the admin is standing in the moment
  // they pick a different one to copy FROM — the "pull that calendar into this
  // season" flow, which saves the second dropdown entirely.
  useEffect(() => {
    if (!toSeasonId && seasonId && fromSeasonId && fromSeasonId !== seasonId) setToSeasonId(seasonId);
  }, [fromSeasonId, seasonId, toSeasonId]);

  // Seasons grouped for the dropdowns: one <optgroup> per game · series.
  const groups = useMemo(() => {
    const out = [];
    for (const s of seasons || []) {
      const label = [s.game_name, s.series_name].filter(Boolean).join(" · ") || "Unfiled";
      const group = out.find(g => g.label === label) || (out.push({ label, seasons: [] }), out[out.length - 1]);
      group.seasons.push(s);
    }
    return out;
  }, [seasons]);

  const seasonById = useMemo(
    () => Object.fromEntries((seasons || []).map(s => [s.id, s])),
    [seasons]
  );
  const target = seasonById[toSeasonId] || null;
  const source = seasonById[fromSeasonId] || null;
  const sameSeason = !!fromSeasonId && fromSeasonId === toSeasonId;
  const crossSeries = !!source && !!target && source.series_id !== target.series_id;
  const withResults = (races || []).filter(r => r.has_results).length;
  // Into an empty season the copies keep their own round numbers; into one that
  // already has rounds they continue from the last, since two rounds sharing a
  // number would order the calendar by chance.
  const targetHasRaces = (target?.race_count || 0) > 0;

  const seasonOptions = () => groups.map(g => (
    <optgroup key={g.label} label={g.label}>
      {g.seasons.map(s => (
        <option key={s.id} value={s.id}>
          {s.name}{s.status === "completed" ? " (completed)" : ""} — {s.race_count} event{s.race_count === 1 ? "" : "s"}
        </option>
      ))}
    </optgroup>
  ));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const report = await api("/api/races/copy", {
        method: "POST",
        body: {
          from_season_id: fromSeasonId,
          to_season_id: toSeasonId,
          include_results: includeResults,
          add_missing_drivers: addMissing,
        },
      });
      setDone(report);
      onCopied?.(report);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── The report, once it's run ────────────────────────────────────────────
  if (done) {
    const skipped = done.skipped_drivers || [];
    return (
      <Modal title="Schedule copied" onClose={onClose}>
        <p style={{ fontSize: "0.9rem" }}>
          <strong>{done.races_copied}</strong> round{done.races_copied === 1 ? "" : "s"} copied into{" "}
          <strong>{target?.name || "the target season"}</strong>
          {done.results_copied > 0
            ? <> with <strong>{done.results_copied}</strong> result{done.results_copied === 1 ? "" : "s"}.</>
            : <> as empty events, ready for results.</>}
        </p>
        <ul style={{ fontSize: "0.85rem", color: "var(--ink-1)", paddingLeft: 18, margin: "8px 0" }}>
          <li>
            {done.kept_round_numbers
              ? "The rounds kept their own numbers, so the calendar reads exactly as the one you copied."
              : "That season already had rounds, so these were added after them."}
          </li>
          {done.drivers_created > 0 && (
            <li>{done.drivers_created} driver{done.drivers_created === 1 ? " was" : "s were"} added to that season&rsquo;s roster.</li>
          )}
          {skipped.length > 0 && (
            <li style={{ color: "var(--accent-amber, #d29922)" }}>
              Skipped {done.results_skipped} result{done.results_skipped === 1 ? "" : "s"} — not on the target
              roster: {skipped.slice(0, 8).join(", ")}{skipped.length > 8 ? `, +${skipped.length - 8} more` : ""}.
            </li>
          )}
          {done.unmapped_classes > 0 && (
            <li>
              {done.unmapped_classes} class{done.unmapped_classes === 1 ? "" : "es"} the target season doesn&rsquo;t run —
              those results copied over unclassified. Set their class on the results grid if it matters.
            </li>
          )}
          <li>Tracks, dates, distances, sessions and each session&rsquo;s points structure came across with every round.</li>
        </ul>
        <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Copy Schedule" onClose={onClose}>
      <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--ink-1)" }}>
        Copies every round of a season&rsquo;s calendar into another season — in this series or any other.
        Each round keeps its name, date, track, distance, sessions and points structures. Classes are
        matched to the target season by name, as they are when you copy a single race.
      </p>
      <form onSubmit={handleSubmit}>
        {seasons == null ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <>
            <div className="field"><label>Copy the schedule from</label>
              <select value={fromSeasonId} onChange={e => setFromSeasonId(e.target.value)} required>
                <option value="">— pick a season —</option>
                {seasonOptions()}
              </select>
              {races != null && (
                <span style={{ fontSize: "0.78rem", color: races.length ? "var(--ink-2)" : "#e5484d" }}>
                  {races.length
                    ? `${races.length} round${races.length === 1 ? "" : "s"}: ${races.slice(0, 4).map(r => r.name).join(", ")}${races.length > 4 ? `, +${races.length - 4} more` : ""}`
                    : "That season has no rounds to copy."}
                </span>
              )}</div>

            <div className="field"><label>Copy into season</label>
              <select value={toSeasonId} onChange={e => setToSeasonId(e.target.value)} required>
                <option value="">— pick a season —</option>
                {seasonOptions()}
              </select>
              {sameSeason && (
                <span style={{ fontSize: "0.78rem", color: "#e5484d" }}>
                  Pick a different season than the one you&rsquo;re copying from.
                </span>
              )}
              {!sameSeason && target && (
                <span style={{ fontSize: "0.78rem", color: targetHasRaces ? "var(--accent-amber, #d29922)" : "var(--ink-2)" }}>
                  {targetHasRaces
                    ? `${target.name} already has ${target.race_count} round${target.race_count === 1 ? "" : "s"} — these are added after them, numbered on from the last. Nothing there is replaced.`
                    : `${target.name} is empty, so the rounds keep their own numbers and the calendar reads exactly as the one you copied.`}
                </span>
              )}
              {!sameSeason && crossSeries && (
                <span style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Different series — the whole calendar comes across, and any class it is pinned to is matched
                  by name.
                </span>
              )}</div>

            <div className="field check-row">
              <input type="checkbox" id="copy_schedule_results" checked={includeResults}
                onChange={e => setIncludeResults(e.target.checked)} />
              <label htmlFor="copy_schedule_results" style={{ margin: 0 }}>
                Copy the results too
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off by default: copying a schedule means the calendar, and a season&rsquo;s worth of someone
                  else&rsquo;s results is a lot to undo. On, every session of every round comes across — finishing
                  positions, times, laps, flags and the points system each was scored under.
                  {withResults > 0
                    ? ` ${withResults} of these rounds ${withResults === 1 ? "has" : "have"} saved results.`
                    : " None of these rounds has saved results yet."}
                </span>
              </label>
            </div>

            {includeResults && (
              <div className="field check-row">
                <input type="checkbox" id="copy_schedule_drivers" checked={addMissing}
                  onChange={e => setAddMissing(e.target.checked)} />
                <label htmlFor="copy_schedule_drivers" style={{ margin: 0 }}>
                  Add missing drivers to that season&rsquo;s roster
                  <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                    Drivers who scored in these rounds but aren&rsquo;t on the target roster are added to it, keeping
                    their car number and driver profile. Off: their results are skipped and listed for you.
                  </span>
                </label>
              </div>
            )}
          </>
        )}

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit"
          disabled={busy || !fromSeasonId || !toSeasonId || sameSeason || (races != null && !races.length)}>
          {busy ? "Copying…" : races?.length ? `Copy ${races.length} round${races.length === 1 ? "" : "s"}` : "Copy Schedule"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
