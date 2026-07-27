"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { SessionEditor } from "@/components/SessionEditor";
import { normalizedBuiltinTemplates } from "@/lib/pointsTemplates";
import { carForRace, filterRacesByClass, racePerClassResults, sessionClassScopes } from "@/lib/classFilter";
import { api } from "@/lib/api";

function RaceEntryInner() {
  const { seasonId, season, series, classes, classId, raceClass } = useLeague();
  const [races, setRaces] = useState([]);
  const [entries, setEntries] = useState([]);
  const [raceId, setRaceId] = useState("");
  const [templates, setTemplates] = useState(normalizedBuiltinTemplates());
  // Which class's session is being entered, on an event that runs its classes
  // separately. Seeded from the Class menu in the top bar, so switching class up
  // there drops you straight into that class's grid.
  const [scope, setScope] = useState(null);

  const load = useCallback(async () => {
    if (!seasonId) { setRaces([]); setEntries([]); setRaceId(""); return; }
    const [r, e, t] = await Promise.all([
      api(`/api/races?season_id=${seasonId}`),
      api(`/api/entries?season_id=${seasonId}`),
      api("/api/points-templates"),
    ]);
    setRaces(r);
    setEntries(e);
    setTemplates([...normalizedBuiltinTemplates(), ...t]);
    setRaceId("");
  }, [seasonId]);

  // Refreshes just the driver list, without resetting the selected race —
  // used after a driver is added inline from within the results editor.
  const reloadEntries = useCallback(async () => {
    if (!seasonId) return;
    setEntries(await api(`/api/entries?season_id=${seasonId}`));
  }, [seasonId]);

  // Refreshes the template list after one is created/edited from the inline
  // points-structure modal, so the Points column re-resolves immediately.
  const reloadTemplates = useCallback(async () => {
    setTemplates([...normalizedBuiltinTemplates(), ...(await api("/api/points-templates"))]);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const selectedRace = races.find(r => r.id === raceId);
  // A split event has no combined grid — every session belongs to one class, so
  // a class has to be chosen before results can be entered. The top-bar Class
  // menu picks it; "All Classes" falls back to the first class in the season.
  const perClassResults = racePerClassResults(selectedRace, season);
  const scopes = useMemo(
    () => (perClassResults ? sessionClassScopes(classes, entries) : []),
    [perClassResults, classes, entries]
  );
  useEffect(() => {
    if (!scopes.length) { setScope(null); return; }
    setScope(prev => {
      if (scopes.some(s => s.value === prev)) return prev;
      return scopes.find(s => s.value === classId)?.value ?? scopes[0].value;
    });
  }, [scopes, classId]);

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>Select a game, series and season above.</p></div>;
  }

  // With a class selected, the event list narrows to that class's calendar —
  // its own rounds plus every shared one — mirroring the Schedule page.
  const visibleRaces = filterRacesByClass(races, classId);
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
  const scopeName = scopes.find(s => s.value === scope)?.label ?? "";
  const scopeCar = carForRace(selectedRace, season, classes.find(c => c.id === scope));
  const sessionPoints = selectedRace?.session_points || {};

  const patchRace = updated => setRaces(prev => prev.map(r => (r.id === raceId ? { ...r, ...updated } : r)));

  // Saves the assignment on the race AND cascades it onto any already-saved
  // results for that session, so points re-score everywhere immediately.
  async function saveSessionPoints(name, templateId, sessionType = "race") {
    const updated = await api(`/api/races/${raceId}/session-points`, {
      method: "POST",
      body: { session: name, template_id: templateId || "", session_type: sessionType },
    });
    patchRace(updated);
  }

  const stdSessions = Array.isArray(selectedRace?.sessions) && selectedRace.sessions.length ? selectedRace.sessions : ["Race"];
  async function addStdSession(name) {
    patchRace(await api(`/api/races/${raceId}`, { method: "PATCH", body: { sessions: [...stdSessions, name] } }));
  }
  async function removeStdSession(name) {
    if (!confirm(`Remove ${name}? Its saved results stay in the database but won't be shown.`)) return;
    const remaining = stdSessions.filter(s => s !== name);
    patchRace(await api(`/api/races/${raceId}`, { method: "PATCH", body: { sessions: remaining.length ? remaining : ["Race"] } }));
  }
  async function renameStdSession(from, to) {
    patchRace(await api(`/api/races/${raceId}/rename-session`, { method: "POST", body: { session_type: "race", from, to } }));
  }

  return (
    <section>
      <div className="page-title">
        <h2>Race Entry · {season?.name ?? ""}{raceClass ? ` · ${raceClass.name}` : ""}</h2>
        <span className="page-badge">{entries.length} Drivers</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        Pick an event to enter or edit its results — rename each race, add more, and set a points system
        per race right here. To rename the event itself, change its date, or set up heat racing, use the
        pencil on the <Link href="/schedule" style={{ color: "var(--accent-cyan)" }}>Schedule</Link>.
      </p>

      <div className="form-card" style={{ maxWidth: "100%" }}>
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Event</label>
          <select value={raceId} onChange={e => setRaceId(e.target.value)}>
            <option value="">Select an event…</option>
            {visibleRaces.map(r => (
              <option key={r.id} value={r.id}>
                R{r.round_number} · {r.name}{r.track ? ` — ${r.track}` : ""}
                {r.class_id && classNameById[r.class_id] ? ` (${classNameById[r.class_id]} only)` : ""}
              </option>
            ))}
          </select>
        </div>

        {selectedRace && perClassResults && scopes.length > 0 && (
          <div className="class-scope-bar">
            <label htmlFor="entry-class">Entering results for</label>
            <select id="entry-class" value={scope ?? ""} onChange={e => setScope(e.target.value)}>
              {scopes.map(s => <option key={s.value} value={s.value}>{s.car ? `${s.label} · ${s.car}` : s.label}</option>)}
            </select>
            {scopeCar && <span className="class-scope-chip" title="The car this class races">{scopeCar}</span>}
            <span style={{ color: "var(--ink-1)", fontSize: "0.84rem" }}>
              This event runs each class separately, so you&rsquo;re building {scopeName || "this class"}&rsquo;s
              own grid — its own P1. Switch classes here (or from the Class menu in the top bar) to enter the next one.
            </span>
          </div>
        )}

        {selectedRace && (selectedRace.heat_format ? (
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>
            This event uses heat racing — enter its Heats, Consolation, and Feature results from the
            {" "}<Link href={`/races/${selectedRace.id}/edit?tab=heats`} style={{ color: "var(--accent-cyan)" }}>event edit screen</Link> instead.
          </p>
        ) : (
          <SessionEditor
            key={selectedRace.id}
            race={selectedRace} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} seriesName={series?.name}
            classes={classes} sessionClass={perClassResults ? scope : null} sessionClassName={perClassResults ? scopeName : ""}
            sessionType="race" sessionNames={stdSessions}
            season={season} templates={templates} sessionPoints={sessionPoints} onSessionPointsChange={saveSessionPoints} onTemplatesChanged={reloadTemplates}
            canAddSession onAddSession={addStdSession} onRemoveSession={removeStdSession} onRenameSession={renameStdSession}
          />
        ))}
      </div>
    </section>
  );
}

export default function RaceEntryPage() {
  return <AdminGate><RaceEntryInner /></AdminGate>;
}
