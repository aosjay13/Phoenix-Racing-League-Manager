"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { formatRaceDate, raceDateSortKey } from "@/lib/raceDate";
import { averageLabel } from "@/lib/timeTrials";

// "Export to Qualifying" — the bridge from a time trial to a real race weekend.
//
// The trial's order becomes the grid (fastest lap on pole) and each driver's
// best lap is filed as their qualifying time. From that moment they are
// ordinary qualifying results: they score qualifying points, they set poles and
// Average Start, and their laps sit in the record books like any other. That is
// the intent — and it is why the admin picks the event by name and sees exactly
// what will be written first.
export function ExportQualifyingModal({ trial, seasons = [], onClose, onExported }) {
  const [seasonId, setSeasonId] = useState(trial.season_id || seasons[0]?.id || "");
  const [races, setRaces] = useState(null);
  const [raceId, setRaceId] = useState("");
  const [sortKey, setSortKey] = useState(trial.sort_key === "average" ? "average" : "best");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!seasonId) { setRaces([]); setRaceId(""); return; }
    let live = true;
    setRaces(null);
    api(`/api/races?season_id=${seasonId}`)
      .then(list => {
        if (!live) return;
        // Upcoming first — this is a pre-race action — but every round of the
        // season is offered, since a trial is also used to fill in a grid for a
        // round that has already been run.
        const sorted = [...list].sort((a, b) =>
          (Number(a.round_number) || 0) - (Number(b.round_number) || 0) ||
          raceDateSortKey(a.date, Infinity) - raceDateSortKey(b.date, Infinity));
        setRaces(sorted);
        setRaceId(prev => (sorted.some(r => r.id === prev) ? prev : (sorted[0]?.id || "")));
      })
      .catch(() => { if (live) { setRaces([]); setRaceId(""); } });
    return () => { live = false; };
  }, [seasonId]);

  // Preview what would be written — most usefully, WHO the target season's
  // roster is missing, since a driver who isn't on it can't have a result filed
  // against them.
  useEffect(() => {
    if (!raceId) { setPreview(null); return; }
    let live = true;
    setPreview(null);
    setError(null);
    api(`/api/time-trials/${trial.id}/export-qualifying`, {
      method: "POST", body: { race_id: raceId, sort_key: sortKey, dry_run: true },
    })
      .then(p => { if (live) setPreview(p); })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [raceId, sortKey, trial.id]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/api/time-trials/${trial.id}/export-qualifying`, {
        method: "POST", body: { race_id: raceId, sort_key: sortKey },
      });
      setDone(res);
      onExported?.(res);
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

      {raceId && !preview && !error && <div className="skeleton" style={{ height: 70 }} />}

      {preview && (
        <div className="bonus-panel" style={{ marginTop: 4 }}>
          <div className="bonus-panel-title">What this will write</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{preview.exported} on the grid</span>
            {preview.unmatched.length > 0 && <span className="bonus-chip">{preview.unmatched.length} not on the roster</span>}
          </div>
          {preview.grid?.length > 0 && (
            <p className="bonus-panel-note">
              Pole: <strong>{preview.grid[0].name}</strong> ({preview.grid[0].qual_time})
              {preview.grid[1] && <> · P2 {preview.grid[1].name} ({preview.grid[1].qual_time})</>}
            </p>
          )}
          {preview.unmatched.length > 0 && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              Not on that season&rsquo;s roster, so they&rsquo;ll be left off:{" "}
              {preview.unmatched.slice(0, 8).join(", ")}
              {preview.unmatched.length > 8 ? `, and ${preview.unmatched.length - 8} more` : ""}.
              Add them to the roster first — or complete this session as a placement to build it.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
          disabled={busy || !raceId || !preview?.exported} onClick={run}>
          {busy ? "Exporting…" : "Export to Qualifying"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
