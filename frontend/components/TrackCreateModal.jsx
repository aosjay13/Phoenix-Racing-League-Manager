"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { TRACK_TYPES } from "@/lib/trackTypes";

const blankTrack = { name: "", location: "", length: "", track_type: "", logo_url: "", notes: "" };

// Standalone track dialog — the same fields the League Setup Tracks panel
// captures, so a track created here is identical to one built in setup. Opened
// from the admin-only controls on the Tracks directory page. Pass `track` to
// edit an existing venue (PATCH); omit it to create a new one (POST).
export function TrackCreateModal({ onClose, onCreated, onSaved, initialName, track }) {
  const editing = !!track;
  const [form, setForm] = useState(
    editing
      ? { ...blankTrack, ...track }
      : { ...blankTrack, name: initialName || "" }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    // This modal renders through a portal, but React synthetic events still
    // bubble along the component tree — so without stopPropagation the submit
    // reaches the enclosing race form (in RaceCreateModal), prematurely
    // creating the race and kicking the admin back to the week scheduler.
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const updated = await api(`/api/tracks/${track.id}`, { method: "PATCH", body: { ...form } });
        onSaved(updated);
      } else {
        const created = await api("/api/tracks", { method: "POST", body: { ...form } });
        onCreated(created);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? "Edit Track" : "New Track"} onClose={busy ? () => {} : onClose}>
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
              {/* A track saved with a type outside the canonical list keeps it
                  selectable, so an unrelated edit can't silently blank it. */}
              {form.track_type && !TRACK_TYPES.includes(form.track_type) && (
                <option value={form.track_type}>{form.track_type} (custom)</option>
              )}
            </select></div>
        </div>
        <div className="field"><label>Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional description" /></div>
        <ImageUpload label="Track Logo" kind="track-logo" value={form.logo_url} onUploaded={url => setForm(f => ({ ...f, logo_url: url }))} />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add Track"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
