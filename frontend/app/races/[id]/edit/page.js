"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { SessionEditor } from "@/components/SessionEditor";
import { TrackSelect } from "@/components/TrackSelect";
import { normalizedBuiltinTemplates } from "@/lib/pointsTemplates";
import { api } from "@/lib/api";

const BLANK_INFO = {
  name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race",
  total_laps: "", heat_format: false, heats: "", consolations: "", feature_name: "A-Main Feature",
};

function RaceInfoTab({ race, onSaved }) {
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
      total_laps: race.total_laps != null ? String(race.total_laps) : "",
      heat_format: !!race.heat_format,
      heats: Array.isArray(race.heats) ? race.heats.join(", ") : "",
      consolations: Array.isArray(race.consolations) ? race.consolations.join(", ") : "",
      feature_name: race.feature_name || "A-Main Feature",
    });
  }, [race]);

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
        total_laps: form.total_laps === "" ? 0 : Number(form.total_laps),
        heat_format: !!form.heat_format,
        heats: form.heat_format ? (heats.length ? heats : ["Heat 1"]) : [],
        consolations: form.heat_format ? consolations : [],
        feature_name: form.feature_name.trim() || "A-Main Feature",
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
            placeholder="Search tracks…" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Pick from the Tracks database — or type a name to keep it as free text.</span></div>
        <div className="field"><label>Round Number</label>
          <input type="number" min="1" required value={form.round_number} onChange={set("round_number")} /></div>
        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={set("date")} /></div>
        <div className="field"><label>Total Race Laps</label>
          <input type="number" min="0" value={form.total_laps} onChange={set("total_laps")} placeholder="e.g. 100" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Used to auto-count laps completed: lead-lap finishers get the full total, laps-down (e.g. 2L) and DNFs subtract from it.
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
  const [entries, setEntries] = useState([]);
  const [templates, setTemplates] = useState(normalizedBuiltinTemplates());
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ev = await api(`/api/events/${id}`);
        if (cancelled) return;
        setRace({ id: ev.event.id, ...ev.event });
        setSeason(ev.season || null);
        setSeasonId(ev.event.season_id);
        const e = await api(`/api/entries?season_id=${ev.event.season_id}`);
        if (!cancelled) setEntries(e);
        const saved = await api("/api/points-templates");
        if (!cancelled) setTemplates([...normalizedBuiltinTemplates(), ...saved]);
        if (ev.season?.game_id && ev.season?.series_id) {
          const seriesList = await api(`/api/series?game_id=${ev.season.game_id}`);
          if (!cancelled) setSeriesName(seriesList.find(s => s.id === ev.season.series_id)?.name ?? "");
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

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
  const sessionPoints = race?.session_points || {};
  const saveSessionPoints = useCallback(async (name, templateId, sessionType = "race") => {
    const updated = await api(`/api/races/${race.id}/session-points`, {
      method: "POST",
      body: { session: name, template_id: templateId || "", session_type: sessionType },
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

      <div className="tab-row" style={{ marginTop: 16 }}>
        {tabs.map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "info" && (
        <RaceInfoTab race={race} onSaved={updated => setRace(r => ({ ...r, ...updated }))} />
      )}

      {tab === "qualifying" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName}
            sessionType="qualifying" sessionNames={["Qualifying"]}
            season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
          />
        </div>
      )}

      {tab === "results" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <SessionEditor
            race={race} seasonId={seasonId} entries={entries} initialSession={initialSession} onEntriesChanged={reloadEntries} seriesName={seriesName}
            sessionType="race" sessionNames={standardSessions}
            season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
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
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName}
            sessionType="heat" sessionNames={heats}
            season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
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
              race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName}
              sessionType="consolation" sessionNames={consolations}
              season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
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
            race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={seriesName}
            sessionType="feature" sessionNames={[featureName]}
            season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
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
