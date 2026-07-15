"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

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

  return (
    <section>
      <div className="page-title">
        <h2>Schedule · {season?.name ?? ""}</h2>
        <span className="page-badge">{races.length} Races</span>
      </div>

      {races.length === 0 && (
        <div className="empty-state"><span className="empty-state-icon">🗓</span><p>No races scheduled yet.</p></div>
      )}

      {races.map(r => {
        const done = r.date && new Date(r.date) < new Date();
        return (
          <div className="race-card" key={r.id}>
            {r.track_logo_url
              ? <img src={r.track_logo_url} alt="" className="round-num" style={{ objectFit: "cover", padding: 0 }} />
              : <div className="round-num">{r.round_number}</div>}
            <div>
              <div className="race-card-track">{r.name}</div>
              <div className="race-card-date">
                {r.track ? `${r.track} · ` : ""}
                {r.date ? new Date(r.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Date TBA"}
              </div>
            </div>
            <span className={`race-status ${done ? "status-completed" : "status-upcoming"}`}>
              {done ? "COMPLETED" : "UPCOMING"}
            </span>
          </div>
        );
      })}
    </section>
  );
}
