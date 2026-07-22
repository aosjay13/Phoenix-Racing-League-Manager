"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";

// Edit a team straight from the Teams directory. A "team" here is really every
// per-season doc that shares the name (see /api/teams/all), so a rename/re-logo
// must fan out across all of `team.ids` to keep the identity intact — otherwise
// only one season's doc changes and the directory splits into two teams.
export function TeamEditModal({ team, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: team.name || "",
    color: team.color || "",
    logo_url: team.logo_url || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), color: form.color, logo_url: form.logo_url };
      // Apply to every backing per-season doc so the whole team updates at once.
      for (const id of team.ids) {
        await api(`/api/teams/${id}`, { method: "PATCH", body });
      }
      onSaved({ ...team, ...body });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Team" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Team Name</label>
          <input required autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Phoenix Motorsports" />
        </div>
        <div className="field">
          <label>Team Color</label>
          <input type="color" value={form.color || "#888888"} style={{ width: 56, height: 34, padding: 2 }}
            onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
        </div>
        <ImageUpload label="Team Logo" kind="team-logo" value={form.logo_url}
          onUploaded={url => setForm(f => ({ ...f, logo_url: url }))} />
        {team.seasons > 1 && (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            Applies to all {team.seasons} seasons this team has raced.
          </p>
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
