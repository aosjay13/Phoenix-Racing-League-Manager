"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { useLeague } from "@/components/LeagueProvider";

const blankTeam = { name: "", color: "", logo_url: "" };

// Create a team straight from the Teams directory. Teams are per-season docs,
// so the new team is added to whichever season is selected in the top-bar
// dropdowns. With no concrete season chosen, we ask the admin to pick one there
// first — the same season a team would belong to if made in League Setup.
export function TeamCreateModal({ onClose, onCreated }) {
  const { seasonId, season, series, game } = useLeague();
  const [form, setForm] = useState({ ...blankTeam });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), color: form.color, logo_url: form.logo_url, season_id: seasonId };
      const team = await api("/api/teams", { method: "POST", body });
      onCreated(team);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!seasonId) {
    return (
      <Modal title="New Team" onClose={onClose}>
        <p style={{ margin: "10px 0 0", color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.5 }}>
          Teams belong to a season. Choose a game, series and season from the dropdowns at the top of the page, then add the team to it.
        </p>
        <button className="btn btn-ghost" type="button" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </Modal>
    );
  }

  const scopeLabel = [game?.name, series?.name, season?.name].filter(Boolean).join(" · ");

  return (
    <Modal title="New Team" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        {scopeLabel && (
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            Adding to <strong style={{ color: "var(--ink-1)" }}>{scopeLabel}</strong>
          </p>
        )}
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
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create Team"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
