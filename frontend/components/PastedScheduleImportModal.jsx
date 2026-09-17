"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ScheduleImportReview } from "@/components/ScheduleImportReview";
import { initialTrackChoices, trackChoiceProblems } from "@/lib/scheduleReview";

// Sentinel for the "start a brand new one" choice in the series picker.
const NEW = "__new__";

const EXAMPLE = `2023 Season 1 Schedule
Race\tDates\tTrack\tTotal Race Laps
1\t10/30/2023\tDaytona Oval\t50
2\t11/6/2023\tRoad America\t18
3\t11/13/2023\tFontana\t50`;

// Import a season's schedule by pasting it — ANY game.
//
// The SimRacerHub importer next door only helps iRacing leagues, because
// SimRacerHub scores nothing else. Every other league still keeps a schedule;
// it just lives in a spreadsheet. So they were building next season a round at
// a time, retyping dates and tracks that were already typed months ago.
//
// Select the sheet, paste it, press Read. Two steps, for the same reason the
// SimRacerHub one has two: pasting READS the schedule and shows what it found —
// every round, which venues are new, every row it did NOT read as a round — and
// a second press creates it. One press would be quicker and would also be a
// season's worth of rows appearing with no chance to notice that a column was
// read wrongly, or that a league writes its dates in an order this had to guess
// at.
//
// What it does NOT do is have a second opinion about anything. The paste is
// turned into exactly what a SimRacerHub schedule is turned into
// (lib/pastedSchedule.js), planned by the same planner, reviewed in the same
// table, and written by the same writer. Only the reading is new.
export function PastedScheduleImportModal({ gameId, games = [], seriesId, seriesName, seriesList = [], onClose, onCreated }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [seasonName, setSeasonName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [trackChoices, setTrackChoices] = useState({});

  // Any game — that is the whole point of this one. The scope's own game is
  // used when it has one.
  const [pickedGame, setPickedGame] = useState(gameId || games[0]?.id || "");
  const targetGame = gameId || pickedGame;

  const [seriesOptions, setSeriesOptions] = useState(seriesId ? seriesList : []);
  const [pickedSeries, setPickedSeries] = useState(seriesId || NEW);
  const [newSeriesName, setNewSeriesName] = useState("");

  // The series to choose from: the scope's own list while it names a series,
  // otherwise this game's, fetched as the game changes — a series from the game
  // you just moved off would put the season in the wrong place.
  useEffect(() => {
    if (seriesId || !targetGame) return undefined;
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

  // Read the paste. Nothing is written by this — the route answers with what an
  // import WOULD create.
  const read = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/import-schedule-paste", { method: "POST", body: { text, preview: true } });
      setPreview(res);
      setSeasonName(res.season?.name || "");
      setTrackChoices(initialTrackChoices(res.tracks));
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [text]);

  async function create() {
    if (!preview || !seasonName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const targetSeriesId = creatingSeries
        ? (await api("/api/series", { method: "POST", body: { name: newSeriesName.trim(), game_id: targetGame } })).id
        : (seriesId || pickedSeries);
      const res = await api("/api/import-schedule-paste", {
        method: "POST",
        body: { text, series_id: targetSeriesId, season_name: seasonName.trim(), track_decisions: trackChoices },
      });
      onCreated(res, { gameId: targetGame, seriesId: targetSeriesId });
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  const rows = preview?.rows || [];
  const { ready: tracksReady } = trackChoiceProblems(preview?.tracks || [], trackChoices);
  const ready = !!preview && !!seasonName.trim() && !!targetGame && tracksReady
    && (creatingSeries ? !!newSeriesName.trim() : !!(seriesId || pickedSeries));

  const setChoice = (raw, patch) =>
    setTrackChoices(prev => ({ ...prev, [raw]: { ...(prev[raw] || {}), ...patch } }));

  // What each column was read as, so a header this misread is visible BEFORE a
  // season is built on it. The one thing a paste can get wrong that a URL
  // can't.
  const readAs = useMemo(() => {
    const m = preview?.source?.mapping || {};
    const headers = preview?.source?.headers || [];
    const LABEL = {
      round: "Round number", date: "Date", track: "Track", name: "Race name",
      laps: "Laps", minutes: "Minutes", length: "Race length", car: "Car",
    };
    return Object.entries(m)
      .map(([field, idx]) => ({ field, label: LABEL[field] || field, header: headers[idx] }))
      .filter(x => x.header);
  }, [preview]);

  return (
    <Modal title="Import a season schedule from a paste" size="workspace" onClose={onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem", maxWidth: 760 }}>
        Select your season&rsquo;s schedule in a spreadsheet and paste it below — columns separated by tabs,
        commas or spaces, all three read the same. It needs a header row naming its columns, and a row per
        round under it. A title line above the headers becomes the season&rsquo;s name, and a totals line at
        the bottom is left out. Nothing is created until you&rsquo;ve seen what it found.
      </p>

      <form onSubmit={e => { e.preventDefault(); read(); }} style={{ maxWidth: 820 }}>
        <div className="field">
          <label htmlFor="paste_schedule">Your schedule</label>
          <textarea id="paste_schedule" value={text} autoFocus rows={8}
            onChange={e => { setText(e.target.value); setError(null); }}
            placeholder={EXAMPLE}
            style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.8rem" }} />
          <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
            Column names it knows: <strong>Race</strong> or <strong>Round</strong>, <strong>Date</strong>,
            {" "}<strong>Track</strong>, <strong>Laps</strong> or <strong>Minutes</strong>, and optionally
            {" "}<strong>Event</strong> and <strong>Car</strong>. It is forgiving about the wording —
            &ldquo;Dates&rdquo;, &ldquo;Circuit&rdquo; and &ldquo;Total Race Laps&rdquo; all read fine.
          </span>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || creating || !text.trim()}>
          {busy ? "Reading…" : preview ? "Read again" : "Read schedule"}
        </button>
      </form>

      {preview && (
        <>
          <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", margin: "14px 0", background: "var(--bg-elevated)" }}>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-1)" }}>
              <strong>{rows.length}</strong> round{rows.length === 1 ? "" : "s"}
              {preview.off_weeks ? ` · ${preview.off_weeks} off week${preview.off_weeks === 1 ? "" : "s"} skipped` : ""}
              {` · ${(preview.tracks || []).length} venue${(preview.tracks || []).length === 1 ? "" : "s"}`}
            </div>
            {readAs.length > 0 && (
              <div style={{ fontSize: "0.78rem", color: "var(--ink-2)", marginTop: 6 }}>
                Read as: {readAs.map(x => `${x.header} → ${x.label}`).join(" · ")}
              </div>
            )}
            {/* Nothing vanishes silently. A totals line, a spacer, a note at the
                bottom — each is named, so an admin can tell "left out because it
                is a total" from "left out because I misread it". */}
            {(preview.skipped || []).length > 0 && (
              <div style={{ fontSize: "0.78rem", color: "var(--ink-2)", marginTop: 6 }}>
                Not read as rounds: {preview.skipped.map(sk => `“${sk.text}” (${sk.reason})`).join(" · ")}
              </div>
            )}
          </div>

          {(preview.warnings || []).map((w, i) => (
            <p key={i} style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--accent-amber, #d29922)" }}>⚠ {w}</p>
          ))}

          <div style={{ maxWidth: 620 }}>
            {!gameId && games.length > 1 && (
              <div className="field">
                <label>Game</label>
                <select value={pickedGame} onChange={e => setPickedGame(e.target.value)}>
                  {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
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
                      placeholder="Series name" />
                  </div>
                )}
              </>
            )}
            <div className="field">
              <label htmlFor="paste_season_name">Season name</label>
              <input id="paste_season_name" required value={seasonName} onChange={e => setSeasonName(e.target.value)} />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Taken from the title line above your table. The rounds below are named from the schedule and can be
                edited afterwards.
              </span>
            </div>
          </div>

          <ScheduleImportReview
            preview={preview} choices={trackChoices} onChange={setChoice}
            sourceLabel="your schedule"
          />
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
    </Modal>
  );
}
