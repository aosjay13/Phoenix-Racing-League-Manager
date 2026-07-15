"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

function RaceCard({ r, done }) {
  const card = (
    <div className="race-card" style={done ? { cursor: "pointer" } : undefined}>
      {r.track_logo_url
        ? <img src={r.track_logo_url} alt="" className="round-num" style={{ objectFit: "cover", padding: 0 }} />
        : <div className="round-num">{r.round_number}</div>}
      <div>
        <div className="race-card-track">
          {r.name}
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
  return done ? <Link href={`/races/${r.id}`}>{card}</Link> : card;
}

export default function SchedulePage() {
  const { seasonId, season } = useLeague();
  const [races, setRaces] = useState(null);

  useEffect(() => {
    if (!seasonId) { setRaces(null); return; }
    api(`/api/races?season_id=${seasonId}`).then(setRaces).catch(() => setRaces([]));
  }, [seasonId]);

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

  return (
    <section>
      <div className="page-title">
        <h2>Schedule · {season?.name ?? ""}</h2>
        <span className="page-badge">{races.length} Events</span>
      </div>

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
