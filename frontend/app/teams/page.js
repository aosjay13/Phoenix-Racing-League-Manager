"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DirectoryRow } from "@/components/DirectoryRow";
import { TeamCreateModal } from "@/components/TeamCreateModal";
import { TeamEditModal } from "@/components/TeamEditModal";
import { TeamRosterManager } from "@/components/TeamRosterManager";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// The public team directory — one row per team in the league-wide pool, the
// team-side mirror of the Drivers directory.
function TeamsDirectory() {
  const { isAdmin } = useAuth();
  const [teams, setTeams] = useState(null);
  const [creating, setCreating] = useState(false); // new-team modal open
  const [editing, setEditing] = useState(null);   // team row being edited
  const [deleting, setDeleting] = useState(null); // team row being deleted

  // Teams are persistent documents (see lib/teams.js); /api/teams/all is the
  // pool, with how many seasons and drivers each has fielded.
  function load() {
    return api("/api/teams/all").then(setTeams).catch(() => setTeams([]));
  }

  useEffect(() => { load(); }, []);

  // Deleting a team removes it from every season it raced in, and clears the
  // team tag off those roster entries. Race results belong to drivers' entries,
  // so nothing is lost — the drivers simply stop being credited to it.
  async function deleteTeam(team) {
    await api(`/api/teams/${team.id}`, { method: "DELETE" });
    setTeams(prev => (prev || []).filter(t => t.id !== team.id));
  }

  function handleSaved(updated) {
    setTeams(prev => (prev || [])
      .map(t => (t.id === editing.id ? { ...t, ...updated } : t))
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
        Every team in the league. A team is permanent: it keeps its name, badge and record while its
        driver line-up changes from season to season. Open a profile to see its seasons, its drivers and
        its combined career stats.
      </p>

      {teams.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🛡</span><p>No teams yet.</p></div>
      ) : (
        <div className="list-rows">
          {teams.map(t => (
            <DirectoryRow
              key={t.id}
              href={`/teams/${encodeURIComponent(t.id)}`}
              avatar={{ url: t.logo_url, square: true, bg: t.color }}
              title={t.name}
              subtitle={`${t.seasons} Season${t.seasons === 1 ? "" : "s"} · ${t.drivers} Driver${t.drivers === 1 ? "" : "s"}`}
              meta={[{ label: "Seasons", value: t.seasons }, { label: "Drivers", value: t.drivers }]}
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
        <TeamCreateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
      {editing && (
        <TeamEditModal team={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete Team"
          message={`Delete “${deleting.name}”${deleting.seasons ? ` and its line-up in all ${deleting.seasons} season${deleting.seasons === 1 ? "" : "s"}` : ""}? Drivers keep their results but lose the team tag.`}
          confirmLabel="Delete Team"
          onConfirm={() => deleteTeam(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

// ── The Teams menu ─────────────────────────────────────────────────────────
// The public directory, and (for admins) the Team Roster: which teams race in
// the selected season and who drives for each of them. Same shape as the
// Drivers menu, where the directory and the roster manager sit side by side.
const TABS = [
  { key: "directory", label: "Teams",       icon: "🛡", admin: false },
  { key: "roster",    label: "Team Roster", icon: "⊞",  admin: true  },
];

function TeamsTabs() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const wanted = searchParams.get("tab") || "directory";

  const visible = TABS.filter(t => !t.admin || isAdmin);
  const tab = visible.some(t => t.key === wanted) ? wanted : "directory";

  function selectTab(key) {
    // Shallow URL update so the tab is linkable/back-buttonable without
    // re-running the route.
    router.replace(key === "directory" ? "/teams" : `/teams?tab=${key}`, { scroll: false });
  }

  return (
    <section>
      {visible.length > 1 && (
        <div className="tab-row" style={{ marginTop: 0, marginBottom: 18, flexWrap: "wrap" }}>
          {visible.map(t => (
            <button key={t.key} type="button" className={`tab${tab === t.key ? " active" : ""}`} onClick={() => selectTab(t.key)}>
              <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "directory" && <TeamsDirectory />}
      {tab === "roster" && isAdmin && <TeamRosterManager />}
    </section>
  );
}

export default function TeamsPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 240 }} />}>
      <TeamsTabs />
    </Suspense>
  );
}
