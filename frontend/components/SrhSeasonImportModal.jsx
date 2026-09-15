"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { isIracingGame } from "@/lib/signupRequest";

// Sentinel for the "start a brand new one" choice in the series picker.
const NEW = "__new__";

// Import a whole season's schedule from SimRacerHub — iRacing only, because
// SimRacerHub is where an iRacing league's scoring lives and it scores nothing
// else.
//
// The point of it: a league builds next season on SimRacerHub, then builds the
// same twelve rounds again here, with the same tracks, dates and distances
// typed twice. This is the second half in one URL.
//
// Two steps, deliberately. Pasting the link READS the schedule and shows what
// it found — every round, which venues are new, anything it couldn't make
// sense of — and a second press creates it. One press would be quicker and
// would also be a season's worth of rows appearing with no chance to notice
// that the wrong link was pasted, or that a league writes its dates in an
// order this had to guess at.
//
// Where the season lands: an existing iRacing series, or a new one named after
// the series SimRacerHub has it under. Whatever the page's scope already names
// is used and not asked for again.
export function SrhSeasonImportModal({ gameId, games = [], seriesId, seriesName, seriesList = [], onClose, onCreated }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [seasonName, setSeasonName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // Only iRacing games can hold a SimRacerHub season, so they're the only ones
  // offered. The scope's own game is used when it is one.
  const iracingGames = useMemo(() => games.filter(g => isIracingGame(g.name)), [games]);
  const scopedGameIsIracing = !!gameId && iracingGames.some(g => g.id === gameId);
  const [pickedGame, setPickedGame] = useState(
    scopedGameIsIracing ? gameId : (iracingGames[0]?.id || "")
  );
  const targetGame = scopedGameIsIracing ? gameId : pickedGame;

  const [seriesOptions, setSeriesOptions] = useState(seriesId ? seriesList : []);
  const [pickedSeries, setPickedSeries] = useState(seriesId || NEW);
  const [newSeriesName, setNewSeriesName] = useState("");

  // The series to choose from: the scope's own list while it names a series,
  // otherwise this game's, fetched as the game changes — a series from the game
  // you just moved off would put the season in the wrong place.
  useEffect(() => {
    if (seriesId || !targetGame) return;
    let live = true;
    api(`/api/series?game_id=${targetGame}`)
      .then(list => {
        if (!live) return;
        setSeriesOptions(list);
        setPickedSeries(list[0]?.id ?? NEW);
      })
      .catch(() => { if (live) { setSeriesOptions([]); setPickedSeries(NEW); } });
    return () => { live = false; };
  }, [seriesId, targetGame]);

  const creatingSeries = !seriesId && pickedSeries === NEW;
  const targetSeriesName = seriesId
    ? (seriesName || "this series")
    : (seriesOptions.find(s => s.id === pickedSeries)?.name || "");

  // Read the schedule. Nothing is written by this — the route answers with what
  // an import WOULD create.
  const readSchedule = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/import-srh-season", { method: "POST", body: { url: url.trim(), preview: true } });
      setPreview(res);
      setSeasonName(res.season?.name || "");
      // A first import has no series to put it in yet, so SimRacerHub's own
      // name for the series is the obvious one to offer.
      setNewSeriesName(n => n || res.source?.series || "");
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [url]);

  async function create() {
    if (!preview || !seasonName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const targetSeriesId = creatingSeries
        ? (await api("/api/series", { method: "POST", body: { name: newSeriesName.trim(), game_id: targetGame } })).id
        : (seriesId || pickedSeries);
      const res = await api("/api/import-srh-season", {
        method: "POST",
        body: { url: preview.source_url, series_id: targetSeriesId, season_name: seasonName.trim() },
      });
      onCreated(res, { gameId: targetGame, seriesId: targetSeriesId });
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  const rows = preview?.rows || [];
  const newTracks = (preview?.tracks || []).filter(t => !t.existing);
  const ready = !!preview && !!seasonName.trim() && !!targetGame
    && (creatingSeries ? !!newSeriesName.trim() : !!(seriesId || pickedSeries));

  return (
    <Modal title="Import a season from SimRacerHub" onClose={onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
        Paste the SimRacerHub link for the season (its schedule, standings or results page — any of them
        carries the id) and the whole schedule comes across: every round, its date, its track and how far it
        runs. Nothing is created until you&rsquo;ve seen what it found.
      </p>

      <form onSubmit={e => { e.preventDefault(); readSchedule(); }}>
        <div className="field">
          <label htmlFor="srh_season_url">SimRacerHub season URL</label>
          <input id="srh_season_url" value={url} autoFocus
            onChange={e => { setUrl(e.target.value); setError(null); }}
            placeholder="https://www.simracerhub.com/season_schedule.php?season_id=…" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || creating || !url.trim()}>
          {busy ? "Reading…" : preview ? "Read again" : "Read schedule"}
        </button>
      </form>

      {preview && (
        <>
          <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", margin: "14px 0", background: "var(--bg-elevated)" }}>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>On SimRacerHub</div>
            <div style={{ fontSize: "0.88rem" }}>
              {[preview.source?.league, preview.source?.series, preview.source?.season].filter(Boolean).join(" › ")}
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-1)", marginTop: 6 }}>
              <strong>{rows.length}</strong> round{rows.length === 1 ? "" : "s"}
              {preview.off_weeks ? ` · ${preview.off_weeks} off week${preview.off_weeks === 1 ? "" : "s"} skipped` : ""}
              {preview.cars?.length ? ` · ${preview.cars.join(", ")}` : ""}
              {` · ${preview.tracks.length} track${preview.tracks.length === 1 ? "" : "s"}`}
              {newTracks.length ? ` (${newTracks.length} new)` : ""}
            </div>
          </div>

          {(preview.warnings || []).map((w, i) => (
            <p key={i} style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--accent-amber, #d29922)" }}>⚠ {w}</p>
          ))}

          {/* Where it goes. Whatever the page's scope already names isn't asked
              for again — from League Setup's Seasons panel that's both. */}
          {!scopedGameIsIracing && iracingGames.length > 1 && (
            <div className="field">
              <label>iRacing game</label>
              <select value={pickedGame} onChange={e => setPickedGame(e.target.value)}>
                {iracingGames.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {!seriesId && (
            <>
              <div className="field">
                <label>Series</label>
                <select value={pickedSeries} onChange={e => setPickedSeries(e.target.value)}>
                  {seriesOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value={NEW}>+ New series…</option>
                </select>
              </div>
              {creatingSeries && (
                <div className="field">
                  <label>New Series Name</label>
                  <input required value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)}
                    placeholder={preview.source?.series || "Series name"} />
                  <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                    Named after the series SimRacerHub has this season under. Change it to whatever your league calls it.
                  </span>
                </div>
              )}
            </>
          )}
          <div className="field">
            <label htmlFor="srh_season_name">Season name</label>
            <input id="srh_season_name" required value={seasonName} onChange={e => setSeasonName(e.target.value)} />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              SimRacerHub calls it “{preview.source?.season || seasonName}”. This is the only name you&rsquo;ll want to
              check — the rounds below are named from the schedule and can be edited afterwards.
            </span>
          </div>

          <h4 style={{ margin: "16px 0 6px" }}>The schedule</h4>
          <div style={{ overflowX: "auto", maxHeight: "40vh", overflowY: "auto" }}>
            <table className="stats-table" style={{ fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th>R</th>
                  <th style={{ textAlign: "left" }}>Race</th>
                  <th>Date</th>
                  <th style={{ textAlign: "left" }}>Track</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const track = preview.tracks.find(t => t.name === r.track);
                  return (
                    <tr key={r.round_number} style={r.warnings.length ? { background: "rgba(210,153,34,0.08)" } : undefined}>
                      <td>{r.round_number}</td>
                      <td style={{ textAlign: "left" }}>
                        {r.name}
                        {r.points_count === false && (
                          <span title="Runs for no championship points on SimRacerHub" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(255,255,255,0.08)", color: "var(--ink-2)" }}>
                            no points
                          </span>
                        )}
                      </td>
                      <td title={r.date_text || undefined}>{r.date || <em style={{ color: "var(--accent-amber, #d29922)" }}>—</em>}</td>
                      <td style={{ textAlign: "left" }}>
                        {r.track || <em style={{ color: "var(--ink-2)" }}>none</em>}
                        {r.track && track && !track.existing && (
                          <span title="This venue will be added to your Tracks library" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>
                            new
                          </span>
                        )}
                      </td>
                      <td title={r.length_text || undefined}>{r.length || <em style={{ color: "var(--ink-2)" }}>—</em>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {newTracks.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
              <strong>{newTracks.length}</strong> venue{newTracks.length === 1 ? "" : "s"} will be added to your Tracks
              library: {newTracks.map(t => t.name).join(", ")}. The rest are matched to tracks you already have, so
              their lap records and history carry on.
            </p>
          )}
        </>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary" type="button" disabled={!ready || creating || busy} onClick={create}>
            {creating ? "Creating…" : `Create season & ${rows.length} race${rows.length === 1 ? "" : "s"}`}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={creating}>Cancel</button>
          <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
            Creates the season in {creatingSeries ? `a new series, “${newSeriesName || "…"}”` : (targetSeriesName || "the series above")} with
            these {rows.length} races. Classes, the roster and the points structure are set up afterwards, as on any
            new season.
          </p>
        </div>
      )}
      {!preview && error === null && (
        <p style={{ margin: "12px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Only simracerhub.com links can be read, and only into an iRacing series.
        </p>
      )}
    </Modal>
  );
}
