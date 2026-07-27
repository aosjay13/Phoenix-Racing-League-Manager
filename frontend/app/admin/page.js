"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { LeagueSettings } from "@/components/LeagueSettings";
import { ImageUpload } from "@/components/ImageUpload";
import { TrackSelect } from "@/components/TrackSelect";
import { api } from "@/lib/api";
import { BONUS_TYPES } from "@/lib/standings";
import { TRACK_TYPES } from "@/lib/trackTypes";
import { BUILTIN_TEMPLATES, listToTableOrZero, tableToList } from "@/lib/pointsTemplates";
import { carForClass } from "@/lib/classFilter";

function Panel({ title, sub, step, muted, children }) {
  return (
    <div className="form-card" style={{ maxWidth: "100%" }}>
      <div className="setup-panel-head">
        {step != null && <span className="setup-step">{step}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {sub && <p className={`setup-panel-sub${muted ? " is-muted" : ""}`}>{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// One node of the Game ▸ Series ▸ Season breadcrumb. `active` is the deepest
// level currently selected, so admins can see at a glance what they're editing.
function Crumb({ icon, label, value, logo, active }) {
  return (
    <div className={`setup-crumb${active ? " is-active" : ""}`}>
      {logo
        ? <img src={logo} alt="" className="setup-crumb-logo" />
        : <span className="setup-crumb-logo">{icon}</span>}
      <span style={{ minWidth: 0 }}>
        <span className="setup-crumb-label">{label}</span>
        <span className={`setup-crumb-value${value ? "" : " is-empty"}`}>{value || "Not selected"}</span>
      </span>
    </div>
  );
}

function ItemRow({ logo, name, meta, onEdit, onDelete, editing, children }) {
  return (
    <div className="driver-row" style={editing ? { background: "var(--accent-cyan-dim)" } : undefined}>
      {logo ? <img src={logo} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} /> : <span>🏁</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        {name}
        {meta && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{meta}</span>}
      </span>
      {children}
      {onEdit && (
        <button className="btn btn-ghost" title="Edit" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onEdit}>✎</button>
      )}
      <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onDelete}>✕</button>
    </div>
  );
}

function toArray(str) {
  return String(str || "").split(",").map(s => s.trim()).filter(Boolean);
}
function sessionsToArray(str) {
  const list = toArray(str);
  return list.length ? list : ["Race"];
}

function AdminInner() {
  const league = useLeague();
  const { games, seriesList, seasons, gameId, seriesId, seasonId, game, series, season, refresh } = league;
  const [races, setRaces] = useState([]);
  const [toast, setToast] = useState(null);

  const [gameForm, setGameForm] = useState({ name: "", logo_url: "" });
  const [seriesForm, setSeriesForm] = useState({ name: "", logo_url: "" });
  const [editIds, setEditIds] = useState({ game: null, series: null, season: null, class: null, race: null, track: null, template: null });
  const setEditId = (type, id) => setEditIds(ids => ({ ...ids, [type]: id }));
  const blankSeason = {
    name: "", drop_weeks: "0", logo_url: "", car: "",
    race_points: "", qual_points: "",
    // New seasons track a combined (overall) championship by default; an admin
    // running class-only championships turns it off. Schedules start shared
    // across every class until an admin opts into per-class calendars.
    combined_championship: true,
    per_class_schedules: false,
    per_class_results: false,
    bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, "0"])),
  };
  const [seasonForm, setSeasonForm] = useState(blankSeason);
  const [showPoints, setShowPoints] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [qualTemplateId, setQualTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const blankTemplate = {
    name: "", race_points: "", qual_points: "",
    bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, "0"])),
  };
  const [templateForm, setTemplateForm] = useState(blankTemplate);

  const loadTemplates = useCallback(() => {
    api("/api/points-templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  // Load a saved template into the dedicated Points Templates editor. bonus_points
  // may arrive as an object or a JSON string, so normalize it to string inputs.
  function editTemplate(t) {
    let bonusSrc = t.bonus_points || {};
    if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
    setEditId("template", t.id);
    setTemplateForm({
      name: t.name || "",
      race_points: tableToList(t.race_points),
      qual_points: tableToList(t.qual_points),
      bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
    });
  }

  // Create (no editId) or update (PATCH) a points template from the editor form.
  async function saveTemplateForm() {
    if (!templateForm.name.trim()) return showToast("error", "Give the template a name first.");
    const body = {
      name: templateForm.name.trim(),
      race_points: listToTableOrZero(templateForm.race_points),
      qual_points: listToTableOrZero(templateForm.qual_points),
      bonus_points: Object.fromEntries(Object.entries(templateForm.bonuses).map(([k, v]) => [k, Number(v || 0)])),
    };
    try {
      if (editIds.template) await api(`/api/points-templates/${editIds.template}`, { method: "PATCH", body });
      else await api("/api/points-templates", { method: "POST", body });
      showToast("success", editIds.template ? "Template updated." : "Template saved.");
      setTemplateForm(blankTemplate);
      setEditId("template", null);
      loadTemplates();
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteTemplateById(t) {
    if (!confirm(`Delete template "${t.name}"? Sessions already using it keep their saved points; they just can't reload it.`)) return;
    try {
      await api(`/api/points-templates/${t.id}`, { method: "DELETE" });
      if (editIds.template === t.id) { setTemplateForm(blankTemplate); setEditId("template", null); }
      if (templateId === t.id) setTemplateId("");
      loadTemplates();
    } catch (err) { showToast("error", err.message); }
  }

  function applyTemplate(id) {
    setTemplateId(id);
    setQualTemplateId("");   // a full-template load also sets qualifying points
    const builtin = BUILTIN_TEMPLATES.find(x => x.id === id);
    const saved = templates.find(x => x.id === id);
    if (!builtin && !saved) return;
    const race = builtin ? builtin.race : tableToList(saved.race_points);
    const qual = builtin ? builtin.qual : tableToList(saved.qual_points);
    let bonusSrc = builtin ? builtin.bonuses : (saved.bonus_points || {});
    if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
    setSeasonForm(f => ({
      ...f,
      race_points: race || "",
      qual_points: qual || "",
      bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
    }));
  }

  // Load ONLY the Qualifying Points from a template, leaving Race Points and
  // bonuses as they are — so qualifying can run its own scale independent of the
  // race points template.
  function applyQualTemplate(id) {
    setQualTemplateId(id);
    if (!id) return;
    const builtin = BUILTIN_TEMPLATES.find(x => x.id === id);
    const saved = templates.find(x => x.id === id);
    if (!builtin && !saved) return;
    const qual = builtin ? builtin.qual : tableToList(saved.qual_points);
    setSeasonForm(f => ({ ...f, qual_points: qual || "" }));
  }

  async function saveTemplate() {
    if (!templateName.trim()) return showToast("error", "Give the template a name first.");
    try {
      await api("/api/points-templates", {
        method: "POST",
        body: {
          name: templateName.trim(),
          race_points: listToTableOrZero(seasonForm.race_points),
          qual_points: listToTableOrZero(seasonForm.qual_points),
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
  const blankRace = {
    name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race", car: "",
    total_laps: "", heat_format: false, heats: "", consolations: "", feature_name: "A-Main Feature",
    // Blank = shared by every class. Only settable while the season has
    // per-class schedules turned on.
    class_id: "",
  };
  const [raceForm, setRaceForm] = useState(blankRace);

  // Classes divide the selected season's field into separately-scored groups
  // ("Pro"/"Amateur", GT3/LMP2). Empty list = a single-class season, which is
  // exactly how the app behaved before classes existed.
  const blankClass = { name: "", color: "", description: "", car: "", sort_order: "" };
  const [classForm, setClassForm] = useState(blankClass);
  const [classes, setClasses] = useState([]);
  const loadClasses = useCallback(() => {
    if (!seasonId) { setClasses([]); return; }
    api(`/api/classes?season_id=${seasonId}`).then(setClasses).catch(() => setClasses([]));
  }, [seasonId]);
  useEffect(loadClasses, [loadClasses]);

  // Whether this season lets each class run its own calendar. Gates the Class
  // field on the race form — with it off, every race stays shared.
  const perClassSchedules = !!season?.per_class_schedules;

  const blankTrack = { name: "", location: "", length: "", track_type: "", logo_url: "", notes: "" };
  const [trackForm, setTrackForm] = useState(blankTrack);
  const [tracks, setTracks] = useState([]);
  const loadTracks = useCallback(() => {
    api("/api/tracks").then(rows => setTracks(rows.sort((a, b) => String(a.name).localeCompare(String(b.name))))).catch(() => setTracks([]));
  }, []);
  useEffect(loadTracks, [loadTracks]);

  const loadRaces = useCallback(() => {
    if (!seasonId) { setRaces([]); return; }
    api(`/api/races?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  }, [seasonId]);

  useEffect(loadRaces, [loadRaces]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // Create when editId is null, otherwise PATCH the existing doc.
  async function save(basePath, body, editId, after) {
    try {
      if (editId) await api(`${basePath}/${editId}`, { method: "PATCH", body });
      else await api(basePath, { method: "POST", body });
      showToast("success", editId ? "Updated." : "Saved.");
      after?.();
      refresh();
    } catch (err) { showToast("error", err.message); }
  }

  const create = (path, body, after) => save(path, body, null, after);

  async function remove(path, warning) {
    if (!confirm(warning)) return;
    try { await api(path, { method: "DELETE" }); refresh(); loadRaces(); }
    catch (err) { showToast("error", err.message); }
  }

  return (
    <section>
      <div className="page-title"><h2>League Setup</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 680 }}>
        Your league is a hierarchy — a <strong>Game</strong> holds <strong>Series</strong>, a series holds
        <strong> Seasons</strong>, and a season holds its <strong>Classes</strong> and <strong>Races</strong>.
        Pick what you&apos;re working in with the dropdowns at the top of the page; the banner below always
        shows your current spot.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Multi-league: settings for the active league + Owner-only create/migrate. */}
      <LeagueSettings />

      {/* Always-visible "you are here" breadcrumb, driven by the top dropdowns. */}
      <div className="setup-context">
        <Crumb icon="🎮" label="Game" value={game?.name} logo={game?.logo_url} active={!!gameId && !seriesId} />
        <span className="setup-context-sep">▸</span>
        <Crumb icon="🏆" label="Series" value={series?.name} logo={series?.logo_url} active={!!seriesId && !seasonId} />
        <span className="setup-context-sep">▸</span>
        <Crumb icon="📅" label="Season" value={season?.name} logo={season?.logo_url} active={!!seasonId} />
        <span className="setup-context-sep">▸</span>
        <Crumb icon="🎽" label="Classes" value={seasonId ? (classes.length ? classes.map(c => c.name).join(", ") : "Single class") : ""} />
        <span className="setup-context-sep">▸</span>
        <Crumb icon="🏁" label="Races" value={seasonId ? `${races.length} scheduled` : ""} />
      </div>

      <h3 className="setup-section-title">
        League Structure
        <span className="setup-section-hint">Build the tree top-down — each step fills in the one below it</span>
      </h3>
      <div className="two-col" style={{ marginTop: 14 }}>
        <Panel title="Games" step={1} sub="e.g. iRacing, F1 25, Gran Turismo 7">
          <form onSubmit={e => {
            e.preventDefault();
            save("/api/games", gameForm, editIds.game, () => { setGameForm({ name: "", logo_url: "" }); setEditId("game", null); });
          }}>
            <div className="field"><label>Game Name</label>
              <input required value={gameForm.name} onChange={e => setGameForm(f => ({ ...f, name: e.target.value }))} placeholder="iRacing" /></div>
            <ImageUpload label="Game Logo" kind="game-logo" value={gameForm.logo_url} onUploaded={url => setGameForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit">{editIds.game ? "Save Changes" : "Add Game"}</button>
            {editIds.game && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("game", null); setGameForm({ name: "", logo_url: "" }); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {games.map(g => <ItemRow key={g.id} logo={g.logo_url} name={g.name} editing={editIds.game === g.id}
              onEdit={() => { setEditId("game", g.id); setGameForm({ name: g.name, logo_url: g.logo_url || "" }); }}
              onDelete={() => remove(`/api/games/${g.id}`, `Delete game "${g.name}"? Its series/seasons remain in the database but will be hidden.`)} />)}
          </div>
        </Panel>

        <Panel title="Series" step={2} muted={!gameId} sub={gameId ? `In ${game?.name}` : "Select a game above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            save("/api/series", editIds.series ? seriesForm : { ...seriesForm, game_id: gameId }, editIds.series,
              () => { setSeriesForm({ name: "", logo_url: "" }); setEditId("series", null); });
          }}>
            <div className="field"><label>Series Name</label>
              <input required disabled={!gameId} value={seriesForm.name} onChange={e => setSeriesForm(f => ({ ...f, name: e.target.value }))} placeholder="Asphalt Assault Series" /></div>
            <ImageUpload label="Series Logo" kind="series-logo" value={seriesForm.logo_url} onUploaded={url => setSeriesForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit" disabled={!gameId}>{editIds.series ? "Save Changes" : "Add Series"}</button>
            {editIds.series && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("series", null); setSeriesForm({ name: "", logo_url: "" }); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {seriesList.map(s => <ItemRow key={s.id} logo={s.logo_url} name={s.name} editing={editIds.series === s.id}
              onEdit={() => { setEditId("series", s.id); setSeriesForm({ name: s.name, logo_url: s.logo_url || "" }); }}
              onDelete={() => remove(`/api/series/${s.id}`, `Delete series "${s.name}"?`)} />)}
          </div>
        </Panel>

        <Panel title="Seasons" step={3} muted={!seriesId} sub={seriesId ? `In ${series?.name}` : "Select a series above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            const { bonuses, ...rest } = seasonForm;
            const body = {
              ...rest,
              // Blank points now save as an explicit 0 (never a default scale),
              // so leaving a box empty scores 0 instead of going haywire.
              race_points: listToTableOrZero(seasonForm.race_points),
              qual_points: listToTableOrZero(seasonForm.qual_points),
              bonus_points: Object.fromEntries(Object.entries(bonuses).map(([k, v]) => [k, Number(v || 0)])),
            };
            if (!editIds.season) {
              body.series_id = seriesId;
              body.game_id = gameId;
            }
            save("/api/seasons", body, editIds.season, () => { setSeasonForm(blankSeason); setEditId("season", null); setTemplateId(""); setQualTemplateId(""); });
          }}>
            <div className="field"><label>Season Name</label>
              <input required disabled={!seriesId} value={seasonForm.name} onChange={e => setSeasonForm(f => ({ ...f, name: e.target.value }))} placeholder="Season 3" /></div>
            <div className="field"><label>Drop Weeks (worst results ignored)</label>
              <input type="number" min="0" disabled={!seriesId} value={seasonForm.drop_weeks} onChange={e => setSeasonForm(f => ({ ...f, drop_weeks: e.target.value }))} /></div>
            <div className="field"><label>Car Type</label>
              <input disabled={!seriesId} value={seasonForm.car} onChange={e => setSeasonForm(f => ({ ...f, car: e.target.value }))} placeholder="e.g. NASCAR Next Gen, GT3" />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>The car this season races. Classes and individual races both default to this — override it per class in step 4, or per race below.</span></div>
            <ImageUpload label="Season Logo" kind="season-logo" value={seasonForm.logo_url} onUploaded={url => setSeasonForm(f => ({ ...f, logo_url: url }))} />

            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="season_combined_championship" disabled={!seriesId}
                checked={seasonForm.combined_championship}
                onChange={e => setSeasonForm(f => ({ ...f, combined_championship: e.target.checked }))}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="season_combined_championship" style={{ margin: 0 }}>
                Enable Overall Championship
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  For a season split into classes: also crown ONE overall champion across the whole
                  field, on top of each class&rsquo;s own championship. Turn it off for class-only
                  championships — the combined &ldquo;All Classes&rdquo; table stays viewable, just
                  flagged as unofficial. No effect on a season without classes.
                </span>
              </label>
            </div>

            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="season_per_class_schedules" disabled={!seriesId}
                checked={seasonForm.per_class_schedules}
                onChange={e => setSeasonForm(f => ({ ...f, per_class_schedules: e.target.checked }))}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="season_per_class_schedules" style={{ margin: 0 }}>
                Per-Class Schedules
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off (default): every class runs the same season schedule. On: each race can be
                  pinned to one class, so classes can run their own calendars — races left on
                  &ldquo;All Classes&rdquo; stay shared, so you can mix a common opener with
                  class-specific rounds. Turning it off later doesn&rsquo;t delete anything; pinned
                  races simply go back to showing for everyone.
                </span>
              </label>
            </div>

            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="season_per_class_results" disabled={!seriesId}
                checked={seasonForm.per_class_results}
                onChange={e => setSeasonForm(f => ({ ...f, per_class_results: e.target.checked }))}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="season_per_class_results" style={{ margin: 0 }}>
                Separate Results by Class
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off (default): all classes at an event share one results grid, with a Class column
                  per row — one outright winner. On: even when every class races the same round, each
                  class gets its <strong>own</strong> Qualifying and Race, with its own pole, its own
                  P1 and its own field. This is the default for new events; any single event can be
                  flipped either way on its Race Info tab. With no single outright order left, the
                  overall championship above just adds the classes&rsquo; points together — turn it
                  off for a pure class-championship season.
                </span>
              </label>
            </div>

            <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setShowPoints(v => !v)}>
              {showPoints ? "▾" : "▸"} Points &amp; Bonuses
            </button>
            {showPoints && (
              <>
                <div className="field">
                  <label>Load Template (race + qualifying + bonuses)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={templateId} onChange={e => applyTemplate(e.target.value)} style={{ flex: 1 }}>
                      <option value="">Custom / start blank…</option>
                      <optgroup label="Standard">
                        {BUILTIN_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                      {templates.length > 0 && (
                        <optgroup label="My Templates">
                          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {templateId && templates.some(t => t.id === templateId) && (
                      <button type="button" className="btn btn-danger" style={{ marginTop: 0, padding: "6px 12px" }} onClick={deleteTemplate}>✕</button>
                    )}
                  </div>
                </div>
                <div className="field"><label>Race Points — comma-separated, 1st place first (blank = 0 points)</label>
                  <textarea rows={3} value={seasonForm.race_points}
                    placeholder="350, 320, 300, 280, 260, 250, 240, …"
                    onChange={e => setSeasonForm(f => ({ ...f, race_points: e.target.value }))} /></div>
                <div className="field">
                  <label>Load Qualifying Points Template</label>
                  <select value={qualTemplateId} onChange={e => applyQualTemplate(e.target.value)}>
                    <option value="">Custom / keep current…</option>
                    <optgroup label="Standard">
                      {BUILTIN_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                    {templates.length > 0 && (
                      <optgroup label="My Templates">
                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Fills only the qualifying scale below from the chosen template, so qualifying can score on its own template.</span>
                </div>
                <div className="field"><label>Qualifying Points — comma-separated, pole first (blank = 0 points)</label>
                  <textarea rows={2} value={seasonForm.qual_points}
                    placeholder="35, 32, 30, 28, 26, 25, …"
                    onChange={e => setSeasonForm(f => ({ ...f, qual_points: e.target.value }))} /></div>
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

            <span style={{ display: "block" }}>
              <button className="btn btn-primary" type="submit" disabled={!seriesId}>{editIds.season ? "Save Changes" : "Add Season"}</button>
              {editIds.season && (
                <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                  onClick={() => { setEditId("season", null); setSeasonForm(blankSeason); }}>Cancel</button>
              )}
            </span>
          </form>
          <div style={{ marginTop: 16 }}>
            {seasons.map(s => (
              <ItemRow key={s.id} logo={s.logo_url} name={s.name} editing={editIds.season === s.id}
                onEdit={() => {
                  setEditId("season", s.id);
                  setShowPoints(true);
                  setSeasonForm({
                    name: s.name,
                    drop_weeks: String(s.drop_weeks ?? 0),
                    logo_url: s.logo_url || "",
                    car: s.car || "",
                    combined_championship: s.combined_championship !== false,
                    per_class_schedules: !!s.per_class_schedules,
                    per_class_results: !!s.per_class_results,
                    race_points: tableToList(s.race_points ?? s.points_scale),
                    qual_points: tableToList(s.qual_points),
                    bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => {
                      let b = s.bonus_points || {};
                      if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
                      return [k, String(b[k] ?? 0)];
                    })),
                  });
                }}
                onDelete={() => remove(`/api/seasons/${s.id}`, `Delete season "${s.name}"?`)}>
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
              </ItemRow>
            ))}
          </div>
        </Panel>

        <Panel title="Classes" step={4} muted={!seasonId}
          sub={seasonId ? `In ${season?.name} — optional; leave empty for a single-class season` : "Select a season above first"}>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
            Split this season&rsquo;s field into separately-scored groups — <strong>Pro</strong> and{" "}
            <strong>Amateur</strong>, or <strong>GT3</strong> and <strong>LMP2</strong>. Each class runs its own
            championship (points, wins, averages), and a <strong>Class</strong> menu appears next to
            Game / Series / Season on Standings, Stats and Records. Assign drivers to a class on the{" "}
            <strong>Roster</strong> page or right in the results grid. Give a class its own{" "}
            <strong>Car Type</strong> and the schedule shows which car goes with which class — handy
            when divisions run different machinery.
          </p>
          <form onSubmit={e => {
            e.preventDefault();
            const body = {
              name: classForm.name,
              color: classForm.color,
              description: classForm.description,
              car: classForm.car,
              sort_order: classForm.sort_order === "" ? classes.length : Number(classForm.sort_order),
            };
            if (!editIds.class) body.season_id = seasonId;
            save("/api/classes", body, editIds.class, () => { setClassForm(blankClass); setEditId("class", null); });
            setTimeout(loadClasses, 400);
          }}>
            <div className="field"><label>Class Name</label>
              <input required disabled={!seasonId} value={classForm.name} placeholder="e.g. Pro, Amateur, GT3, LMP2"
                onChange={e => setClassForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="field"><label>Car Type</label>
              <input disabled={!seasonId} value={classForm.car} placeholder={season?.car ? `Leave blank to use ${season.car}` : "e.g. GT3, LMP2, Late Model"}
                onChange={e => setClassForm(f => ({ ...f, car: e.target.value }))} />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                The car this class races. Overrides the season&rsquo;s car for this class, so a season
                whose classes run different machinery shows the right car on every schedule row without
                setting it race by race. A single race can still override it.
              </span></div>
            <div className="field"><label>Display Order</label>
              <input type="number" disabled={!seasonId} value={classForm.sort_order} placeholder={`${classes.length}`}
                onChange={e => setClassForm(f => ({ ...f, sort_order: e.target.value }))} />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Lowest first in the Class menu — put your headline class at 0.
              </span></div>
            <div className="field"><label>Description</label>
              <input disabled={!seasonId} value={classForm.description} placeholder="Optional — e.g. Top split, invite only"
                onChange={e => setClassForm(f => ({ ...f, description: e.target.value }))} /></div>
            <button className="btn btn-primary" type="submit" disabled={!seasonId}>{editIds.class ? "Save Changes" : "Add Class"}</button>
            {editIds.class && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("class", null); setClassForm(blankClass); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {seasonId && classes.length === 0 && (
              <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0 }}>
                No classes yet — {season?.name ?? "this season"} scores as one combined field.
              </p>
            )}
            {classes.map(c => (
              <ItemRow key={c.id} name={c.name} meta={carForClass(season, c)} editing={editIds.class === c.id}
                onEdit={() => {
                  setEditId("class", c.id);
                  setClassForm({
                    name: c.name || "", color: c.color || "", description: c.description || "",
                    car: c.car || "",
                    sort_order: c.sort_order != null ? String(c.sort_order) : "",
                  });
                }}
                onDelete={async () => {
                  if (!confirm(`Delete class "${c.name}"? Its drivers keep every point and stat they've scored — they just become unclassified.`)) return;
                  try {
                    await api(`/api/classes/${c.id}`, { method: "DELETE" });
                    if (editIds.class === c.id) { setClassForm(blankClass); setEditId("class", null); }
                    loadClasses();
                    refresh();
                  } catch (err) { showToast("error", err.message); }
                }} />
            ))}
          </div>
        </Panel>

        <Panel title="Races" step={5} muted={!seasonId} sub={seasonId ? `In ${season?.name}` : "Select a season above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            const heats = toArray(raceForm.heats);
            const body = {
              ...raceForm,
              sessions: sessionsToArray(raceForm.sessions),
              total_laps: raceForm.total_laps === "" ? 0 : Number(raceForm.total_laps),
              heat_format: !!raceForm.heat_format,
              heats: raceForm.heat_format ? (heats.length ? heats : ["Heat 1"]) : [],
              consolations: raceForm.heat_format ? toArray(raceForm.consolations) : [],
              feature_name: raceForm.feature_name.trim() || "A-Main Feature",
            };
            if (!editIds.race) body.season_id = seasonId;
            save("/api/races", body, editIds.race,
              () => { setRaceForm(blankRace); setEditId("race", null); });
            setTimeout(loadRaces, 400);
          }}>
            <div className="field"><label>Race Name</label>
              <input required disabled={!seasonId} value={raceForm.name} onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))} placeholder="Race 1 — Daytona Duel" /></div>
            <div className="field"><label>Track</label>
              <TrackSelect tracks={tracks} disabled={!seasonId} valueId={raceForm.track_id} valueName={raceForm.track}
                onChange={({ id, name, track }) => setRaceForm(f => ({ ...f, track: name, track_id: id || "", track_logo_url: f.track_logo_url || (track?.logo_url ?? "") }))}
                placeholder="Search tracks…" />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Pick from the Tracks database — or type a name to keep it as free text.</span></div>
            <div className="field"><label>Round Number</label>
              <input type="number" min="1" required disabled={!seasonId} value={raceForm.round_number} onChange={e => setRaceForm(f => ({ ...f, round_number: e.target.value }))} /></div>
            <div className="field"><label>Date</label>
              <input type="date" disabled={!seasonId} value={raceForm.date} onChange={e => setRaceForm(f => ({ ...f, date: e.target.value }))} /></div>
            {perClassSchedules && classes.length > 0 && (
              <div className="field"><label>Class</label>
                <select disabled={!seasonId} value={raceForm.class_id}
                  onChange={e => setRaceForm(f => ({ ...f, class_id: e.target.value }))}>
                  <option value="">All Classes (shared)</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}
                </select>
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Shared events run for every class. Pick a class to put this round on that
                  class&rsquo;s calendar alone.
                </span></div>
            )}
            <div className="field"><label>Total Race Laps</label>
              <input type="number" min="0" disabled={!seasonId} value={raceForm.total_laps} placeholder="e.g. 100"
                onChange={e => setRaceForm(f => ({ ...f, total_laps: e.target.value }))} />
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Used to auto-count laps completed: lead-lap finishers get the full total, laps-down (e.g. 2L) and DNFs subtract from it.
              </span></div>
            <div className="field"><label>Car Type</label>
              <input disabled={!seasonId} value={raceForm.car} placeholder={classes.length ? "Leave blank to use the class's / season's car" : "Leave blank to use the season's car"}
                onChange={e => setRaceForm(f => ({ ...f, car: e.target.value }))} /></div>
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="race_heat_format" disabled={!seasonId} checked={raceForm.heat_format}
                onChange={e => setRaceForm(f => ({ ...f, heat_format: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="race_heat_format" style={{ margin: 0 }}>This event uses heat racing (Heats → Consolation → Feature)</label>
            </div>
            {raceForm.heat_format ? (
              <>
                <div className="field"><label>Heats — comma-separated (e.g. Heat 1, Heat 2)</label>
                  <input disabled={!seasonId} value={raceForm.heats} placeholder="Heat 1, Heat 2"
                    onChange={e => setRaceForm(f => ({ ...f, heats: e.target.value }))} /></div>
                <div className="field"><label>Consolation races — comma-separated (e.g. C-Main, B-Main)</label>
                  <input disabled={!seasonId} value={raceForm.consolations} placeholder="B-Main"
                    onChange={e => setRaceForm(f => ({ ...f, consolations: e.target.value }))} /></div>
                <div className="field"><label>Feature name</label>
                  <input disabled={!seasonId} value={raceForm.feature_name} placeholder="A-Main Feature"
                    onChange={e => setRaceForm(f => ({ ...f, feature_name: e.target.value }))} /></div>
              </>
            ) : (
              <div className="field"><label>Races in this event — comma-separated (e.g. Race 1, Race 2, Sprint)</label>
                <input disabled={!seasonId} value={raceForm.sessions} placeholder="Race"
                  onChange={e => setRaceForm(f => ({ ...f, sessions: e.target.value }))} /></div>
            )}
            <ImageUpload label="Track Logo" kind="track-logo" value={raceForm.track_logo_url} onUploaded={url => setRaceForm(f => ({ ...f, track_logo_url: url }))} />
            <button className="btn btn-primary" type="submit" disabled={!seasonId}>{editIds.race ? "Save Changes" : "Add Race"}</button>
            {editIds.race && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("race", null); setRaceForm(blankRace); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {races.map(r => {
              // A class-pinned round is labelled so a mixed calendar is readable
              // at a glance; shared rounds read as they always have.
              const cls = r.class_id ? classes.find(c => c.id === r.class_id) : null;
              return (
              <ItemRow key={r.id} logo={r.track_logo_url}
                name={`R${r.round_number} · ${r.name}${cls ? ` · ${cls.name} only` : ""}`}
                editing={editIds.race === r.id}
              onEdit={() => {
                setEditId("race", r.id);
                setRaceForm({
                  name: r.name || "",
                  track: r.track || "",
                  track_id: r.track_id || "",
                  date: r.date || "",
                  round_number: String(r.round_number ?? ""),
                  track_logo_url: r.track_logo_url || "",
                  sessions: Array.isArray(r.sessions) && r.sessions.length ? r.sessions.join(", ") : "Race",
                  car: r.car || "",
                  total_laps: r.total_laps != null ? String(r.total_laps) : "",
                  heat_format: !!r.heat_format,
                  heats: Array.isArray(r.heats) ? r.heats.join(", ") : "",
                  consolations: Array.isArray(r.consolations) ? r.consolations.join(", ") : "",
                  feature_name: r.feature_name || "A-Main Feature",
                  class_id: r.class_id || "",
                });
              }}
              onDelete={() => remove(`/api/races/${r.id}`, `Delete race "${r.name}"?`)} />
              );
            })}
          </div>
        </Panel>
      </div>

      <h3 className="setup-section-title">
        Shared Library
        <span className="setup-section-hint">Reusable building blocks — the same across every game &amp; season</span>
      </h3>
      <div className="two-col" style={{ marginTop: 14 }}>
        <Panel title="Tracks" sub="Venue database shared across every game & season">
          <form onSubmit={async e => {
            e.preventDefault();
            const body = { ...trackForm };
            try {
              if (editIds.track) await api(`/api/tracks/${editIds.track}`, { method: "PATCH", body });
              else await api("/api/tracks", { method: "POST", body });
              showToast("success", editIds.track ? "Track updated." : "Track saved.");
              setTrackForm(blankTrack); setEditId("track", null); loadTracks();
            } catch (err) { showToast("error", err.message); }
          }}>
            <div className="field"><label>Track Name</label>
              <input required value={trackForm.name} onChange={e => setTrackForm(f => ({ ...f, name: e.target.value }))} placeholder="Daytona International Speedway" /></div>
            <div className="field"><label>Location</label>
              <input value={trackForm.location} onChange={e => setTrackForm(f => ({ ...f, location: e.target.value }))} placeholder="Daytona Beach, FL" /></div>
            <div className="two-col" style={{ gap: 12 }}>
              <div className="field"><label>Length</label>
                <input value={trackForm.length} onChange={e => setTrackForm(f => ({ ...f, length: e.target.value }))} placeholder="2.5 mi" /></div>
              <div className="field"><label>Type</label>
                <select value={trackForm.track_type} onChange={e => setTrackForm(f => ({ ...f, track_type: e.target.value }))}>
                  <option value="">—</option>
                  {TRACK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  {/* Keep a value outside the canonical list visible while editing
                      a track that carries it, so saving doesn't silently blank the
                      type. */}
                  {trackForm.track_type && !TRACK_TYPES.includes(trackForm.track_type) && (
                    <option value={trackForm.track_type}>{trackForm.track_type} (custom)</option>
                  )}
                </select></div>
            </div>
            <div className="field"><label>Notes</label>
              <input value={trackForm.notes} onChange={e => setTrackForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional description" /></div>
            <ImageUpload label="Track Logo" kind="track-logo" value={trackForm.logo_url} onUploaded={url => setTrackForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit">{editIds.track ? "Save Changes" : "Add Track"}</button>
            {editIds.track && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("track", null); setTrackForm(blankTrack); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {tracks.map(t => <ItemRow key={t.id} logo={t.logo_url}
              name={`${t.name}${t.track_type ? ` · ${t.track_type}` : ""}`} editing={editIds.track === t.id}
              onEdit={() => {
                setEditId("track", t.id);
                setTrackForm({
                  name: t.name || "", location: t.location || "", length: t.length || "",
                  track_type: t.track_type || "", logo_url: t.logo_url || "", notes: t.notes || "",
                });
              }}
              onDelete={async () => {
                if (!confirm(`Delete track "${t.name}"? Races already assigned to it keep their track name but lose the link.`)) return;
                try { await api(`/api/tracks/${t.id}`, { method: "DELETE" }); loadTracks(); }
                catch (err) { showToast("error", err.message); }
              }} />)}
          </div>
        </Panel>

        <Panel title="Points Templates" sub="Reusable scoring structures — assign to a season or any session's points">
          <form onSubmit={e => { e.preventDefault(); saveTemplateForm(); }}>
            <div className="field"><label>Template Name</label>
              <input required value={templateForm.name} placeholder="e.g. PRA Standard, Sprint Cup, Heat Race"
                onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="field"><label>Race Points — comma-separated, 1st place first (blank = 0 points)</label>
              <textarea rows={3} value={templateForm.race_points}
                placeholder="350, 320, 300, 280, 260, 250, 240, …"
                onChange={e => setTemplateForm(f => ({ ...f, race_points: e.target.value }))} /></div>
            <div className="field"><label>Qualifying Points — comma-separated, pole first (blank = 0 points)</label>
              <textarea rows={2} value={templateForm.qual_points}
                placeholder="35, 32, 30, 28, 26, 25, …"
                onChange={e => setTemplateForm(f => ({ ...f, qual_points: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              {BONUS_TYPES.map(([key, label]) => (
                <div className="field" key={key}><label>{label}</label>
                  <input type="number" min="0" value={templateForm.bonuses[key]}
                    onChange={e => setTemplateForm(f => ({ ...f, bonuses: { ...f.bonuses, [key]: e.target.value } }))} /></div>
              ))}
            </div>
            <button className="btn btn-primary" type="submit">{editIds.template ? "Save Changes" : "Add Template"}</button>
            {editIds.template && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("template", null); setTemplateForm(blankTemplate); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {templates.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0 }}>No saved templates yet. The Standard presets (NASCAR, IMSA, F1, …) are always available when assigning points.</p>
            ) : templates.map(t => (
              <ItemRow key={t.id} name={t.name} editing={editIds.template === t.id}
                onEdit={() => editTemplate(t)}
                onDelete={() => deleteTemplateById(t)} />
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}

export default function AdminPage() {
  return <AdminGate><AdminInner /></AdminGate>;
}
