"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { SessionEditor } from "@/components/SessionEditor";
import { TrackSelect } from "@/components/TrackSelect";
import { RaceLengthField } from "@/components/RaceLengthField";
import { LENGTH_LAPS, raceLengthBody, raceLengthForm } from "@/lib/raceLength";
import { normalizedBuiltinTemplates } from "@/lib/pointsTemplates";
import { carForRace, racePerClassResults, sessionClassScopes } from "@/lib/classFilter";
import { isBangerEvent, isBangerScope, derbyPointsTarget } from "@/lib/bangerRacing";
import { isBracketEvent, isBracketScope } from "@/lib/bracketRacing";
import { api } from "@/lib/api";

const BLANK_INFO = {
  name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race",
  // Distance: a lap count, a duration for a race run to the clock, or a number
  // of rounds. See lib/raceLength.js.
  length_type: LENGTH_LAPS, total_laps: "", race_minutes: "", total_rounds: "",
  car: "", heat_format: false, heats: "", consolations: "", feature_name: "A-Main Feature",
  class_id: "", per_class_results: false,
};

function RaceInfoTab({ race, season, classes = [], onSaved }) {
  const router = useRouter();
  const [form, setForm] = useState(BLANK_INFO);
  const [tracks, setTracks] = useState([]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/api/tracks").then(setTracks).catch(() => setTracks([])); }, []);

  useEffect(() => {
    if (!race) return;
    setForm({
      name: race.name || "",
      track: race.track || "",
      track_id: race.track_id || "",
      date: race.date || "",
      round_number: String(race.round_number ?? ""),
      track_logo_url: race.track_logo_url || "",
      sessions: Array.isArray(race.sessions) && race.sessions.length ? race.sessions.join(", ") : "Race",
      ...raceLengthForm(race),
      car: race.car || "",
      heat_format: !!race.heat_format,
      heats: Array.isArray(race.heats) ? race.heats.join(", ") : "",
      consolations: Array.isArray(race.consolations) ? race.consolations.join(", ") : "",
      feature_name: race.feature_name || "A-Main Feature",
      class_id: race.class_id || "",
      // Unset on the race = inherit the season default.
      per_class_results: racePerClassResults(race, season),
    });
  }, [race, season]);

  // The Class field exists only for a season running per-class calendars.
  const showClass = !!season?.per_class_schedules && classes.length > 0;
  // Splitting sessions by class is only meaningful when several classes share
  // this event: a round already pinned to one class has nothing to split.
  const showSplit = classes.length > 0 && !form.class_id;

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }
  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const sessions = form.sessions.split(",").map(s => s.trim()).filter(Boolean);
      const heats = form.heats.split(",").map(s => s.trim()).filter(Boolean);
      const consolations = form.consolations.split(",").map(s => s.trim()).filter(Boolean);
      const body = {
        name: form.name,
        track: form.track,
        track_id: form.track_id,
        date: form.date,
        round_number: Number(form.round_number),
        track_logo_url: form.track_logo_url,
        sessions: sessions.length ? sessions : ["Race"],
        // Only the figure the chosen format uses is stored; the others are
        // zeroed so a race never keeps a stale length from the format it was
        // switched away from.
        ...raceLengthBody(form),
        car: form.car,
        heat_format: !!form.heat_format,
        heats: form.heat_format ? (heats.length ? heats : ["Heat 1"]) : [],
        consolations: form.heat_format ? consolations : [],
        feature_name: form.feature_name.trim() || "A-Main Feature",
        // Only writable while the season runs per-class schedules; otherwise the
        // event stays shared by every class.
        class_id: showClass ? form.class_id : "",
        // Stored explicitly (rather than left to inherit) once the event has
        // been saved from this form, so changing the season default later never
        // silently re-splits or re-merges an event whose results already exist.
        per_class_results: showSplit ? !!form.per_class_results : false,
      };
      const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body });
      onSaved?.(updated);
      showToast("success", "Race info saved.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${race.name}" and all its results? This cannot be undone.`)) return;
    try {
      await api(`/api/races/${race.id}`, { method: "DELETE" });
      router.push("/schedule");
    } catch (err) {
      showToast("error", err.message);
    }
  }

  return (
    <div className="form-card" style={{ maxWidth: 560 }}>
      <form onSubmit={save}>
        <div className="field"><label>Race Name</label>
          <input required value={form.name} onChange={set("name")} placeholder="Race 1 — Daytona Duel" /></div>
        <div className="field"><label>Track</label>
          <TrackSelect tracks={tracks} valueId={form.track_id} valueName={form.track}
            onChange={({ id, name, track }) => setForm(f => ({ ...f, track: name, track_id: id || "", track_logo_url: f.track_logo_url || (track?.logo_url ?? "") }))}
            onTrackCreated={track => setTracks(ts => [...ts, track])}
            placeholder="Search tracks…" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Pick from the Tracks database — or type a name to keep it as free text.</span></div>
        <div className="field"><label>Round Number</label>
          <input type="number" min="1" required value={form.round_number} onChange={set("round_number")} /></div>
        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={set("date")} /></div>
        {showClass && (
          <div className="field"><label>Class</label>
            <select value={form.class_id} onChange={set("class_id")}>
              <option value="">All Classes (shared)</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              Shared events run for every class. Pick a class to put this round on that class&rsquo;s
              calendar alone.
            </span>
          </div>
        )}
        {showSplit && (
          <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
            <input type="checkbox" id="race_per_class_results" checked={!!form.per_class_results}
              onChange={e => setForm(f => ({ ...f, per_class_results: e.target.checked }))}
              style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
            <label htmlFor="race_per_class_results" style={{ margin: 0 }}>
              Separate results by class
              <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Every class runs this event, but each one gets its <strong>own</strong> Qualifying and
                Race — its own pole, its own P1, its own field. You pick the class from the menu above
                the tabs and enter that class&rsquo;s grid. Off: one combined grid for the whole field,
                with a Class column on each row.
              </span>
            </label>
          </div>
        )}
        <RaceLengthField idPrefix="edit_race_length"
          lengthType={form.length_type} totalLaps={form.total_laps} raceMinutes={form.race_minutes}
          totalRounds={form.total_rounds}
          onChange={patch => setForm(f => ({ ...f, ...patch }))} />
        <div className="field"><label>Car Type</label>
          <input value={form.car} onChange={set("car")} placeholder={classes.length ? "Leave blank to use the class's / season's car" : "Leave blank to use the season's car"} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Overrides the car for this event only — for every class running it. Leave it blank so each
            class shows its own car{season?.car ? `, falling back to ${season.car}` : ""}.
          </span>
        </div>

        <div className="field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
          <input type="checkbox" id="heat_format" checked={form.heat_format}
            onChange={e => setForm(f => ({ ...f, heat_format: e.target.checked }))}
            style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)" }} />
          <label htmlFor="heat_format" style={{ margin: 0 }}>This event uses heat racing (Heats → Consolation → Feature)</label>
        </div>

        {form.heat_format ? (
          <>
            <div className="field"><label>Heats — comma-separated (e.g. Heat 1, Heat 2)</label>
              <input value={form.heats} onChange={set("heats")} placeholder="Heat 1, Heat 2" /></div>
            <div className="field"><label>Consolation races — comma-separated (e.g. C-Main, B-Main)</label>
              <input value={form.consolations} onChange={set("consolations")} placeholder="B-Main" /></div>
            <div className="field"><label>Feature name</label>
              <input value={form.feature_name} onChange={set("feature_name")} placeholder="A-Main Feature" /></div>
          </>
        ) : (
          <div className="field"><label>Races in this event — comma-separated (e.g. Race 1, Race 2, Sprint)</label>
            <input value={form.sessions} onChange={set("sessions")} placeholder="Race" /></div>
        )}

        <ImageUpload label="Track Logo" kind="track-logo" value={form.track_logo_url}
          onUploaded={url => setForm(f => ({ ...f, track_logo_url: url }))} />

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Race Info"}</button>
        <button className="btn btn-danger" type="button" style={{ marginLeft: 8 }} onClick={remove}>Delete Race</button>
      </form>
    </div>
  );
}

function UnifiedEditInner() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialSession = searchParams.get("session") || undefined;

  const [tab, setTab] = useState(null); // resolved once the race loads, since valid tabs depend on heat_format
  const [race, setRace] = useState(null);
  const [season, setSeason] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [seriesName, setSeriesName] = useState("");
  // The series this event belongs to, fetched for its name and — the reason it's
  // kept whole rather than just its name — its Demo Derby / Banger Racing flag,
  // which decides whether the grids below carry the banger stat columns.
  const [series, setSeries] = useState(null);
  const [entries, setEntries] = useState([]);
  // This screen is reached by race id, so its season can differ from whatever
  // the top-bar dropdowns have selected — read the classes off THIS race's
  // season rather than the league context.
  const [classes, setClasses] = useState([]);
  const [templates, setTemplates] = useState(normalizedBuiltinTemplates());
  const [error, setError] = useState(null);
  // Which class's session is being edited on a split event. null until the
  // classes have loaded and a default is picked; a scope value thereafter.
  const [scope, setScope] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ev = await api(`/api/events/${id}`);
        if (cancelled) return;
        setRace({ id: ev.event.id, ...ev.event });
        setSeason(ev.season || null);
        setSeasonId(ev.event.season_id);
        const [e, c] = await Promise.all([
          api(`/api/entries?season_id=${ev.event.season_id}`),
          api(`/api/classes?season_id=${ev.event.season_id}`).catch(() => []),
        ]);
        if (!cancelled) { setEntries(e); setClasses(c); }
        const saved = await api("/api/points-templates");
        if (!cancelled) setTemplates([...normalizedBuiltinTemplates(), ...saved]);
        if (ev.season?.game_id && ev.season?.series_id) {
          const seriesList = await api(`/api/series?game_id=${ev.season.game_id}`);
          const found = seriesList.find(s => s.id === ev.season.series_id) || null;
          if (!cancelled) { setSeries(found); setSeriesName(found?.name ?? ""); }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // On a split event every session belongs to exactly one class, so the editor
  // needs a class chosen before it can show a grid. The scopes are the season's
  // classes, plus Unclassified when there are drivers with no class to enter.
  const perClassResults = racePerClassResults(race, season);
  const scopes = useMemo(
    () => (perClassResults ? sessionClassScopes(classes, entries) : []),
    [perClassResults, classes, entries]
  );
  useEffect(() => {
    if (!scopes.length) { setScope(null); return; }
    setScope(prev => (scopes.some(s => s.value === prev) ? prev : scopes[0].value));
  }, [scopes]);
  const scopeName = scopes.find(s => s.value === scope)?.label ?? "";
  // The car this class runs, resolved through class → season, for the bar below.
  const scopeCar = carForRace(race, season, classes.find(c => c.id === scope));
  // ── Demo Derby rates, set from the results grid ───────────────────────────
  //
  // A rate typed above the grid is written to the SEASON — the one structure
  // every result in it reads, whatever class the result ended up in (see
  // derbyPointsTarget). A class-level rate only reaches results stamped with
  // that class, which is how a flagged Banger class can record takedowns that
  // score nothing.
  const derbyTarget = useMemo(() => derbyPointsTarget({ season }), [season]);

  // Merge the new rates into that structure's existing bonuses (never replacing
  // the map, which would drop the traditional bonuses) and refresh the local
  // copy so the Points column re-scores immediately.
  const saveDerbyPoints = useCallback(async (values) => {
    if (!derbyTarget?.id) throw new Error("No season selected for this event.");
    let current = season?.bonus_points || {};
    if (typeof current === "string") { try { current = JSON.parse(current); } catch { current = {}; } }
    const updated = await api(`/api/seasons/${derbyTarget.id}`, {
      method: "PATCH", body: { bonus_points: { ...current, ...values } },
    });
    setSeason(s => ({ ...s, ...updated }));
  }, [derbyTarget, season]);

  // Bracket Style Racing: the ladder size for this event, saved on the race the
  // moment it's picked so the grid can re-lay itself out immediately (and so it
  // is still right when the screen is reopened). 0 is "Standard racing" — no
  // ladder — which is what makes an ordinary race in a bracket series possible,
  // and what hands a race back to a normal 1..N order.
  const saveBracketSize = useCallback(async (size) => {
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { bracket_size: Number(size) || 0 } });
    setRace(r => ({ ...r, ...updated }));
  }, [race]);

  // Props every SessionEditor on this screen shares: null scope = the combined
  // grid this screen has always shown.
  const classProps = {
    classes,
    // The series this event belongs to — the top of the points chain, so the
    // grid's Points column resolves exactly as the standings do.
    series,
    sessionClass: perClassResults ? scope : null,
    sessionClassName: perClassResults ? scopeName : "",
    // Demo Derby / Banger Racing — flagged on the series, the season, or a
    // class, and honored wherever the flagged thing is what's being entered
    // (the same resolution Bracket Style Racing uses):
    //
    //   • split event: the class whose grid is open answers for itself;
    //   • everything else: the EVENT rule (isBangerEvent) — flagged
    //     series/season, a round pinned to a flagged class, or a season whose
    //     classes are all derby (including the one-class season). Any of those
    //     grows the TD/SUR/LTH columns, the derby explainer, and the rate bar.
    //
    // The one grid a flagged class does not convert is a shared combined grid
    // it races alongside UNFLAGGED classes — derby columns would sit over
    // ordinary racing rows. Split that event's results by class and the
    // flagged class enters its takedowns on its own grid while the others
    // stay plain. See lib/bangerRacing.js.
    isBangerRacing: perClassResults
      ? isBangerScope({ series, season, cls: classes.find(c => c.id === scope) || null })
      : isBangerEvent({ series, season, race, classes }),
    // Where a derby rate typed above the grid is saved, and how.
    derbyTarget,
    onDerbyPointsSave: saveDerbyPoints,
    // Bracket Style Racing — selected on the series, the season, or a class,
    // and honored wherever the flagged thing is what's being entered:
    //
    //   • split event: the class whose grid is open answers for itself;
    //   • everything else: the EVENT rule (isBracketEvent) — flagged
    //     series/season, a round pinned to a flagged class, or a season whose
    //     classes all race brackets (including the one-class season). Any of
    //     those makes this grid an elimination ladder, full stop.
    //
    // The one grid a flagged class does not convert is a shared combined grid
    // it races alongside UNFLAGGED classes — regrouping that grid into rounds
    // would tie drivers from the ordinary classes, which must never change.
    // Split that event's results by class and the flagged class gets its
    // ladder on its own grid. See lib/bracketRacing.js.
    isBracketRacing: perClassResults
      ? isBracketScope({ series, season, cls: classes.find(c => c.id === scope) || null })
      : isBracketEvent({ series, season, race, classes }),
    // The ladder size this race ran, and how the dropdown above the grid saves
    // it. It lives on the RACE, so a league can run an 8-car bracket one week
    // and a 16 the next.
    bracketSize: race?.bracket_size ?? null,
    onBracketSizeChange: saveBracketSize,
  };

  const heatFormat = !!race?.heat_format;
  const tabs = useMemo(() => (
    heatFormat
      ? [["info", "Race Info"], ["qualifying", "Qualifying"], ["heats", "Heats"], ["consolation", "Consolation"], ["feature", race?.feature_name || "A-Main Feature"]]
      : [["info", "Race Info"], ["qualifying", "Qualifying"], ["results", "Race Results"]]
  ), [heatFormat, race?.feature_name]);

  useEffect(() => {
    if (!race) return;
    const valid = tabs.map(t => t[0]);
    const wanted = tabParam && valid.includes(tabParam) ? tabParam : "info";
    setTab(prev => (prev && valid.includes(prev) ? prev : wanted));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id, heatFormat]);

  // Refreshes just the driver list, without re-fetching the race — used
  // after a driver is added inline from within a results/qualifying editor.
  const reloadEntries = useCallback(async () => {
    if (!seasonId) return;
    setEntries(await api(`/api/entries?season_id=${seasonId}`));
  }, [seasonId]);

  // Refreshes the template list after one is created/edited from the inline
  // points-structure modal, so the Points column re-resolves immediately.
  const reloadTemplates = useCallback(async () => {
    setTemplates([...normalizedBuiltinTemplates(), ...(await api("/api/points-templates"))]);
  }, []);

  // Saves the assignment on the race AND cascades it onto any already-saved
  // results for that session, so points re-score everywhere immediately.
  // `sessionClass` is set on a split event, where the assignment belongs to ONE
  // class's session rather than the event's — see the session-points route.
  const sessionPoints = race?.session_points || {};
  const sessionPointsByClass = race?.session_points_by_class || {};
  const saveSessionPoints = useCallback(async (name, templateId, sessionType = "race", sessionClass = null) => {
    const updated = await api(`/api/races/${race.id}/session-points`, {
      method: "POST",
      body: {
        session: name, template_id: templateId || "", session_type: sessionType,
        ...(sessionClass ? { session_class: sessionClass } : {}),
      },
    });
    setRace(r => ({ ...r, ...updated }));
  }, [race]);

  // Per-session eligibility toggles (mirrors saveSessionPoints). Booleans are
  // stored explicitly — including `false` — so the engine can tell an admin's
  // deliberate "off" apart from the unset session-type default.
  const sessionStats = race?.session_stats || {};
  const sessionPointsEnabled = race?.session_points_enabled || {};
  const saveSessionFlag = useCallback(async (field, name, on) => {
    const current = (race?.[field]) || {};
    const next = { ...current, [name]: on };
    try {
      const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { [field]: next } });
      setRace(r => ({ ...r, ...updated }));
    } catch { /* non-critical — engine falls back to defaults */ }
  }, [race]);
  const saveSessionStats = useCallback((name, on) => saveSessionFlag("session_stats", name, on), [saveSessionFlag]);
  const saveSessionPointsEnabled = useCallback((name, on) => saveSessionFlag("session_points_enabled", name, on), [saveSessionFlag]);

  // Rename a session and cascade the change to saved results + points mapping.
  const renameSession = useCallback(async (type, from, to) => {
    const updated = await api(`/api/races/${race.id}/rename-session`, {
      method: "POST",
      body: { session_type: type, from, to },
    });
    setRace(r => ({ ...r, ...updated }));
  }, [race]);

  // Removing a session deletes its saved results too — orphaned results would
  // otherwise linger invisibly (and resurface if a session reused the name).
  const deleteSessionResults = useCallback(
    (name, type) => api(`/api/results?race_id=${race.id}&session=${encodeURIComponent(name)}&session_type=${type}`, { method: "DELETE" }),
    [race]
  );

  async function addStdSession(name) {
    const sessions = [...(race.sessions?.length ? race.sessions : ["Race"]), name];
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { sessions } });
    setRace(r => ({ ...r, ...updated }));
  }
  async function removeStdSession(name) {
    if (!confirm(`Remove ${name} and delete its saved results? This cannot be undone.`)) return;
    await deleteSessionResults(name, "race");
    const remaining = (race.sessions?.length ? race.sessions : ["Race"]).filter(s => s !== name);
    const sessions = remaining.length ? remaining : ["Race"];
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { sessions } });
    setRace(r => ({ ...r, ...updated }));
  }

  async function addHeat(name) {
    const heats = [...(race.heats || []), name];
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { heats } });
    setRace(r => ({ ...r, ...updated }));
  }
  async function removeHeat(name) {
    if (!confirm(`Remove ${name} and delete its saved results? This cannot be undone.`)) return;
    await deleteSessionResults(name, "heat");
    const heats = (race.heats || []).filter(h => h !== name);
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { heats } });
    setRace(r => ({ ...r, ...updated }));
  }
  async function addConsolation(name) {
    const consolations = [...(race.consolations || []), name];
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { consolations } });
    setRace(r => ({ ...r, ...updated }));
  }
  async function removeConsolation(name) {
    if (!confirm(`Remove ${name} and delete its saved results? This cannot be undone.`)) return;
    await deleteSessionResults(name, "consolation");
    const consolations = (race.consolations || []).filter(c => c !== name);
    const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body: { consolations } });
    setRace(r => ({ ...r, ...updated }));
  }

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!race || !tab) return <div className="skeleton" style={{ height: 260 }} />;

  const heats = race.heats?.length ? race.heats : ["Heat 1"];
  const consolations = race.consolations || [];
  const featureName = race.feature_name || "A-Main Feature";
  const standardSessions = Array.isArray(race.sessions) && race.sessions.length ? race.sessions : ["Race"];

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Edit · {race.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {race.track ? `${race.track} · ` : ""}{season?.name ?? ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href={`/races/${race.id}`} style={{ color: "var(--accent-cyan)", fontSize: "0.85rem" }}>View results →</Link>
          <Link href="/schedule" style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>Schedule</Link>
        </div>
      </div>

      {/* Which class am I entering results for? On a split event this is the
          switch that decides it — every grid below belongs to the class named
          here. A round pinned to one class says so instead of offering a menu. */}
      {perClassResults && scopes.length > 0 && (
        <div className="class-scope-bar">
          <label htmlFor="session-class">Entering results for</label>
          <select id="session-class" value={scope ?? ""} onChange={e => setScope(e.target.value)}>
            {scopes.map(s => <option key={s.value} value={s.value}>{s.car ? `${s.label} · ${s.car}` : s.label}</option>)}
          </select>
          {scopeCar && <span className="class-scope-chip" title="The car this class races">{scopeCar}</span>}
          <span style={{ color: "var(--ink-1)", fontSize: "0.84rem" }}>
            Each class runs its own Qualifying and Race at this event. Switch classes here to enter
            the next one — nothing you type in one class touches another.
          </span>
        </div>
      )}
      {!perClassResults && race.class_id && (
        <div className="class-scope-bar">
          <span className="class-scope-chip">{classes.find(c => c.id === race.class_id)?.name ?? "Class"}</span>
          <span style={{ color: "var(--ink-1)", fontSize: "0.84rem" }}>
            This round is on {classes.find(c => c.id === race.class_id)?.name ?? "one class"}&rsquo;s calendar
            only, so everything below is that class&rsquo;s.
          </span>
        </div>
      )}

      <div className="tab-row" style={{ marginTop: 16 }}>
        {tabs.map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "info" && (
        <RaceInfoTab race={race} season={season} classes={classes}
          onSaved={updated => setRace(r => ({ ...r, ...updated }))} />
      )}

      {tab === "qualifying" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName} {...classProps}
            sessionType="qualifying" sessionNames={["Qualifying"]}
            season={season} templates={templates} sessionPoints={sessionPoints} sessionPointsByClass={sessionPointsByClass} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
            sessionStats={sessionStats} onSessionStatsChange={saveSessionStats}
          />
        </div>
      )}

      {tab === "results" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} initialSession={initialSession} onEntriesChanged={reloadEntries} seriesName={seriesName} {...classProps}
            sessionType="race" sessionNames={standardSessions}
            season={season} templates={templates} sessionPoints={sessionPoints} sessionPointsByClass={sessionPointsByClass} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
            sessionStats={sessionStats} onSessionStatsChange={saveSessionStats}
            sessionPointsEnabled={sessionPointsEnabled} onSessionPointsEnabledChange={saveSessionPointsEnabled}
            canAddSession onAddSession={addStdSession} onRemoveSession={removeStdSession}
            onRenameSession={(from, to) => renameSession("race", from, to)}
          />
        </div>
      )}

      {tab === "heats" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName} {...classProps}
            sessionType="heat" sessionNames={heats}
            season={season} templates={templates} sessionPoints={sessionPoints} sessionPointsByClass={sessionPointsByClass} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
            sessionStats={sessionStats} onSessionStatsChange={saveSessionStats}
            sessionPointsEnabled={sessionPointsEnabled} onSessionPointsEnabledChange={saveSessionPointsEnabled}
            canAddSession onAddSession={addHeat} onRemoveSession={removeHeat}
            onRenameSession={(from, to) => renameSession("heat", from, to)}
          />
        </div>
      )}

      {tab === "consolation" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          {consolations.length ? (
            <SessionEditor
              race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName} {...classProps}
              sessionType="consolation" sessionNames={consolations}
              season={season} templates={templates} sessionPoints={sessionPoints} sessionPointsByClass={sessionPointsByClass} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
              sessionStats={sessionStats} onSessionStatsChange={saveSessionStats}
              sessionPointsEnabled={sessionPointsEnabled} onSessionPointsEnabledChange={saveSessionPointsEnabled}
              canAddSession onAddSession={addConsolation} onRemoveSession={removeConsolation}
              onRenameSession={(from, to) => renameSession("consolation", from, to)}
            />
          ) : (
            <div>
              <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>
                No consolation race yet — add one (e.g. &ldquo;B-Main&rdquo;) to seed drivers who didn&rsquo;t transfer from the heats.
              </p>
              <AddConsolationForm onAdd={addConsolation} />
            </div>
          )}
        </div>
      )}

      {tab === "feature" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName} {...classProps}
            sessionType="feature" sessionNames={[featureName]}
            season={season} templates={templates} sessionPoints={sessionPoints} sessionPointsByClass={sessionPointsByClass} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
            sessionStats={sessionStats} onSessionStatsChange={saveSessionStats}
            sessionPointsEnabled={sessionPointsEnabled} onSessionPointsEnabledChange={saveSessionPointsEnabled}
            onRenameSession={(from, to) => renameSession("feature", from, to)}
          />
        </div>
      )}
    </section>
  );
}

function AddConsolationForm({ onAdd }) {
  const [name, setName] = useState("B-Main");
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onAdd(name.trim()); }} style={{ display: "flex", gap: 8, maxWidth: 320 }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="B-Main" />
      <button className="btn btn-primary" type="submit" style={{ marginTop: 0 }}>Add</button>
    </form>
  );
}

export default function RaceEditPage() {
  return (
    <AdminGate>
      <Suspense fallback={<div className="skeleton" style={{ height: 260 }} />}>
        <UnifiedEditInner />
      </Suspense>
    </AdminGate>
  );
}
