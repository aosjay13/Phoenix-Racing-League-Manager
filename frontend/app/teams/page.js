"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

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
        <div className="quick-links" style={{ marginTop: 18 }}>
          {teams.map(t => (
            <Link href={`/teams/${encodeURIComponent(t.name)}`} key={t.name}>
              <div className="quick-card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {t.logo_url
                  ? <img src={t.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
                  : <span className="avatar avatar-fallback" style={t.color ? { background: t.color } : undefined}>{String(t.name || "?")[0]?.toUpperCase()}</span>}
                <div>
                  <strong>{t.name}</strong>
                  <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.8rem" }}>
                    {t.seasons} Season{t.seasons === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
