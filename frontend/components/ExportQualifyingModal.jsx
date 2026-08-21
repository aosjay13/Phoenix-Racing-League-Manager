"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { formatRaceDate, raceDateSortKey } from "@/lib/raceDate";
import { averageLabel, entryIndex, matchEntry, planQualifyingExport, summarizeEntries } from "@/lib/timeTrials";

// "Export to Qualifying" — the bridge from a time trial to a real race weekend.
//
// The trial's order becomes the grid (fastest lap on pole) and each driver's
// best lap is filed as their qualifying time. From that moment they are
// ordinary qualifying results: they score qualifying points, they set poles and
// Average Start, and their laps sit in the record books like any other. That is
// the intent — and it is why the admin picks the event by name and sees exactly
// what will be written first.
export function ExportQualifyingModal({ trial, rows = [], seasons = [], onClose, onExported }) {
  const [seasonId, setSeasonId] = useState(trial.season_id || seasons[0]?.id || "");
  const [target, setTarget] = useState(null);   // { races, entries } for the season
  const [raceId, setRaceId] = useState("");
  const [sortKey, setSortKey] = useState(trial.sort_key === "average" ? "average" : "best");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // The target season's calendar and its roster — raw, both of them. The roster
  // is what decides who can be exported at all: a result is filed against a
  // roster entry, so a driver who isn't on it has nowhere to go.
  useEffect(() => {
    if (!seasonId) { setTarget({ races: [], entries: [] }); setRaceId(""); return; }
    let live = true;
    setTarget(null);
    Promise.all([
      api(`/api/races?season_id=${seasonId}`),
      api(`/api/entries?season_id=${seasonId}`),
    ])
      .then(([list, entries]) => {
        if (!live) return;
        // Upcoming first — this is a pre-race action — but every round of the
        // season is offered, since a trial is also used to fill in a grid for a
        // round that has already been run.
        const races = [...list].sort((a, b) =>
          (Number(a.round_number) || 0) - (Number(b.round_number) || 0) ||
          raceDateSortKey(a.date, Infinity) - raceDateSortKey(b.date, Infinity));
        setTarget({ races, entries });
        setRaceId(prev => (races.some(r => r.id === prev) ? prev : (races[0]?.id || "")));
      })
      .catch(() => { if (live) { setTarget({ races: [], entries: [] }); setRaceId(""); } });
    return () => { live = false; };
  }, [seasonId]);

  const races = target?.races ?? null;

  // What this will write, worked out here — the grid in the order the chosen
  // column puts it, and WHO the target season's roster is missing, which is the
  // part an admin actually needs before committing.
  //
  // This used to be a `dry_run` POST fired on every change of race or sort
  // order: a serverless invocation per dropdown flick, to answer a question the
  // browser already had the data for. It is the same pure planner the export
  // itself runs (lib/timeTrials.js), so the preview and the write can never
  // disagree — the preview IS the payload.
  const plan = useMemo(() => {
    if (!raceId || !target) return null;
    const index = entryIndex(target.entries);
    const summarized = summarizeEntries(rows, { averageLaps: trial.average_laps });
    return planQualifyingExport(summarized, row => matchEntry(row, index)?.id || "", { key: sortKey });
  }, [raceId, target, rows, sortKey, trial.average_laps]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/api/time-trials/${trial.id}/export-qualifying`, {
        // `name` rides along on each grid row for the preview above; the write
        // path files results against entry ids, so only those are sent.
        method: "POST",
        body: {
          race_id: raceId,
          grid: plan.grid.map(({ entry_id, finish_pos, qual_time, fastest_lap_time }) =>
            ({ entry_id, finish_pos, qual_time, fastest_lap_time })),
        },
      });
      const result = { ...res, unmatched: plan.unmatched };
      setDone(result);
      onExported?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Qualifying grid set" onClose={onClose}>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
          <strong>{done.exported}</strong> driver{done.exported === 1 ? "" : "s"} copied onto{" "}
          <strong>{done.race?.name}</strong> as its official Qualifying results.
          {done.unmatched?.length > 0 && <> {done.unmatched.length} weren&rsquo;t on that season&rsquo;s roster and were left out.</>}
        </p>
        {done.unmatched?.length > 0 && (
          <p style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>{done.unmatched.join(", ")}</p>
        )}
        <a className="btn btn-primary" href={`/races/${done.race?.id}/edit?tab=qualifying`}>Open the Qualifying sheet</a>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose}>Close</button>
      </Modal>
    );
  }

  const race = (races || []).find(r => r.id === raceId) || null;

  return (
    <Modal title="Export to Qualifying" onClose={busy ? () => {} : onClose}>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55, marginTop: 6 }}>
        Copies this session&rsquo;s best laps onto a scheduled race as its official Qualifying
        results — fastest lap on pole. This <strong>replaces</strong> any qualifying already saved
        for that event.
      </p>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="tt_export_season">Season</label>
        <select id="tt_export_season" value={seasonId} onChange={e => setSeasonId(e.target.value)} disabled={busy}>
          <option value="">Pick a season…</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="tt_export_race">Race event</label>
        <select id="tt_export_race" value={raceId} onChange={e => setRaceId(e.target.value)} disabled={busy || !races?.length}>
          {races === null && <option value="">Loading…</option>}
          {races?.length === 0 && <option value="">No races on this season&rsquo;s schedule</option>}
          {(races || []).map(r => (
            <option key={r.id} value={r.id}>
              R{r.round_number ?? "?"} · {r.name}{r.date ? ` · ${formatRaceDate(r.date)}` : ""}
            </option>
          ))}
        </select>
        {race?.track && <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{race.track}</span>}
      </div>

      <div className="field">
        <label htmlFor="tt_export_key">Grid order</label>
        <select id="tt_export_key" value={sortKey} onChange={e => setSortKey(e.target.value)} disabled={busy}>
          <option value="best">Best Time — single fastest lap</option>
          <option value="average">{averageLabel(trial.average_laps)}</option>
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Whichever column sets the order, the qualifying <strong>time</strong> filed for each driver
          is the one that column shows, and their fastest lap of the session is stored as the lap
          they set.
        </span>
      </div>

      {raceId && !plan && !error && <div className="skeleton" style={{ height: 70 }} />}

      {plan && (
        <div className="bonus-panel" style={{ marginTop: 4 }}>
          <div className="bonus-panel-title">What this will write</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{plan.grid.length} on the grid</span>
            {plan.unmatched.length > 0 && <span className="bonus-chip">{plan.unmatched.length} not on the roster</span>}
          </div>
          {plan.grid.length > 0 && (
            <p className="bonus-panel-note">
              Pole: <strong>{plan.grid[0].name}</strong> ({plan.grid[0].qual_time})
              {plan.grid[1] && <> · P2 {plan.grid[1].name} ({plan.grid[1].qual_time})</>}
            </p>
          )}
          {plan.unmatched.length > 0 && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              Not on that season&rsquo;s roster, so they&rsquo;ll be left off:{" "}
              {plan.unmatched.slice(0, 8).join(", ")}
              {plan.unmatched.length > 8 ? `, and ${plan.unmatched.length - 8} more` : ""}.
              Add them to the roster first — or complete this session as a placement to build it.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
          disabled={busy || !raceId || !plan?.grid.length} onClick={run}>
          {busy ? "Exporting…" : "Export to Qualifying"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
