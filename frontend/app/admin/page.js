"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";

function Panel({ title, sub, children }) {
  return (
    <div className="form-card" style={{ maxWidth: "100%" }}>
      <h3>{title}</h3>
      {sub && <p style={{ margin: "0 0 4px", fontSize: "0.82rem", color: "var(--ink-1)" }}>{sub}</p>}
      {children}
    </div>
  );
}

function ItemRow({ logo, name, onDelete }) {
  return (
    <div className="driver-row">
      {logo ? <img src={logo} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} /> : <span>🏁</span>}
      <span style={{ flex: 1 }}>{name}</span>
      <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onDelete}>✕</button>
    </div>
  );
}

function AdminInner() {
  const league = useLeague();
  const { games, seriesList, seasons, gameId, seriesId, seasonId, refresh } = league;
  const [races, setRaces] = useState([]);
  const [toast, setToast] = useState(null);

  const [gameForm, setGameForm] = useState({ name: "", logo_url: "" });
  const [seriesForm, setSeriesForm] = useState({ name: "", logo_url: "" });
  const [seasonForm, setSeasonForm] = useState({ name: "", drop_weeks: "0", logo_url: "" });
  const [raceForm, setRaceForm] = useState({ name: "", track: "", date: "", round_number: "", track_logo_url: "" });

  const loadRaces = useCallback(() => {
    if (!seasonId) { setRaces([]); return; }
    api(`/api/races?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  }, [seasonId]);

  useEffect(loadRaces, [loadRaces]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function create(path, body, after) {
    try {
      await api(path, { method: "POST", body });
      showToast("success", "Saved.");
      after?.();
      refresh();
    } catch (err) { showToast("error", err.message); }
  }

  async function remove(path, warning) {
    if (!confirm(warning)) return;
    try { await api(path, { method: "DELETE" }); refresh(); loadRaces(); }
    catch (err) { showToast("error", err.message); }
  }

  return (
    <section>
      <div className="page-title"><h2>League Setup</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 640 }}>
        Build your hierarchy: <strong>Game → Series → Season → Race</strong>. Name everything yourself and
        upload your own logos. The dropdowns at the top of the page control which branch you&apos;re editing.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="two-col" style={{ marginTop: 18 }}>
        <Panel title="Games" sub="e.g. iRacing, F1 25, Gran Turismo 7">
          <form onSubmit={e => { e.preventDefault(); create("/api/games", gameForm, () => setGameForm({ name: "", logo_url: "" })); }}>
            <div className="field"><label>Game Name</label>
              <input required value={gameForm.name} onChange={e => setGameForm(f => ({ ...f, name: e.target.value }))} placeholder="iRacing" /></div>
            <ImageUpload label="Game Logo" kind="game-logo" value={gameForm.logo_url} onUploaded={url => setGameForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit">Add Game</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {games.map(g => <ItemRow key={g.id} logo={g.logo_url} name={g.name}
              onDelete={() => remove(`/api/games/${g.id}`, `Delete game "${g.name}"? Its series/seasons remain in the database but will be hidden.`)} />)}
          </div>
        </Panel>

        <Panel title="Series" sub={gameId ? `Inside ${league.game?.name}` : "Select a game first"}>
          <form onSubmit={e => { e.preventDefault(); create("/api/series", { ...seriesForm, game_id: gameId }, () => setSeriesForm({ name: "", logo_url: "" })); }}>
            <div className="field"><label>Series Name</label>
              <input required disabled={!gameId} value={seriesForm.name} onChange={e => setSeriesForm(f => ({ ...f, name: e.target.value }))} placeholder="Asphalt Assault Series" /></div>
            <ImageUpload label="Series Logo" kind="series-logo" value={seriesForm.logo_url} onUploaded={url => setSeriesForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit" disabled={!gameId}>Add Series</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {seriesList.map(s => <ItemRow key={s.id} logo={s.logo_url} name={s.name}
              onDelete={() => remove(`/api/series/${s.id}`, `Delete series "${s.name}"?`)} />)}
          </div>
        </Panel>

        <Panel title="Seasons" sub={seriesId ? `Inside ${league.series?.name}` : "Select a series first"}>
          <form onSubmit={e => {
            e.preventDefault();
            create("/api/seasons", { ...seasonForm, series_id: seriesId, game_id: gameId }, () => setSeasonForm({ name: "", drop_weeks: "0", logo_url: "" }));
          }}>
            <div className="field"><label>Season Name</label>
              <input required disabled={!seriesId} value={seasonForm.name} onChange={e => setSeasonForm(f => ({ ...f, name: e.target.value }))} placeholder="Season 3" /></div>
            <div className="field"><label>Drop Weeks (worst results ignored)</label>
              <input type="number" min="0" disabled={!seriesId} value={seasonForm.drop_weeks} onChange={e => setSeasonForm(f => ({ ...f, drop_weeks: e.target.value }))} /></div>
            <ImageUpload label="Season Logo" kind="season-logo" value={seasonForm.logo_url} onUploaded={url => setSeasonForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit" disabled={!seriesId}>Add Season</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {seasons.map(s => <ItemRow key={s.id} logo={s.logo_url} name={s.name}
              onDelete={() => remove(`/api/seasons/${s.id}`, `Delete season "${s.name}"?`)} />)}
          </div>
        </Panel>

        <Panel title="Races" sub={seasonId ? `Inside ${league.season?.name}` : "Select a season first"}>
          <form onSubmit={e => {
            e.preventDefault();
            create("/api/races", { ...raceForm, season_id: seasonId }, () => setRaceForm({ name: "", track: "", date: "", round_number: "", track_logo_url: "" }));
            setTimeout(loadRaces, 400);
          }}>
            <div className="field"><label>Race Name</label>
              <input required disabled={!seasonId} value={raceForm.name} onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))} placeholder="Race 1 — Daytona Duel" /></div>
            <div className="field"><label>Track</label>
              <input disabled={!seasonId} value={raceForm.track} onChange={e => setRaceForm(f => ({ ...f, track: e.target.value }))} placeholder="Daytona International Speedway" /></div>
            <div className="field"><label>Round Number</label>
              <input type="number" min="1" required disabled={!seasonId} value={raceForm.round_number} onChange={e => setRaceForm(f => ({ ...f, round_number: e.target.value }))} /></div>
            <div className="field"><label>Date</label>
              <input type="date" disabled={!seasonId} value={raceForm.date} onChange={e => setRaceForm(f => ({ ...f, date: e.target.value }))} /></div>
            <ImageUpload label="Track Logo" kind="track-logo" value={raceForm.track_logo_url} onUploaded={url => setRaceForm(f => ({ ...f, track_logo_url: url }))} />
            <button className="btn btn-primary" type="submit" disabled={!seasonId}>Add Race</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {races.map(r => <ItemRow key={r.id} logo={r.track_logo_url} name={`R${r.round_number} · ${r.name}`}
              onDelete={() => remove(`/api/races/${r.id}`, `Delete race "${r.name}"?`)} />)}
          </div>
        </Panel>
      </div>
    </section>
  );
}

export default function AdminPage() {
  return <AdminGate><AdminInner /></AdminGate>;
}
