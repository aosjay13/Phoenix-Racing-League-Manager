"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { LeagueSettings } from "@/components/LeagueSettings";
import { BackupRestore } from "@/components/BackupRestore";
import { useAuth } from "@/components/AuthProvider";
import { ImageUpload } from "@/components/ImageUpload";
import { TrackSelect } from "@/components/TrackSelect";
import { RaceLengthField } from "@/components/RaceLengthField";
import { TrackMergeModal } from "@/components/TrackMergeModal";
import { LENGTH_LAPS, raceLengthBody, raceLengthForm } from "@/lib/raceLength";
import { api } from "@/lib/api";
import { ALL_BONUS_TYPES, BONUS_TYPES } from "@/lib/standings";
import { TRACK_TYPES } from "@/lib/trackTypes";
import { listToTableOrZero, tableToList } from "@/lib/pointsTemplates";
import { carForClass } from "@/lib/classFilter";
import { SeasonForm } from "@/components/SeasonForm";
import { BangerBonusFields, PointsFields } from "@/components/PointsFields";
import { BLANK_SEASON_FORM, scoresNoPoints, seasonFormToBody, seasonToForm } from "@/lib/seasonForm";
import { isCustomOrdered, seasonDateRangeLabel } from "@/lib/seasonOrder";
import { BLANK_SERIES_FORM, seriesFormToBody, seriesToForm } from "@/lib/seriesForm";
import { BLANK_CLASS_FORM, classFormToBody, classToForm, seasonPointsAsClassFields } from "@/lib/classForm";
import { classScoresOwnPoints, definesPoints } from "@/lib/standings";
import { bangerEntryScope, isBangerDoc } from "@/lib/bangerRacing";
import { isBracketDoc } from "@/lib/bracketRacing";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { carOptionList, resolveCarSelection } from "@/lib/carSelection";

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

// League Setup is one screen per topic, reached from the button row at the top,
// rather than every form stacked into one long scroll. `group` splits the row
// into the league hierarchy (build it top-down) and the reusable library.
const SECTIONS = [
  { key: "league",    label: "League",          icon: "🏛", group: "structure", hint: "Name, logo & multi-league" },
  { key: "games",     label: "Games",           icon: "🎮", group: "structure", hint: "iRacing, F1 25, GT7…" },
  { key: "series",    label: "Series",          icon: "🏆", group: "structure", hint: "Championships within a game" },
  { key: "seasons",   label: "Seasons",         icon: "📅", group: "structure", hint: "A series' runs & their points" },
  { key: "classes",   label: "Classes",         icon: "🎽", group: "structure", hint: "Split a season's field" },
  { key: "races",     label: "Races",           icon: "🏁", group: "structure", hint: "A season's calendar" },
  { key: "tracks",    label: "Tracks",          icon: "🏟", group: "library",   hint: "Shared venue database" },
  { key: "templates", label: "Points Templates", icon: "🔢", group: "library",  hint: "Reusable scoring structures" },
  // Recovery tools. Owner-only — the whole row is hidden for the other staff
  // roles, since only an Owner can export or import the database.
  { key: "backup",    label: "Backup & Restore", icon: "💾", group: "data",     hint: "Export/import the entire app as JSON" },
];

// "🚗 car lock-in · 3 cars" for a list row, or null when this doc asks for no
// car selection of its own — so a glance down the Series / Seasons / Classes
// lists shows where the lock-in is switched on.
function carLockinMeta(doc) {
  if (!doc?.require_car_selection) return null;
  const n = carOptionList(doc).length;
  return `🚗 car lock-in${n ? ` · ${n} car${n === 1 ? "" : "s"}` : " · no cars listed"}${doc.car_selection_locked ? " · locked" : ""}`;
}

function toArray(str) {
  return String(str || "").split(",").map(s => s.trim()).filter(Boolean);
}
function sessionsToArray(str) {
  const list = toArray(str);
  return list.length ? list : ["Race"];
}

