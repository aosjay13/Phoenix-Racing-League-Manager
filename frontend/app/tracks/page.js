"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function TracksPage() {
  const [tracks, setTracks] = useState(null);

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

  if (!tracks) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <section>
      <div className="page-title">
        <h2>Tracks</h2>
        <span className="page-badge">{tracks.length} Track{tracks.length === 1 ? "" : "s"}</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Every venue in the league. Open a profile to see who wins here, past race winners, and venue records.
      </p>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>No tracks yet. Add them in League Setup → Tracks.</p>
        </div>
      ) : (
        <div className="quick-links" style={{ marginTop: 18 }}>
          {tracks.map(t => (
            <Link href={`/tracks/${t.id}`} key={t.id}>
              <div className="quick-card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {t.logo_url
                  ? <img src={t.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
                  : <span className="avatar avatar-fallback" style={{ borderRadius: 6 }}>🏁</span>}
                <div>
                  <strong>{t.name}</strong>
                  <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.8rem" }}>
                    {[t.location, t.track_type, t.length].filter(Boolean).join(" · ") || "Track"}
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
