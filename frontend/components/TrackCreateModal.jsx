"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";

const TRACK_TYPES = ["Oval", "Superspeedway", "Short Track", "Road Course", "Street Circuit", "Dirt", "Rallycross", "Kart"];
const blankTrack = { name: "", location: "", length: "", track_type: "", logo_url: "", notes: "" };

// Standalone "add a track" dialog — the same fields the League Setup Tracks
// panel captures, so a track created here is identical to one built in setup.
// Opened from the admin-only button on the Tracks directory page.
export function TrackCreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState(blankTrack);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const track = await api("/api/tracks", { method: "POST", body: { ...form } });
      onCreated(track);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Track" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field"><label>Track Name</label>
          <input required autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Daytona International Speedway" /></div>
        <div className="field"><label>Location</label>
          <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Daytona Beach, FL" /></div>
        <div className="two-col" style={{ gap: 12 }}>
          <div className="field"><label>Length</label>
            <input value={form.length} onChange={e => setForm(f => ({ ...f, length: e.target.value }))} placeholder="2.5 mi" /></div>
          <div className="field"><label>Type</label>
            <select value={form.track_type} onChange={e => setForm(f => ({ ...f, track_type: e.target.value }))}>
              <option value="">—</option>
              {TRACK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
        </div>
        <div className="field"><label>Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional description" /></div>
        <ImageUpload label="Track Logo" kind="track-logo" value={form.logo_url} onUploaded={url => setForm(f => ({ ...f, logo_url: url }))} />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add Track"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
