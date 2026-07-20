"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { RaceCreateModal } from "@/components/RaceCreateModal";
import { api } from "@/lib/api";

function RaceCard({ r, done }) {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const open = () => { if (done) router.push(`/races/${r.id}`); };

  return (
    <div className="race-card" onClick={open} style={done ? { cursor: "pointer" } : undefined}>
      {r.track_logo_url
        ? <img src={r.track_logo_url} alt="" className="round-num" style={{ objectFit: "cover", padding: 0 }} />
        : <div className="round-num">{r.round_number}</div>}
      <div>
        <div className="race-card-track">
          {r.name}
          {isAdmin && (
            <button
              className="race-edit-btn"
              title="Edit race results"
              onClick={e => { e.stopPropagation(); router.push(`/races/${r.id}/edit`); }}
            >
              ✎
            </button>
          )}
          {Array.isArray(r.sessions) && r.sessions.length > 1 && (
            <span className="badge" style={{ marginLeft: 8 }}>{r.sessions.length} races</span>
          )}
        </div>
        <div className="race-card-date">
          {r.track ? `${r.track} · ` : ""}
          {r.date ? new Date(r.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Date TBA"}
          {done ? " · View results →" : ""}
        </div>
      </div>
      <span className={`race-status ${done ? "status-completed" : "status-upcoming"}`}>
        {done ? "COMPLETED" : "UPCOMING"}
      </span>
    </div>
  );
}

export default function SchedulePage() {
  const { seasonId, season } = useLeague();
  const { isAdmin } = useAuth();
  const [races, setRaces] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadRaces = () => {
    if (!seasonId) { setRaces(null); return; }
    api(`/api/races?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  };
  useEffect(loadRaces, [seasonId]);

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">🗓</span><p>Select a game, series and season above.</p></div>;
  }
  if (!races) return <div className="skeleton" style={{ height: 240 }} />;

  const now = new Date();
  const isDone = r => r.date && new Date(r.date) < now;
  const upcoming = races.filter(r => !isDone(r))
    .sort((a, b) => (a.date && b.date) ? new Date(a.date) - new Date(b.date) : a.round_number - b.round_number);
  const archive = races.filter(isDone)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const nextRound = races.reduce((m, r) => Math.max(m, Number(r.round_number) || 0), 0) + 1;

  return (
    <section>
      <div className="page-title">
        <h2>Schedule · {season?.name ?? ""}</h2>
        <span className="page-badge">{races.length} Events</span>
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginLeft: "auto", marginTop: 0 }} onClick={() => setShowCreate(true)}>
            + New Race
          </button>
        )}
      </div>

      {showCreate && (
        <RaceCreateModal
          seasonId={seasonId}
          defaultRound={nextRound}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadRaces(); }}
        />
      )}

      {races.length === 0 && (
        <div className="empty-state"><span className="empty-state-icon">🗓</span><p>No races scheduled yet.</p></div>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="section-header"><h3>Upcoming Races</h3></div>
          {upcoming.map(r => <RaceCard key={r.id} r={r} done={false} />)}
        </>
      )}

      {archive.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 32 }}>
            <h3>Archive</h3>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>Click a race to see full results</span>
          </div>
          {archive.map(r => <RaceCard key={r.id} r={r} done />)}
        </>
      )}
    </section>
  );
}
