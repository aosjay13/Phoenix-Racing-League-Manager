"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { isIracingGame } from "@/lib/signupRequest";
import { TRACK_TYPES } from "@/lib/trackTypes";

// Sentinel for the "start a brand new one" choice in the series picker.
const NEW = "__new__";
// …and in the per-venue picker, where it means "this venue isn't in the app".
const CREATE = "__create__";

// How a venue's standing reads in the review table, in the same words and
// colours the results importer uses for a driver's.
const TRACK_CHIP = {
  matched: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950", label: "yours" },
  suggested: { bg: "rgba(210,153,34,0.18)", fg: "#d29922", label: "check" },
  new: { bg: "rgba(88,166,255,0.18)", fg: "#58a6ff", label: "new" },
};

// Why the matcher offered a candidate. "Same venue" is the one that matters:
// it is how an Oval is told from a Roval, which are one place and two tracks.
const CANDIDATE_WHY = {
  exact: "already raced under this name",
  layout: "same venue, different layout",
  close: "similar name",
};

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
  // The admin's answer for each venue on the schedule, keyed by the name
  // SimRacerHub used: { action: "use" | "create", track_id, name, track_type }.
  // A venue this league already races at needs no answer — it's matched.
  const [trackChoices, setTrackChoices] = useState({});

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
      // Start each venue on what the matcher proposed: an exact match is used,
      // and anything else is created under the name the source gave it, which
      // the admin can point elsewhere or rename.
      setTrackChoices(Object.fromEntries((res.tracks || []).map(t => [t.raw, t.status === "matched"
        ? { action: "use", track_id: t.track_id }
        : { action: "create", name: t.suggested_name, track_type: t.suggested_type }])));
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
        body: {
          url: preview.source_url,
          series_id: targetSeriesId,
          season_name: seasonName.trim(),
          track_decisions: trackChoices,
        },
      });
      onCreated(res, { gameId: targetGame, seriesId: targetSeriesId });
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  const rows = preview?.rows || [];
  const trackRows = preview?.tracks || [];
  const leagueTracks = preview?.league_tracks || [];
  const choiceFor = raw => trackChoices[raw] || {};
  const creatingTracks = trackRows.filter(t => choiceFor(t.raw).action === "create");
  // Two venues can't be created under one name — the duplicate this whole
  // check exists to stop, arriving from the review table instead.
  const duplicateNames = (() => {
    const seen = new Map();
    const dupes = new Set();
    for (const t of creatingTracks) {
      const key = String(choiceFor(t.raw).name || "").trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) dupes.add(key);
      seen.set(key, true);
    }
    return dupes;
  })();
  const unnamed = creatingTracks.some(t => !String(choiceFor(t.raw).name || "").trim());
  const unanswered = trackRows.filter(t => choiceFor(t.raw).action === "use" && !choiceFor(t.raw).track_id);
  const tracksReady = !duplicateNames.size && !unnamed && !unanswered.length;
  const ready = !!preview && !!seasonName.trim() && !!targetGame && tracksReady
    && (creatingSeries ? !!newSeriesName.trim() : !!(seriesId || pickedSeries));

  function setChoice(raw, patch) {
    setTrackChoices(prev => ({ ...prev, [raw]: { ...(prev[raw] || {}), ...patch } }));
  }

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
              {` · ${trackRows.length} venue${trackRows.length === 1 ? "" : "s"}`}
              {creatingTracks.length ? ` (${creatingTracks.length} new)` : ""}
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
                  const choice = r.track ? choiceFor(r.track) : null;
                  const willCreate = choice?.action === "create";
                  const named = willCreate
                    ? String(choice.name || "").trim()
                    : leagueTracks.find(t => t.id === choice?.track_id)?.name || "";
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
                      <td style={{ textAlign: "left" }} title={r.track && named !== r.track ? `SimRacerHub calls it “${r.track}”` : undefined}>
                        {/* The venue as it will be HERE — the name settled in
                            the Venues table below, not SimRacerHub's. */}
                        {named || r.track || <em style={{ color: "var(--ink-2)" }}>none</em>}
                        {r.track && willCreate && (
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

          {/* ── The venues ─────────────────────────────────────────────────
              The same check the results importer runs on driver names, on
              venue names: every layout this schedule races at, against the
              tracks this league already has. An exact hit needs nothing; a
              venue that merely RESEMBLES one is never taken as the same place
              without being asked, because "…Oval" and "…Roval" are one letter
              apart and two different tracks.

              And nothing here locks the league to SimRacerHub's naming: a new
              venue is created under whatever name is typed in this table, and
              the source's own name is recorded on it, so next season's import
              matches it outright. */}
          {trackRows.length > 0 && (
            <>
              <h4 style={{ margin: "18px 0 6px" }}>
                Venues
                <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-1)" }}>
                  {" "}· {preview.track_summary?.matched || 0} already yours,{" "}
                  {preview.track_summary?.suggested || 0} to check, {creatingTracks.length} new
                </span>
              </h4>
              <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Name a new venue whatever your league calls it — the name SimRacerHub uses is remembered on it, so
                the next import of this series matches it without asking. A venue you point at one you already have
                keeps its lap records and history.
              </p>
              <div style={{ overflowX: "auto", maxHeight: "40vh", overflowY: "auto" }}>
                <table className="stats-table" style={{ fontSize: "0.8rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>On SimRacerHub</th>
                      <th style={{ textAlign: "left" }}>In your app</th>
                      <th style={{ textAlign: "left" }}>Called</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackRows.map(t => {
                      const choice = choiceFor(t.raw);
                      const creatingThis = choice.action === "create";
                      const chip = TRACK_CHIP[creatingThis ? "new" : t.status] || TRACK_CHIP.new;
                      const dupe = creatingThis
                        && duplicateNames.has(String(choice.name || "").trim().toLowerCase());
                      return (
                        <tr key={t.raw} style={dupe ? { background: "rgba(248,81,73,0.08)" } : undefined}>
                          <td style={{ textAlign: "left" }}>
                            {t.raw}
                            <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: chip.bg, color: chip.fg }}>
                              {chip.label}
                            </span>
                            {t.base && t.config && (
                              <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)" }}>
                                {t.base} · {t.config}
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "left" }}>
                            <select
                              value={creatingThis ? CREATE : (choice.track_id || CREATE)}
                              aria-label={`Which track is ${t.raw}?`}
                              onChange={e => setChoice(t.raw, e.target.value === CREATE
                                ? { action: "create", name: choice.name || t.suggested_name, track_type: choice.track_type ?? t.suggested_type }
                                : { action: "use", track_id: e.target.value })}
                              style={{ minWidth: 200 }}
                            >
                              <option value={CREATE}>+ Add as a new track</option>
                              {/* The matcher's own offers first, each saying why
                                  it's here, then every other track in the league. */}
                              {t.candidates.length > 0 && (
                                <optgroup label="Best matches">
                                  {t.candidates.map(c => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}{CANDIDATE_WHY[c.reason] ? ` — ${CANDIDATE_WHY[c.reason]}` : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="Every track">
                                {leagueTracks.map(lt => (
                                  <option key={lt.id} value={lt.id}>{lt.name}</option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                          <td style={{ textAlign: "left" }}>
                            {creatingThis ? (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                <input
                                  value={choice.name ?? t.suggested_name}
                                  aria-label={`Name for ${t.raw}`}
                                  onChange={e => setChoice(t.raw, { name: e.target.value })}
                                  placeholder={t.suggested_name}
                                  style={{ minWidth: 170, padding: "4px 8px" }}
                                />
                                <select
                                  value={choice.track_type ?? t.suggested_type}
                                  aria-label={`Track type for ${t.raw}`}
                                  onChange={e => setChoice(t.raw, { track_type: e.target.value })}
                                  style={{ minWidth: 130 }}
                                >
                                  <option value="">Type (optional)</option>
                                  {TRACK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                                {t.logo_url && (
                                  <img src={t.logo_url} alt="" title="iRacing's own logo for this venue, saved with it"
                                    style={{ height: 22, maxWidth: 70, objectFit: "contain" }} />
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "var(--ink-2)" }}>
                                {leagueTracks.find(lt => lt.id === choice.track_id)?.name || "— pick a track —"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {duplicateNames.size > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ Two venues would be created under the same name — give one a different name, or point it at the
                  track you already have.
                </p>
              )}
              {unnamed && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ A new venue needs a name.
                </p>
              )}
              {unanswered.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ Pick a track for {unanswered.map(t => t.raw).join(", ")}, or add it as a new one.
                </p>
              )}
              {creatingTracks.some(t => t.logo_url) && (
                <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                  New venues are saved with iRacing&rsquo;s own logo for them where there is one, and with the surface
                  their name implies. Location and length are yours to fill in on the Tracks screen — SimRacerHub
                  publishes neither.
                </p>
              )}
            </>
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
