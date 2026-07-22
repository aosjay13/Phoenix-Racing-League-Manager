"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { TrackCreateModal } from "@/components/TrackCreateModal";

export default function TracksPage() {
  const { isAdmin } = useAuth();
  const [tracks, setTracks] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // The global tracks pool is every venue in the database. Open a profile to
    // see its historical stats (most wins, past winners, …).
    api("/api/tracks")
      .then(rows => {
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setTracks(rows);
      })
      .catch(() => setTracks([]));
  }, []);

  // Drop a newly-created track into the grid without a round-trip, keeping the
  // list alphabetized.
  function handleCreated(track) {
    setTracks(prev => [...(prev || []), track].sort((a, b) => String(a.name).localeCompare(String(b.name))));
    setCreating(false);
  }

  if (!tracks) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <section>
      <div className="page-title">
        <h2>Tracks</h2>
        <span className="page-badge">{tracks.length} Track{tracks.length === 1 ? "" : "s"}</span>
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginTop: 0, marginLeft: "auto" }} onClick={() => setCreating(true)}>
            ＋ Add Track
          </button>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Every venue in the league. Open a profile to see who wins here, past race winners, and venue records.
      </p>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>No tracks yet.{isAdmin ? " Use “＋ Add Track” above to create one." : " Add them in League Setup → Tracks."}</p>
        </div>
      ) : (
        <div className="list-rows">
          {tracks.map(t => (
            <Link href={`/tracks/${t.id}`} key={t.id} className="list-row">
              {t.logo_url
                ? <img src={t.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
                : <span className="avatar avatar-fallback" style={{ borderRadius: 6 }}>🏁</span>}
              <span className="list-row-name">
                <strong>{t.name}</strong>
                <span>{t.location || "—"}</span>
              </span>
              <span className="list-row-meta">
                <span>
                  <span className="list-row-meta-label">Type</span>
                  <span className="list-row-meta-value">{t.track_type || "—"}</span>
                </span>
                <span>
                  <span className="list-row-meta-label">Length</span>
                  <span className="list-row-meta-value">{t.length || "—"}</span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && <TrackCreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
    </section>
  );
}
