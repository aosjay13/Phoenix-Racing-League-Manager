"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { TrackSelect } from "@/components/TrackSelect";

const blankRace = {
  name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race", car: "",
  total_laps: "", heat_format: false, heats: "", consolations: "", feature_name: "A-Main Feature",
  // Blank = shared by every class; only settable for a season running per-class
  // schedules.
  class_id: "",
  // Split this event's sessions by class (each class its own Qualifying/Race).
  // Seeded from the season default; only offered on a shared event.
  per_class_results: false,
};

function toArray(str) {
  return String(str || "").split(",").map(s => s.trim()).filter(Boolean);
}
function sessionsToArray(str) {
  const list = toArray(str);
  return list.length ? list : ["Race"];
}

// Quick "add a race to the schedule" dialog. Same fields the Admin page's Race
// panel captures, so a race created here is identical to one built in setup.
// `classes` / `perClassSchedules` come from the season: with per-class schedules
// on, the dialog offers a Class field so the round can be put on one class's
// calendar instead of everyone's. `defaultClassId` pre-selects the class the
// admin is currently viewing.
export function RaceCreateModal({ seasonId, defaultRound, classes = [], perClassSchedules = false, defaultClassId = "", perClassResults = false, onClose, onCreated }) {
  const [form, setForm] = useState({
    ...blankRace,
    round_number: defaultRound ? String(defaultRound) : "",
    class_id: perClassSchedules ? defaultClassId : "",
    per_class_results: perClassResults,
  });
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/tracks").then(setTracks).catch(() => setTracks([])); }, []);

  const showClass = perClassSchedules && classes.length > 0;
  // Only a shared event has classes to split apart; a round pinned to one class
  // is single-class already.
  const showSplit = classes.length > 0 && !form.class_id;

  // Picking a track from the pool pins its id + name; a fresh track logo fills
  // in only when the race doesn't already carry one.
  function pickTrack({ id, name, track }) {
    setForm(f => ({
      ...f,
      track: name,
      track_id: id || "",
      track_logo_url: f.track_logo_url || (track?.logo_url ?? ""),
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const heats = toArray(form.heats);
      const body = {
        ...form,
        sessions: sessionsToArray(form.sessions),
        total_laps: form.total_laps === "" ? 0 : Number(form.total_laps),
        heat_format: !!form.heat_format,
        heats: form.heat_format ? (heats.length ? heats : ["Heat 1"]) : [],
        consolations: form.heat_format ? toArray(form.consolations) : [],
        feature_name: form.feature_name.trim() || "A-Main Feature",
        // Never pin a race to a class unless the season actually runs per-class
        // schedules, so the field can't be set from stale state.
        class_id: showClass ? form.class_id : "",
        per_class_results: showSplit ? !!form.per_class_results : false,
        season_id: seasonId,
      };
      const race = await api("/api/races", { method: "POST", body });
      onCreated(race);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Race" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field"><label>Race Name</label>
          <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Race 1 — Daytona Duel" /></div>
        <div className="field"><label>Track</label>
          <TrackSelect tracks={tracks} valueId={form.track_id} valueName={form.track} onChange={pickTrack}
            onTrackCreated={track => setTracks(ts => [...ts, track])}
            placeholder="Search tracks…" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Pick from the Tracks database, add a brand-new venue to it inline, or type a name to keep it as free text.</span></div>
        <div className="field"><label>Round Number</label>
          <input type="number" min="1" required value={form.round_number} onChange={e => setForm(f => ({ ...f, round_number: e.target.value }))} /></div>
        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
        {showClass && (
          <div className="field"><label>Class</label>
            <select value={form.class_id} onChange={e => setForm(f => ({ ...f, class_id: e.target.value }))}>
              <option value="">All Classes (shared)</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              Shared events run for every class. Pick a class to put this round on that class&rsquo;s
              calendar alone.
            </span></div>
        )}
        {showSplit && (
          <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
            <input type="checkbox" id="new_race_per_class_results" checked={!!form.per_class_results}
              onChange={e => setForm(f => ({ ...f, per_class_results: e.target.checked }))}
              style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
            <label htmlFor="new_race_per_class_results" style={{ margin: 0 }}>
              Separate results by class
              <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Every class races this round, but each enters its own Qualifying and Race — its own
                pole, its own P1. Off: one combined grid for the whole field.
              </span>
            </label>
          </div>
        )}
        <div className="field"><label>Total Race Laps</label>
          <input type="number" min="0" value={form.total_laps} placeholder="e.g. 100" onChange={e => setForm(f => ({ ...f, total_laps: e.target.value }))} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Used to auto-count laps completed: lead-lap finishers get the full total, laps-down (e.g. 2L) and DNFs subtract from it.
          </span></div>
        <div className="field"><label>Car Type</label>
          <input value={form.car} placeholder={classes.length ? "Leave blank to use the class's / season's car" : "Leave blank to use the season's car"}
            onChange={e => setForm(f => ({ ...f, car: e.target.value }))} /></div>
        <div className="field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
          <input type="checkbox" id="heat_format" checked={form.heat_format}
            onChange={e => setForm(f => ({ ...f, heat_format: e.target.checked }))}
            style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)" }} />
          <label htmlFor="heat_format" style={{ margin: 0 }}>This event uses heat racing (Heats → Consolation → Feature)</label>
        </div>

        {form.heat_format ? (
          <>
            <div className="field"><label>Heats — comma-separated (e.g. Heat 1, Heat 2)</label>
              <input value={form.heats} placeholder="Heat 1, Heat 2" onChange={e => setForm(f => ({ ...f, heats: e.target.value }))} /></div>
            <div className="field"><label>Consolation races — comma-separated (e.g. C-Main, B-Main)</label>
              <input value={form.consolations} placeholder="B-Main" onChange={e => setForm(f => ({ ...f, consolations: e.target.value }))} /></div>
            <div className="field"><label>Feature name</label>
              <input value={form.feature_name} placeholder="A-Main Feature" onChange={e => setForm(f => ({ ...f, feature_name: e.target.value }))} /></div>
          </>
        ) : (
          <div className="field"><label>Races in this event — comma-separated (e.g. Race 1, Race 2, Sprint)</label>
            <input value={form.sessions} placeholder="Race" onChange={e => setForm(f => ({ ...f, sessions: e.target.value }))} /></div>
        )}
        <ImageUpload label="Track Logo" kind="track-logo" value={form.track_logo_url} onUploaded={url => setForm(f => ({ ...f, track_logo_url: url }))} />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add Race"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
