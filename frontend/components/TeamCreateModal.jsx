"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { useLeague } from "@/components/LeagueProvider";

const blankTeam = { name: "", color: "", logo_url: "" };

// Create a team straight from the Teams directory. Teams are league-wide and
// permanent, so this needs nothing but a name — no season required. When the
// top-bar dropdowns are on a concrete season, the new team is ALSO entered in
// it (with an empty line-up, ready for drivers on the Team Roster tab), because
// that's almost always why a team is being created.
export function TeamCreateModal({ onClose, onCreated }) {
  const { seasonId, season, series, game } = useLeague();
  const [form, setForm] = useState({ ...blankTeam });
  const [addToSeason, setAddToSeason] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), color: form.color, logo_url: form.logo_url };
      if (seasonId && addToSeason) body.season_id = seasonId;
      const team = await api("/api/teams", { method: "POST", body });
      onCreated(team);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const scopeLabel = [game?.name, series?.name, season?.name].filter(Boolean).join(" · ");

  return (
    <Modal title="New Team" onClose={busy ? () => {} : onClose}>
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
        {seasonId ? (
          <label className="check-row">
            <input type="checkbox" checked={addToSeason} onChange={e => setAddToSeason(e.target.checked)} />
            <span>
              Also enter this team in <strong>{scopeLabel || season?.name}</strong>
              <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>
                Add its drivers afterwards on the Team Roster tab.
              </span>
            </span>
          </label>
        ) : (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            The team joins the league-wide pool. Pick a season in the menus at the top, then use the
            <strong> Team Roster</strong> tab to enter it in that season and add its drivers.
          </p>
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create Team"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
