"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { TrackSelect } from "@/components/TrackSelect";

const blankRace = { name: "", track: "", track_id: "", date: "", round_number: "", track_logo_url: "", sessions: "Race" };

function sessionsToArray(str) {
  const list = String(str || "").split(",").map(s => s.trim()).filter(Boolean);
  return list.length ? list : ["Race"];
}

// Quick "add a race to the schedule" dialog. Same fields the Admin page's Race
// panel captures, so a race created here is identical to one built in setup.
export function RaceCreateModal({ seasonId, defaultRound, onClose, onCreated }) {
  const [form, setForm] = useState({ ...blankRace, round_number: defaultRound ? String(defaultRound) : "" });
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/tracks").then(setTracks).catch(() => setTracks([])); }, []);

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
      const body = { ...form, sessions: sessionsToArray(form.sessions), season_id: seasonId };
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
            placeholder="Search tracks…" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Pick from the Tracks database — or type a name to keep it as free text.</span></div>
        <div className="field"><label>Round Number</label>
          <input type="number" min="1" required value={form.round_number} onChange={e => setForm(f => ({ ...f, round_number: e.target.value }))} /></div>
        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
        <div className="field"><label>Races in this event — comma-separated (e.g. Race 1, Race 2, Sprint)</label>
          <input value={form.sessions} placeholder="Race" onChange={e => setForm(f => ({ ...f, sessions: e.target.value }))} /></div>
        <ImageUpload label="Track Logo" kind="track-logo" value={form.track_logo_url} onUploaded={url => setForm(f => ({ ...f, track_logo_url: url }))} />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add Race"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
