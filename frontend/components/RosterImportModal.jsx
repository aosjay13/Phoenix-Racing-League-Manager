"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Bulk roster import — the season-rollover shortcut. Instead of re-adding 30
// drivers by hand every new season, pull them in one shot from either:
//   • every driver who has raced anywhere in this SERIES, or
//   • one specific past SEASON (a straight clone of its roster).
//
// Drivers already on the target roster are skipped server-side rather than
// erroring, so this is safe to run on a roster that's already partly built.
// Team and class aren't carried over — those are per-season records — so the
// imported drivers land unassigned and ready to be slotted in.
export function RosterImportModal({ seasonId, seriesId, seasonName, seriesName, onClose, onImported }) {
  const [source, setSource] = useState("series");
  const [seasons, setSeasons] = useState([]);
  const [fromSeasonId, setFromSeasonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Past seasons of this series are the clone candidates — never the season
  // we're importing into.
  useEffect(() => {
    if (!seriesId) return;
    let live = true;
    api(`/api/seasons?series_id=${seriesId}`)
      .then(list => {
        if (!live) return;
        const others = list.filter(s => s.id !== seasonId);
        setSeasons(others);
        setFromSeasonId(others[others.length - 1]?.id ?? "");
      })
      .catch(() => setSeasons([]));
    return () => { live = false; };
  }, [seriesId, seasonId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = source === "season"
        ? { season_id: seasonId, source: "season", from_season_id: fromSeasonId }
        : { season_id: seasonId, source: "series" };
      const res = await api("/api/roster/import", { method: "POST", body });
      onImported(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const noSeasons = seasons.length === 0;

  return (
    <Modal title="Import Roster" onClose={busy ? () => {} : onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Bulk-add drivers to <strong>{seasonName || "this season"}</strong>. Anyone already on this
        season&rsquo;s roster is skipped, so nobody is ever duplicated.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontWeight: 400, cursor: "pointer" }}>
            <input type="radio" name="import-source" value="series" checked={source === "series"}
              onChange={() => setSource("series")} style={{ marginTop: 3, accentColor: "var(--accent-cyan)" }} />
            <span>
              <strong>All drivers in {seriesName || "this series"}</strong>
              <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.82rem" }}>
                Everyone who has raced in any season of this series.
              </span>
            </span>
          </label>
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontWeight: 400, cursor: noSeasons ? "default" : "pointer" }}>
            <input type="radio" name="import-source" value="season" checked={source === "season"}
              disabled={noSeasons} onChange={() => setSource("season")}
              style={{ marginTop: 3, accentColor: "var(--accent-cyan)" }} />
            <span>
              <strong>Clone a previous season</strong>
              <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.82rem" }}>
                {noSeasons ? "No other seasons in this series yet." : "Copy one past season's roster exactly."}
              </span>
            </span>
          </label>
        </div>

        {source === "season" && !noSeasons && (
          <div className="field">
            <label>Import from</label>
            <select value={fromSeasonId} onChange={e => setFromSeasonId(e.target.value)}>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {error && <div className="toast toast-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy || (source === "season" && !fromSeasonId)}>
          {busy ? "Importing…" : "Import Drivers"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onClose}>Cancel</button>
      </form>
    </Modal>
  );
}
