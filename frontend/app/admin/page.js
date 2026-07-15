"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";
import { BONUS_TYPES, DEFAULT_RACE_POINTS, DEFAULT_QUAL_POINTS } from "@/lib/standings";

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
  const blankSeason = {
    name: "", drop_weeks: "0", logo_url: "",
    race_points: "", qual_points: "",
    bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, "0"])),
  };
  const [seasonForm, setSeasonForm] = useState(blankSeason);
  const [showPoints, setShowPoints] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");

  const loadTemplates = useCallback(() => {
    api("/api/points-templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  function applyTemplate(id) {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setSeasonForm(f => ({
      ...f,
      race_points: t.race_points || "",
      qual_points: t.qual_points || "",
      bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => {
        const b = typeof t.bonus_points === "string" ? JSON.parse(t.bonus_points || "{}") : (t.bonus_points || {});
        return [k, String(b[k] ?? 0)];
      })),
    }));
  }

  async function saveTemplate() {
    if (!templateName.trim()) return showToast("error", "Give the template a name first.");
    try {
      await api("/api/points-templates", {
        method: "POST",
        body: {
          name: templateName.trim(),
          race_points: seasonForm.race_points,
          qual_points: seasonForm.qual_points,
          bonus_points: Object.fromEntries(Object.entries(seasonForm.bonuses).map(([k, v]) => [k, Number(v || 0)])),
        },
      });
      setTemplateName("");
      loadTemplates();
      showToast("success", "Points template saved.");
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteTemplate() {
    const t = templates.find(x => x.id === templateId);
    if (!t || !confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api(`/api/points-templates/${t.id}`, { method: "DELETE" });
      setTemplateId("");
      loadTemplates();
    } catch (err) { showToast("error", err.message); }
  }
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
            const { bonuses, ...rest } = seasonForm;
            const body = {
              ...rest,
              series_id: seriesId,
              game_id: gameId,
              bonus_points: Object.fromEntries(Object.entries(bonuses).map(([k, v]) => [k, Number(v || 0)])),
            };
            if (!body.race_points) delete body.race_points;
            if (!body.qual_points) delete body.qual_points;
            create("/api/seasons", body, () => setSeasonForm(blankSeason));
          }}>
            <div className="field"><label>Season Name</label>
              <input required disabled={!seriesId} value={seasonForm.name} onChange={e => setSeasonForm(f => ({ ...f, name: e.target.value }))} placeholder="Season 3" /></div>
            <div className="field"><label>Drop Weeks (worst results ignored)</label>
              <input type="number" min="0" disabled={!seriesId} value={seasonForm.drop_weeks} onChange={e => setSeasonForm(f => ({ ...f, drop_weeks: e.target.value }))} /></div>
            <ImageUpload label="Season Logo" kind="season-logo" value={seasonForm.logo_url} onUploaded={url => setSeasonForm(f => ({ ...f, logo_url: url }))} />

            <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setShowPoints(v => !v)}>
              {showPoints ? "▾" : "▸"} Points &amp; Bonuses
            </button>
            {showPoints && (
              <>
                <div className="field">
                  <label>Load Template</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={templateId} onChange={e => applyTemplate(e.target.value)} style={{ flex: 1 }}>
                      <option value="">Custom / start blank…</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {templateId && (
                      <button type="button" className="btn btn-danger" style={{ marginTop: 0, padding: "6px 12px" }} onClick={deleteTemplate}>✕</button>
                    )}
                  </div>
                </div>
                <div className="field"><label>Race Points Table (JSON — blank = default 350/320/300…)</label>
                  <textarea rows={3} value={seasonForm.race_points}
                    placeholder={JSON.stringify(Object.fromEntries(Object.entries(DEFAULT_RACE_POINTS).slice(0, 6)))}
                    onChange={e => setSeasonForm(f => ({ ...f, race_points: e.target.value }))}
                    style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-elevated)", color: "var(--ink-0)", fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }} /></div>
                <div className="field"><label>Qualifying Points Table (JSON — blank = default 35/32/30…)</label>
                  <textarea rows={3} value={seasonForm.qual_points}
                    placeholder={JSON.stringify(Object.fromEntries(Object.entries(DEFAULT_QUAL_POINTS).slice(0, 6)))}
                    onChange={e => setSeasonForm(f => ({ ...f, qual_points: e.target.value }))}
                    style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-elevated)", color: "var(--ink-0)", fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }} /></div>
                {BONUS_TYPES.map(([key, label]) => (
                  <div className="field" key={key}><label>{label}</label>
                    <input type="number" min="0" value={seasonForm.bonuses[key]}
                      onChange={e => setSeasonForm(f => ({ ...f, bonuses: { ...f.bonuses, [key]: e.target.value } }))} /></div>
                ))}
                <div className="field">
                  <label>Save Current Setup as Template</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. PRA Standard, Sprint Cup" style={{ flex: 1 }} />
                    <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={saveTemplate}>Save</button>
                  </div>
                </div>
              </>
            )}

            <button className="btn btn-primary" type="submit" disabled={!seriesId} style={{ display: "block" }}>Add Season</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {seasons.map(s => (
              <div className="driver-row" key={s.id}>
                {s.logo_url ? <img src={s.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} /> : <span>🏁</span>}
                <span style={{ flex: 1 }}>{s.name}</span>
                <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }}
                  title="Completed seasons count toward drivers' Titles"
                  onClick={async () => {
                    try {
                      await api(`/api/seasons/${s.id}`, { method: "PATCH", body: { status: s.status === "completed" ? "active" : "completed" } });
                      refresh();
                    } catch (err) { showToast("error", err.message); }
                  }}>
                  {s.status === "completed" ? "✓ Completed" : "Mark Completed"}
                </button>
                <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px" }}
                  onClick={() => remove(`/api/seasons/${s.id}`, `Delete season "${s.name}"?`)}>✕</button>
              </div>
            ))}
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