function AdminInner() {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const league = useLeague();
  const { games, seriesList, seasons, gameId, seriesId, seasonId, game, series, season, refresh } = league;
  // Demo Derby / Banger Racing can be set at series, season or class level (see
  // lib/bangerRacing.js). `bangerSeries` covers everything under the selected
  // series; `bangerSeason` adds the selected season's own flag. Each form below
  // also reads its OWN in-progress switch, so ticking one reveals that level's
  // derby bonuses straight away rather than after a save.
  const bangerSeries = isBangerDoc(series);
  const bangerSeason = bangerSeries || isBangerDoc(season);
  // Bracket Style Racing sits on a series or on a single class (see
  // lib/bracketRacing.js). A flagged series already covers every class in it, so
  // the class switch below is only offered where it would actually do something.
  const bracketSeries = isBracketDoc(series);
  const [races, setRaces] = useState([]);
  const [toast, setToast] = useState(null);
  // Which setup screen is open. Starts on Games — the top of the hierarchy an
  // admin actually edits.
  const [section, setSection] = useState("games");

  const [gameForm, setGameForm] = useState({ name: "", logo_url: "" });
  // `isBangerRacing` turns this series into a Demo Derby / Banger Racing series
  // — see lib/bangerRacing.js and the toggle in the Series panel below.
  const [seriesForm, setSeriesForm] = useState(BLANK_SERIES_FORM);
  const [showSeriesPoints, setShowSeriesPoints] = useState(false);
  const patchSeriesForm = patch => setSeriesForm(f => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
  const [editIds, setEditIds] = useState({ game: null, series: null, season: null, class: null, race: null, track: null, template: null });
  const setEditId = (type, id) => setEditIds(ids => ({ ...ids, [type]: id }));
  // The season's own fields live in the shared <SeasonForm> (and lib/seasonForm.js),
  // which League Setup and the Schedule's "+ New Season" dialog both render — so
  // the two screens can't drift apart. Only the edit-vs-create bookkeeping is here.
  const [seasonForm, setSeasonForm] = useState(BLANK_SEASON_FORM);
  const [templates, setTemplates] = useState([]);
  const blankTemplate = {
    name: "", race_points: "", qual_points: "",
    bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, "0"])),
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
      bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
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
      // The season form's own template picker refreshes off `templates`; a
      // selection pointing at the deleted doc simply stops resolving.
      loadTemplates();
    } catch (err) { showToast("error", err.message); }
  }

  const blankRace = {
    name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race", car: "",
    // Distance: a lap count, or a duration for a race run to the clock.
    length_type: LENGTH_LAPS, total_laps: "", race_minutes: "", total_rounds: "",
    heat_format: false, heats: "", consolations: "", feature_name: "A-Main Feature",
    // Blank = shared by every class. Only settable while the season has
    // per-class schedules turned on.
    class_id: "",
  };
  const [raceForm, setRaceForm] = useState(blankRace);

  // Classes divide the selected season's field into separately-scored groups
  // ("Pro"/"Amateur", GT3/LMP2). Empty list = a single-class season, which is
  // exactly how the app behaved before classes existed.
  const blankClass = BLANK_CLASS_FORM;
  const [classForm, setClassForm] = useState(blankClass);
  // The class points block is collapsed until an admin goes looking for it, the
  // same way the season's is.
  const [showClassPoints, setShowClassPoints] = useState(false);
  const patchClassForm = patch => setClassForm(f => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
  // Turning a class's own structure ON seeds it from the season it belongs to,
  // so an override starts from what the class was already scoring rather than
  // from blank — which would silently drop it to 0 points a race.
  function toggleOwnPoints(on) {
    setShowClassPoints(on);
    setClassForm(f => ({
      ...f,
      own_points: on,
      ...(on && !f.race_points && !f.qual_points ? seasonPointsAsClassFields(season || {}) : {}),
    }));
  }
  const [classes, setClasses] = useState([]);
  const loadClasses = useCallback(() => {
    if (!seasonId) { setClasses([]); return; }
    api(`/api/classes?season_id=${seasonId}`).then(setClasses).catch(() => setClasses([]));
  }, [seasonId]);
  useEffect(loadClasses, [loadClasses]);

  // Where the derby bonus values are offered. The season's Points & Bonuses
  // takes them whenever ANYTHING in this season's scope races derby — including
  // a season that only runs ONE banger class, which otherwise had nowhere above
  // the class to set a rate. The class form takes them for a derby class, and
  // reads its own in-progress switch so ticking it reveals the fields at once.
  // (A derby season's own switch is handled inside <SeasonForm> the same way.)
  // The season's own answer decides whether the SEASON's editors carry derby
  // values: "off" keeps a racing season clean even when one of its classes is a
  // derby (see isBangerScope). The class's own flag is unaffected — a derby
  // class always gets its derby rates.
  // Points editors offer the derby rates wherever derby results will be scored
  // (the entry rule) — that's configuration, not a stats table.
  const bangerSeasonScope = bangerEntryScope({ series, season, classes });
  const classBanger = bangerEntryScope({ series, season, cls: { isBangerRacing: !!classForm.isBangerRacing } })
    || !!classForm.isBangerRacing;

  // Whether this season lets each class run its own calendar. Gates the Class
  // field on the race form — with it off, every race stays shared.
  const perClassSchedules = !!season?.per_class_schedules;

  const blankTrack = { name: "", location: "", length: "", track_type: "", logo_url: "", notes: "" };
  const [trackForm, setTrackForm] = useState(blankTrack);
  const [tracks, setTracks] = useState([]);
  // The venue duplicates get folded INTO, while the merge dialog is open.
  const [mergingTrack, setMergingTrack] = useState(null);
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

  // ── Season order ────────────────────────────────────────────────────────
  // Seasons sort themselves newest-first off their race dates (see
  // lib/seasonOrder.js), which is right for every league that dates its
  // schedule. The arrows below are the override for the ones that don't — or
  // that want a particular season pinned to the top. Moving one writes the
  // whole arrangement at once, since a position only means anything relative to
  // the rest of the list.
  const [reorderingSeasons, setReorderingSeasons] = useState(false);
  const seasonsHandSorted = isCustomOrdered(seasons);

  async function saveSeasonOrder(body, msg) {
    if (!seriesId) return;
    setReorderingSeasons(true);
    try {
      await api("/api/seasons/reorder", { method: "POST", body: { series_id: seriesId, ...body } });
      if (msg) showToast("success", msg);
      refresh();
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setReorderingSeasons(false);
    }
  }

  function moveSeason(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= seasons.length) return;
    const next = [...seasons];
    [next[index], next[target]] = [next[target], next[index]];
    saveSeasonOrder({ season_ids: next.map(s => s.id) });
  }

  return (
    <section>
      <div className="page-title"><h2>League Setup</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 680 }}>
        Your league is a hierarchy — a <strong>Game</strong> holds <strong>Series</strong>, a series holds
        <strong> Seasons</strong>, and a season holds its <strong>Classes</strong> and <strong>Races</strong>.
        Pick what you&apos;re working in with the dropdowns at the top of the page; the banner below always
        shows your current spot, and the buttons under it open one setup screen at a time.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

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

      {/* One button per setup screen — nothing is stacked, so switching topics
          never means scrolling past the form you're not using. */}
      <div className="setup-switch">
        <span className="setup-switch-label">League Structure</span>
        <div className="setup-switch-row">
          {SECTIONS.filter(s => s.group === "structure").map(s => (
            <button key={s.key} type="button" title={s.hint}
              className={`tab setup-switch-btn${section === s.key ? " active" : ""}`}
              onClick={() => setSection(s.key)}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </button>
          ))}
        </div>
        <span className="setup-switch-label">Shared Library</span>
        <div className="setup-switch-row">
          {SECTIONS.filter(s => s.group === "library").map(s => (
            <button key={s.key} type="button" title={s.hint}
              className={`tab setup-switch-btn${section === s.key ? " active" : ""}`}
              onClick={() => setSection(s.key)}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </button>
          ))}
        </div>
        {isOwner && (
          <>
            <span className="setup-switch-label">Data &amp; Recovery</span>
            <div className="setup-switch-row">
              {SECTIONS.filter(s => s.group === "data").map(s => (
                <button key={s.key} type="button" title={s.hint}
                  className={`tab setup-switch-btn${section === s.key ? " active" : ""}`}
                  onClick={() => setSection(s.key)}>
                  <span aria-hidden="true">{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="setup-stage">
        {/* Multi-league: settings for the active league + Owner-only create/migrate. */}
        {section === "league" && <LeagueSettings />}

        {/* Whole-application export/import, plus the weekly automatic backup. */}
        {section === "backup" && <BackupRestore />}

        {section === "games" && (
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
        )}

        {section === "series" && (
        <Panel title="Series" step={2} muted={!gameId} sub={gameId ? `In ${game?.name}` : "Select a game above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            const body = seriesFormToBody(seriesForm);
            save("/api/series", editIds.series ? body : { ...body, game_id: gameId }, editIds.series,
              () => { setSeriesForm(BLANK_SERIES_FORM); setShowSeriesPoints(false); setEditId("series", null); });
          }}>
            <div className="field"><label>Series Name</label>
              <input required disabled={!gameId} value={seriesForm.name} onChange={e => setSeriesForm(f => ({ ...f, name: e.target.value }))} placeholder="Asphalt Assault Series" /></div>
            <ImageUpload label="Series Logo" kind="series-logo" value={seriesForm.logo_url} onUploaded={url => setSeriesForm(f => ({ ...f, logo_url: url }))} />

            {/* Demo Derby / Banger Racing. The one switch behind the whole mode:
                it adds the derby stats to this series' results grids, the derby
                bonuses to its points structures, and their totals to ITS
                standings and stats — and nowhere else. */}
            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="series_banger_racing" disabled={!gameId}
                checked={!!seriesForm.isBangerRacing}
                onChange={e => setSeriesForm(f => ({ ...f, isBangerRacing: e.target.checked }))}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="series_banger_racing" style={{ margin: 0 }}>
                Demo Derby / Banger Racing Mode
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off (default): an ordinary racing series. On: every event in this series captures{" "}
                  <strong>Takedowns</strong>, a <strong>Survival Bonus</strong> (whoever survived longest)
                  and a <strong>Most Lethal Bonus</strong> (most takedowns) on each results row, and its
                  points structures gain a value for each — points per takedown, and a one-off value for
                  each bonus. These stats show on <strong>this series&rsquo;</strong> Standings and Stats
                  only: they never appear in the Overall or per-Game views, where they&rsquo;d mean nothing.
                </span>
              </label>
            </div>

            {/* Bracket Style Racing. Adds no stats and no bonuses — it changes
                only the SHAPE of a results grid, so the drivers eliminated in
                the same round share one finishing position. See
                lib/bracketRacing.js. */}
            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="series_bracket_racing" disabled={!gameId}
                checked={!!seriesForm.isBracketRacing}
                onChange={e => setSeriesForm(f => ({ ...f, isBracketRacing: e.target.checked }))}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="series_bracket_racing" style={{ margin: 0 }}>
                Bracket Style Racing
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off (default): finishing positions run 1, 2, 3, 4… down the field. On: every event in
                  this series is entered as an elimination bracket — pick a <strong>4</strong>,{" "}
                  <strong>8</strong>, <strong>16</strong> or <strong>32</strong>-driver ladder on the
                  results screen and the grid lays itself out from it, so everyone knocked out in the
                  same round shares one position: one winner, one runner-up, <strong>two</strong> 3rd
                  places (the semi-finals), <strong>four</strong> 4ths (the quarters), and so on. These
                  are ordinary racing finishes — a bracket 3rd counts as a straight 3 in Average Finish,
                  both 3rd-place drivers are paid identical points, and it all cascades into Wins, Top 5s
                  and the Overall and per-Game stats like any other result.
                </span>
              </label>
            </div>

            {/* Car selection / lock-in for every season and class in this
                series — the same block the Seasons and Classes panels render.
                See lib/carSelection.js. */}
            <CarSelectionFields value={seriesForm} onChange={setSeriesForm} level="series" disabled={!gameId} />

            {/* The series' points are the league DEFAULT: every season in it
                scores on these unless the season (or one of its classes)
                overrides them. Left blank the series sets nothing and each
                season keeps its own points, exactly as before. */}
            <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }}
              onClick={() => setShowSeriesPoints(v => !v)}>
              {showSeriesPoints ? "▾" : "▸"} Default Points &amp; Bonuses for this series
            </button>
            {showSeriesPoints && (
              <>
                <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--ink-2)", maxWidth: 640 }}>
                  Set once here and every season in {series?.name || "this series"} scores on it. A season
                  can override any part of it, and a class can override the season — each level only changes
                  what it actually sets. Leave these blank and nothing changes: seasons keep their own points.
                </p>
                <PointsFields value={seriesForm} onPatch={patchSeriesForm} templates={templates}
                  onTemplatesChanged={loadTemplates} disabled={!gameId} onError={msg => showToast("error", msg)}
                  seriesLevel banger={!!seriesForm.isBangerRacing} />
              </>
            )}

            <button className="btn btn-primary" type="submit" disabled={!gameId}>{editIds.series ? "Save Changes" : "Add Series"}</button>
            {editIds.series && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("series", null); setSeriesForm(BLANK_SERIES_FORM); setShowSeriesPoints(false); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {seriesList.map(s => <ItemRow key={s.id} logo={s.logo_url} name={s.name}
              meta={[isBangerDoc(s) ? "💥 Demo Derby / Banger Racing" : null,
                     definesPoints(s) ? "default points set" : null,
                     carLockinMeta(s)].filter(Boolean).join(" · ")}
              editing={editIds.series === s.id}
              onEdit={() => {
                setEditId("series", s.id);
                setSeriesForm(seriesToForm(s));
                setShowSeriesPoints(definesPoints(s));
              }}
              onDelete={() => remove(`/api/series/${s.id}`, `Delete series "${s.name}"?`)} />)}
          </div>
        </Panel>
        )}

        {section === "seasons" && (
        <Panel title="Seasons" step={3} muted={!seriesId} sub={seriesId ? `In ${series?.name}` : "Select a series above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            const body = seasonFormToBody(seasonForm);
            if (!editIds.season) {
              body.series_id = seriesId;
              body.game_id = gameId;
            }
            save("/api/seasons", body, editIds.season, () => { setSeasonForm(BLANK_SEASON_FORM); setEditId("season", null); });
          }}>
            {/* Shared with the Schedule page's "+ New Season" dialog, so both
                offer exactly the same options — see components/SeasonForm.jsx. */}
            <SeasonForm
              key={editIds.season ?? "new"}
              value={seasonForm} onChange={setSeasonForm}
              templates={templates} onTemplatesChanged={loadTemplates}
              disabled={!seriesId} defaultPointsOpen={!!editIds.season}
              onError={msg => showToast("error", msg)}
              banger={bangerSeries}
              classesAreBanger={classes.some(isBangerDoc)}
              seriesDoc={series}
            />

            <span style={{ display: "block" }}>
              <button className="btn btn-primary" type="submit" disabled={!seriesId}>{editIds.season ? "Save Changes" : "Add Season"}</button>
              {editIds.season && (
                <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                  onClick={() => { setEditId("season", null); setSeasonForm(BLANK_SEASON_FORM); }}>Cancel</button>
              )}
            </span>
          </form>
          {/* Season order. Newest at the top by default, judged on the race
              dates in each season — so a Season 5 entered before 2, 3 and 4
              still sits above them. The arrows override that when a league
              wants its own order. */}
          {seasons.length > 1 && (
            <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)", flex: 1, minWidth: 260 }}>
                {seasonsHandSorted
                  ? <>Sorted by hand. These seasons stay in the order below everywhere in the app.</>
                  : <>Newest first, by <strong>race date</strong> — the season whose schedule starts latest is
                     at the top, in this list and in the Season dropdown. Use the arrows to set your own order.</>}
              </span>
              {seasonsHandSorted && (
                <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
                  disabled={reorderingSeasons}
                  onClick={() => saveSeasonOrder({ reset: true }, "Back to newest-first by race date.")}>
                  ↺ Sort by race date
                </button>
              )}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {seasons.map((s, i) => (
              <ItemRow key={s.id} logo={s.logo_url} name={s.name} editing={editIds.season === s.id}
                meta={[seasonDateRangeLabel(s) || "No dated races yet",
                     isBangerDoc(s) ? "💥 Demo Derby / Banger Racing" : null,
                     definesPoints(s) ? "default points set" : null,
                     carLockinMeta(s)].filter(Boolean).join(" · ")}
                onEdit={() => {
                  setEditId("season", s.id);
                  setSeasonForm(seasonToForm(s));
                }}
                onDelete={() => remove(`/api/seasons/${s.id}`, `Delete season "${s.name}"?`)}>
                {seasons.length > 1 && (
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    <button className="btn btn-ghost" type="button" title="Move up"
                      style={{ marginTop: 0, padding: "4px 8px" }}
                      disabled={reorderingSeasons || i === 0}
                      onClick={() => moveSeason(i, -1)}>▲</button>
                    <button className="btn btn-ghost" type="button" title="Move down"
                      style={{ marginTop: 0, padding: "4px 8px" }}
                      disabled={reorderingSeasons || i === seasons.length - 1}
                      onClick={() => moveSeason(i, 1)}>▼</button>
                  </span>
                )}
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
        )}

        {section === "classes" && (
        <Panel title="Classes" step={4} muted={!seasonId}
          sub={seasonId ? `In ${season?.name} — optional; leave empty for a single-class season` : "Select a season above first"}>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
            Split this season&rsquo;s field into separately-scored groups — <strong>Pro</strong> and{" "}
            <strong>Amateur</strong>, or <strong>GT3</strong> and <strong>LMP2</strong>. Each class runs its own
            championship (points, wins, averages), and a <strong>Class</strong> menu appears next to
            Game / Series / Season on Standings, Stats and Records. Assign drivers to a class on{" "}
            <strong>Drivers ▸ Roster &amp; Teams</strong> or right in the results grid. Give a class its own{" "}
            <strong>Car Type</strong> and the schedule shows which car goes with which class — handy
            when divisions run different machinery. Each class can also score on its own{" "}
            <strong>points structure</strong>, so Pro and Amateur pay different points for the same
            finishing position.
          </p>
          <form onSubmit={e => {
            e.preventDefault();
            const body = classFormToBody(classForm, classes.length, { banger: classBanger });
            if (!editIds.class) body.season_id = seasonId;
            save("/api/classes", body, editIds.class, () => {
              setClassForm(blankClass);
              setShowClassPoints(false);
              setEditId("class", null);
            });
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

            {/* Demo Derby / Banger Racing for this class alone — the case where
                a season runs a Banger class alongside ordinary racing ones.
                Hidden when the series or season above already runs derby, since
                this class does too and the switch would be a no-op. */}
            {!bangerSeason && (
              <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
                <input type="checkbox" id="class_banger_racing" disabled={!seasonId}
                  checked={!!classForm.isBangerRacing}
                  onChange={e => setClassForm(f => ({ ...f, isBangerRacing: e.target.checked }))}
                  style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
                <label htmlFor="class_banger_racing" style={{ margin: 0 }}>
                  Demo Derby / Banger Racing Class
                  <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                    Off (default): an ordinary racing class. On: <strong>this class</strong> races demo
                    derby while the rest of {season?.name ?? "the season"} races normally — its results
                    capture Takedowns, the Survival Bonus and the Most Lethal Bonus, its points structure
                    can pay for each, and its championship shows the totals. The other classes are
                    untouched, and the stats stay out of the Overall and per-Game stats views entirely.
                  </span>
                </label>
              </div>
            )}

            {/* Bracket Style Racing for this class alone — a drag-racing class
                running its ladder while the rest of the season races normally.
                Hidden when the series above already runs brackets, since this
                class does too and the switch would be a no-op. */}
            {!bracketSeries && (
              <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
                <input type="checkbox" id="class_bracket_racing" disabled={!seasonId}
                  checked={!!classForm.isBracketRacing}
                  onChange={e => setClassForm(f => ({ ...f, isBracketRacing: e.target.checked }))}
                  style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
                <label htmlFor="class_bracket_racing" style={{ margin: 0 }}>
                  Bracket Style Racing Class
                  <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                    Off (default): an ordinary racing class, positions 1, 2, 3, 4… On:{" "}
                    <strong>this class</strong> is entered as an elimination bracket while the rest of{" "}
                    {season?.name ?? "the season"} races normally — pick the ladder size (4, 8, 16 or 32
                    drivers) on the results screen and everyone knocked out in the same round shares one
                    finishing position. The finishes stay ordinary racing stats, so they feed Wins, Top 5s
                    and Average Finish everywhere, tied positions included.
                  </span>
                </label>
              </div>
            )}

            {/* Car selection / lock-in for this class alone — a class that
                sets its own list asks ITS drivers for their own pick, while
                the rest of the season keeps picking from the season's. */}
            <CarSelectionFields value={classForm} onChange={setClassForm} level="class" disabled={!seasonId}
              inherited={resolveCarSelection({ series, season })} />

            <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" id="class_own_points" disabled={!seasonId} checked={!!classForm.own_points}
                onChange={e => toggleOwnPoints(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
              <label htmlFor="class_own_points" style={{ margin: 0 }}>
                This class scores on its own points structure
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Off (default): the class scores on {season?.name ?? "the season"}&rsquo;s points, exactly as
                  before. On: the scale, qualifying points and bonuses below apply to every result this class
                  runs — its own championship and its share of the combined table alike — and the results
                  screen switches to them automatically when you pick this class. Seeded from the
                  season&rsquo;s current points so you start from what it already scores. A race session can
                  still override this class&rsquo;s points for one session.
                </span>
              </label>
            </div>

            {/* A derby class that ISN'T overriding the season's whole points
                structure still needs somewhere to set what a takedown is worth,
                so the derby values stand alone here. With "own points" on they
                move inside that structure instead (below), where the rest of
                the class's scale is. */}
            {classBanger && !classForm.own_points && (
              <BangerBonusFields value={classForm} onPatch={patchClassForm} disabled={!seasonId} />
            )}

            {classForm.own_points && (
              <>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 4 }}
                  onClick={() => setShowClassPoints(v => !v)}>
                  {showClassPoints ? "▾" : "▸"} {classForm.name || "Class"} Points &amp; Bonuses
                </button>
                {showClassPoints && (
                  <PointsFields value={classForm} onPatch={patchClassForm} templates={templates}
                    onTemplatesChanged={loadTemplates} disabled={!seasonId} onError={msg => showToast("error", msg)}
                    noPoints={false} inherits banger={classBanger} />
                )}
              </>
            )}

            <button className="btn btn-primary" type="submit" disabled={!seasonId}>{editIds.class ? "Save Changes" : "Add Class"}</button>
            {editIds.class && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId("class", null); setClassForm(blankClass); setShowClassPoints(false); }}>Cancel</button>
            )}
          </form>
          <div style={{ marginTop: 16 }}>
            {seasonId && classes.length === 0 && (
              <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0 }}>
                No classes yet — {season?.name ?? "this season"} scores as one combined field.
              </p>
            )}
            {classes.map(c => (
              <ItemRow key={c.id} name={c.name}
                meta={[carForClass(season, c), classToForm(c).own_points ? "own points" : null,
                       isBangerDoc(c) ? "💥 banger racing" : null,
                       carLockinMeta(c)].filter(Boolean).join(" · ")}
                editing={editIds.class === c.id}
                onEdit={() => {
                  setEditId("class", c.id);
                  setClassForm(classToForm(c));
                  setShowClassPoints(classToForm(c).own_points);
                }}
                onDelete={async () => {
                  if (!confirm(`Delete class "${c.name}"? Its drivers keep every stat they've scored — they just become unclassified.${classScoresOwnPoints(c) ? " Its own points structure goes with it, so their results re-score on the season's points." : ""}`)) return;
                  try {
                    await api(`/api/classes/${c.id}`, { method: "DELETE" });
                    if (editIds.class === c.id) { setClassForm(blankClass); setShowClassPoints(false); setEditId("class", null); }
                    loadClasses();
                    refresh();
                  } catch (err) { showToast("error", err.message); }
                }} />
            ))}
          </div>
        </Panel>
        )}

        {section === "races" && (
        <Panel title="Races" step={5} muted={!seasonId} sub={seasonId ? `In ${season?.name}` : "Select a season above first"}>
          <form onSubmit={e => {
            e.preventDefault();
            const heats = toArray(raceForm.heats);

            const body = {
              ...raceForm,
              sessions: sessionsToArray(raceForm.sessions),
              // Only the figure the chosen format uses is stored; the others
              // are zeroed so a race never keeps a stale length from the format
              // it was switched away from.
              ...raceLengthBody(raceForm),
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
            <RaceLengthField idPrefix="admin_race_length" disabled={!seasonId}
              lengthType={raceForm.length_type} totalLaps={raceForm.total_laps} raceMinutes={raceForm.race_minutes}
              totalRounds={raceForm.total_rounds}
              onChange={patch => setRaceForm(f => ({ ...f, ...patch }))} />
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
                  ...raceLengthForm(r),
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
        )}

        {section === "tracks" && (
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
          {/* ⧉ folds duplicates of the same circuit into a venue, under a name
              the admin picks — every race held at them (and all the history
              derived from those races) comes across. */}
          <div style={{ marginTop: 16 }}>
            {tracks.map(t => <ItemRow key={t.id} logo={t.logo_url}
              name={`${t.name}${t.track_type ? ` · ${t.track_type}` : ""}`} editing={editIds.track === t.id}
              children={
                <button className="btn btn-ghost" title="Merge duplicate venues into this one"
                  style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => setMergingTrack(t)}>⧉</button>
              }
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
        )}

        {mergingTrack && (
          <TrackMergeModal
            track={mergingTrack}
            tracks={tracks}
            onClose={() => setMergingTrack(null)}
            onMerged={res => {
              setMergingTrack(null);
              // The survivor may have been renamed and the losers are gone, so
              // reload the pool rather than patching it.
              loadTracks();
              // A merged-away track could be the one open in the form.
              if (res.merged_ids?.includes(editIds.track)) { setEditId("track", null); setTrackForm(blankTrack); }
              showToast("success", `Merged ${res.tracks_merged} track${res.tracks_merged === 1 ? "" : "s"} into “${res.track.name}” — ${res.races_moved} race${res.races_moved === 1 ? "" : "s"} moved across.`);
            }}
          />
        )}

        {section === "templates" && (
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
            {/* Templates are a shared library rather than a series' own points,
                so the derby values are always offered here — a template built
                for a Banger Racing series can carry them and be assigned to any
                of its sessions. They score nothing anywhere else. */}
            <BangerBonusFields value={templateForm}
              onPatch={patch => setTemplateForm(f => ({ ...f, ...patch }))} />
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
        )}
      </div>
    </section>
  );
}

export default function AdminPage() {
  return <AdminGate><AdminInner /></AdminGate>;
}
