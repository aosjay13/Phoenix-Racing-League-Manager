"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { SeasonForm } from "@/components/SeasonForm";
import { BLANK_SEASON_FORM, seasonFormToBody } from "@/lib/seasonForm";
import { isBangerSeries } from "@/lib/bangerRacing";

// Sentinel for the "start a brand new one" choice in the game / series pickers.
const NEW = "__new__";

// Quick "start a new season" dialog, opened from the Schedule page while no
// single season is selected — the moment an admin is most likely to want one.
//
// It offers exactly the fields League Setup's Seasons panel does, because it
// renders the same <SeasonForm>; the only things this adds are the game and
// series the season belongs to and switching into it once it exists. Classes
// and races are still built on League Setup / the calendar afterwards.
//
// A season hangs off a series, which hangs off a game, so whatever the page's
// scope leaves unnamed the dialog asks for: at "All Games" that's both, at
// "All Series" (or on a game with no series yet) just the series. Either can be
// picked from what already exists or named fresh and created on the way — which
// is what makes this dialog enough to get a brand new game racing without a
// detour through League Setup.
export function SeasonCreateModal({ gameId, games = [], seriesId, seriesName, seriesList = [], onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_SEASON_FORM);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Pickers, used only for the levels the scope didn't name.
  const [pickedGame, setPickedGame] = useState(gameId || games[0]?.id || NEW);
  const [newGameName, setNewGameName] = useState("");
  const [pickedSeries, setPickedSeries] = useState(seriesList[0]?.id ?? NEW);
  const [newSeriesName, setNewSeriesName] = useState("");
  // The series to choose from. Fixed to the scope's own list while the scope
  // names a game; refetched below when the dialog is picking the game itself.
  const [seriesOptions, setSeriesOptions] = useState(seriesList);

  const needsGame = !gameId;
  const creatingGame = needsGame && pickedGame === NEW;
  const needsSeries = !seriesId;
  const creatingSeries = needsSeries && pickedSeries === NEW;

  const gameReady = !needsGame || (creatingGame ? !!newGameName.trim() : !!pickedGame);
  const seriesReady = !needsSeries || (creatingSeries ? !!newSeriesName.trim() : !!pickedSeries);

  // Picking a game at "All Games" re-populates the series menu with that game's
  // series — a series from the game you just moved off would put the season in
  // the wrong place. A game being created has none yet, so the series can only
  // be a new one.
  useEffect(() => {
    if (!needsGame) return;
    if (creatingGame) { setSeriesOptions([]); setPickedSeries(NEW); return; }
    let live = true;
    api(`/api/series?game_id=${pickedGame}`)
      .then(list => {
        if (!live) return;
        setSeriesOptions(list);
        setPickedSeries(list[0]?.id ?? NEW);
      })
      .catch(() => { if (live) { setSeriesOptions([]); setPickedSeries(NEW); } });
    return () => { live = false; };
  }, [needsGame, creatingGame, pickedGame]);

  const loadTemplates = useCallback(() => {
    api("/api/points-templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !gameReady || !seriesReady) return;
    setBusy(true);
    setError(null);
    try {
      // Top down: the game, then the series inside it, then the season inside
      // that — each level created only when there wasn't one to pick.
      const targetGameId = creatingGame
        ? (await api("/api/games", { method: "POST", body: { name: newGameName.trim() } })).id
        : (gameId || pickedGame);
      const targetSeriesId = creatingSeries
        ? (await api("/api/series", { method: "POST", body: { name: newSeriesName.trim(), game_id: targetGameId } })).id
        : (seriesId || pickedSeries);
      const season = await api("/api/seasons", {
        method: "POST",
        body: { ...seasonFormToBody(form), name: form.name.trim(), series_id: targetSeriesId, game_id: targetGameId },
      });
      onCreated(season, { gameId: targetGameId, seriesId: targetSeriesId });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Season" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
          {needsGame || needsSeries
            ? `A season runs inside a series${needsGame ? ", and a series inside a game" : ""} — pick where this one belongs, or name a new ${needsGame ? "game / series" : "series"} and it'll be created too. `
            : <>In <strong>{seriesName || "this series"}</strong>. </>}
          You&rsquo;ll be switched into the new season so you can start adding races right away — add
          its classes on League Setup.
        </p>
        {needsGame && (
          <>
            <div className="field">
              <label>Game</label>
              <select value={pickedGame} onChange={e => setPickedGame(e.target.value)}>
                {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value={NEW}>+ New game…</option>
              </select>
            </div>
            {creatingGame && (
              <div className="field">
                <label>New Game Name</label>
                <input required value={newGameName} onChange={e => setNewGameName(e.target.value)}
                  placeholder="iRacing" />
              </div>
            )}
          </>
        )}
        {needsSeries && (
          <>
            <div className="field">
              <label>Series</label>
              <select value={pickedSeries} onChange={e => setPickedSeries(e.target.value)}
                disabled={creatingGame}>
                {seriesOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW}>+ New series…</option>
              </select>
            </div>
            {creatingSeries && (
              <div className="field">
                <label>New Series Name</label>
                <input required value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)}
                  placeholder="Asphalt Assault Series" />
              </div>
            )}
          </>
        )}
        <SeasonForm
          value={form} onChange={setForm}
          templates={templates} onTemplatesChanged={loadTemplates}
          onError={setError}
          // The derby bonuses belong to the series the season is going into —
          // a season created under a Banger Racing series can set them here.
          banger={isBangerSeries(seriesOptions.find(s => s.id === (seriesId || pickedSeries)) || null)}
        />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim() || !gameReady || !seriesReady}>
          {busy ? "Creating…" : "Create Season"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
