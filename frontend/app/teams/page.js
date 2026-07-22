"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DirectoryRow } from "@/components/DirectoryRow";

export default function TeamsPage() {
  const [teams, setTeams] = useState(null);

  useEffect(() => {
    // Teams are per-season docs keyed by name; /api/teams/all collapses them
    // into one row per team so the directory mirrors the Drivers pool.
    api("/api/teams/all")
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  if (!teams) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <section>
      <div className="page-title">
        <h2>Teams</h2>
        <span className="page-badge">{teams.length} Team{teams.length === 1 ? "" : "s"}</span>
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
            />
          ))}
        </div>
      )}
    </section>
  );
}
