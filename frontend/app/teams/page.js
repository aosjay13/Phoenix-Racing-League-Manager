"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DirectoryRow } from "@/components/DirectoryRow";
import { TeamCreateModal } from "@/components/TeamCreateModal";
import { TeamEditModal } from "@/components/TeamEditModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function TeamsPage() {
  const { isAdmin } = useAuth();
  const [teams, setTeams] = useState(null);
  const [creating, setCreating] = useState(false); // new-team modal open
  const [editing, setEditing] = useState(null);   // team row being edited
  const [deleting, setDeleting] = useState(null); // team row being deleted

  // Teams are per-season docs keyed by name; /api/teams/all collapses them into
  // one row per team so the directory mirrors the Drivers pool.
  function load() {
    return api("/api/teams/all").then(setTeams).catch(() => setTeams([]));
  }

  useEffect(() => { load(); }, []);

  // A team is really every per-season doc sharing the name, so deleting one
  // removes all of `team.ids` — clearing out "phantom" teams that linger with
  // no drivers but still show in the directory.
  async function deleteTeam(team) {
    for (const id of team.ids) {
      await api(`/api/teams/${id}`, { method: "DELETE" });
    }
    setTeams(prev => (prev || []).filter(t => t.name.toLowerCase() !== team.name.toLowerCase()));
  }

  function handleSaved(updated) {
    setTeams(prev => (prev || [])
      .map(t => (t.name.toLowerCase() === editing.name.toLowerCase() ? { ...t, ...updated } : t))
      .sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(null);
  }

  if (!teams) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <section>
      <div className="page-title">
        <h2>Teams</h2>
        <span className="page-badge">{teams.length} Team{teams.length === 1 ? "" : "s"}</span>
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginTop: 0, marginLeft: "auto" }} onClick={() => setCreating(true)}>
            ＋ New Team
          </button>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Every team that has fielded drivers in the league. Open a profile to see its drivers and combined career stats.
      </p>

      {teams.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🛡</span><p>No teams yet.</p></div>
      ) : (
        <div className="list-rows">
          {teams.map(t => (
            <DirectoryRow
              key={t.name}
              href={`/teams/${encodeURIComponent(t.name)}`}
              avatar={{ url: t.logo_url, square: true, bg: t.color }}
              title={t.name}
              subtitle={`${t.seasons} Season${t.seasons === 1 ? "" : "s"}`}
              meta={[{ label: "Seasons", value: t.seasons }]}
              actions={isAdmin ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(t)}>Edit</button>
                  <button type="button" className="btn btn-danger" onClick={() => setDeleting(t)}>Delete</button>
                </>
              ) : null}
            />
          ))}
        </div>
      )}

      {creating && (
        // A new team may share a name with an existing one (another season), so
        // reload the collapsed directory rather than guessing how to merge it in.
        <TeamCreateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
      {editing && (
        <TeamEditModal team={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete Team"
          message={`Delete “${deleting.name}”${deleting.seasons > 1 ? ` from all ${deleting.seasons} seasons` : ""}? This removes the team; drivers keep their results but lose the team tag.`}
          confirmLabel="Delete Team"
          onConfirm={() => deleteTeam(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
