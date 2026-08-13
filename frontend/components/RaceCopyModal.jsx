"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { formatRaceDate } from "@/lib/raceDate";

// Copy an event — and the results it scored — from one season into another, in
// the same series or a different one.
//
// Both ends are pickable, so the one dialog covers both directions an admin
// actually wants: pulling last year's round into the season they're building,
// and pushing the round they're looking at somewhere else. It opens on the
// season they're standing in as the SOURCE, since that's the calendar in front
// of them, and the copy lands wherever they point "Copy into".
//
// The season dropdowns are grouped by game and series (an <optgroup> per
// series), which is what makes "a different series" no harder to pick than the
// season next door. Both lists come from GET /api/races/copy in one read.
export function RaceCopyModal({ seasonId, onClose, onCopied }) {
  const [seasons, setSeasons] = useState(null);
  const [fromSeasonId, setFromSeasonId] = useState(seasonId || "");
  const [toSeasonId, setToSeasonId] = useState("");
  const [races, setRaces] = useState(null);
  const [raceId, setRaceId] = useState("");
  const [includeResults, setIncludeResults] = useState(true);
  const [addMissing, setAddMissing] = useState(true);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // the server's report, once the copy has run

  useEffect(() => {
    api("/api/races/copy")
      .then(d => setSeasons(d.seasons || []))
      .catch(err => { setSeasons([]); setError(err.message); });
  }, []);

  // The chosen source season's events. Cleared and refetched whenever the
  // source changes, so the race dropdown can never show another season's rounds.
  useEffect(() => {
    setRaces(null);
    setRaceId("");
    if (!fromSeasonId) return;
    let alive = true;
    api(`/api/races/copy?season_id=${fromSeasonId}`)
      .then(d => { if (alive) setRaces(d.races || []); })
      .catch(() => { if (alive) setRaces([]); });
    return () => { alive = false; };
  }, [fromSeasonId]);

  // Default the destination to the season the admin is standing in the moment
  // they pick a different one to copy FROM — that's the "pull last year's round
  // into this season" flow, and it saves the second dropdown entirely.
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
  const race = (races || []).find(r => r.id === raceId) || null;
  const target = seasonById[toSeasonId] || null;
  const source = seasonById[fromSeasonId] || null;
  const sameSeason = !!fromSeasonId && fromSeasonId === toSeasonId;
  const crossSeries = !!source && !!target && source.series_id !== target.series_id;

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
          race_id: raceId,
          to_season_id: toSeasonId,
          include_results: includeResults,
          add_missing_drivers: addMissing,
          name: name.trim() || null,
          date: date || null,
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
      <Modal title="Race copied" onClose={onClose}>
        <p style={{ fontSize: "0.9rem" }}>
          <strong>{done.race?.name}</strong> is now Round {done.race?.round_number} of{" "}
          <strong>{target?.name || "the target season"}</strong>
          {done.results_copied > 0
            ? <> with <strong>{done.results_copied}</strong> result{done.results_copied === 1 ? "" : "s"}.</>
            : <> as an empty event — no results were copied.</>}
        </p>
        <ul style={{ fontSize: "0.85rem", color: "var(--ink-1)", paddingLeft: 18, margin: "8px 0" }}>
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
          <li>Points, Skill Ratings and standings recalculate from the copied results automatically.</li>
        </ul>
        <button className="btn btn-primary" type="button" onClick={onClose}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Copy Race" onClose={onClose}>
      <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--ink-1)" }}>
        Copies an event and the results it scored into another season — in this series or any other.
        Drivers are matched to the target season&rsquo;s roster by their driver profile, linked account
        or name; classes are matched by name.
      </p>
      <form onSubmit={handleSubmit}>
        {seasons == null ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <>
            <div className="field"><label>Copy from season</label>
              <select value={fromSeasonId} onChange={e => setFromSeasonId(e.target.value)} required>
                <option value="">— pick a season —</option>
                {seasonOptions()}
              </select></div>

            <div className="field"><label>Race to copy</label>
              <select value={raceId} onChange={e => setRaceId(e.target.value)} required disabled={!fromSeasonId || races == null}>
                <option value="">{races == null ? "Loading…" : races.length ? "— pick a race —" : "No events in that season"}</option>
                {(races || []).map(r => (
                  <option key={r.id} value={r.id}>
                    R{r.round_number ?? "?"} · {r.name}
                    {r.date ? ` · ${formatRaceDate(r.date, "short")}` : ""}
                    {r.has_results ? ` · ${r.result_count} results` : " · no results yet"}
                  </option>
                ))}
              </select>
              {race && !race.has_results && (
                <span style={{ fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
                  This event has no saved results — the copy will be an empty calendar entry.
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
              {!sameSeason && crossSeries && (
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Different series — the event, its results and any drivers missing from that roster all come across.
                </span>
              )}</div>

            <div className="field"><label>Rename the copy (optional)</label>
              <input value={name} placeholder={race ? race.name : "Keeps the original name"}
                onChange={e => setName(e.target.value)} /></div>

            <div className="field"><label>New date (optional)</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Blank keeps the original race date. The copy joins the end of the target season&rsquo;s
                calendar as its next round.
              </span></div>

            <div className="field check-row">
              <input type="checkbox" id="copy_results" checked={includeResults}
                onChange={e => setIncludeResults(e.target.checked)} />
              <label htmlFor="copy_results" style={{ margin: 0 }}>
                Copy the results too
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Every session — qualifying, heats, consolations and the race — with finishing positions,
                  times, laps, flags and the points system each was scored under. Off: copies the event
                  only, as a fresh round to enter results into.
                </span>
              </label>
            </div>

            {includeResults && (
              <div className="field check-row">
                <input type="checkbox" id="copy_add_drivers" checked={addMissing}
                  onChange={e => setAddMissing(e.target.checked)} />
                <label htmlFor="copy_add_drivers" style={{ margin: 0 }}>
                  Add missing drivers to that season&rsquo;s roster
                  <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                    Drivers who scored in this race but aren&rsquo;t on the target roster are added to it, keeping
                    their car number and driver profile. Off: their results are skipped and listed for you.
                  </span>
                </label>
              </div>
            )}
          </>
        )}

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !raceId || !toSeasonId || sameSeason}>
          {busy ? "Copying…" : "Copy Race"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
