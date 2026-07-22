"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { TrackCreateModal } from "@/components/TrackCreateModal";

// Canonical display order for the type sub-sections (matches TrackCreateModal).
// Any type not listed here falls in after these, alphabetically; untyped tracks
// collect under "Unclassified" at the end.
const TYPE_ORDER = ["Oval", "Superspeedway", "Short Track", "Road Course", "Street Circuit", "Dirt", "Rallycross", "Kart"];
const UNTYPED = "Unclassified";

export default function TracksPage() {
  const { isAdmin } = useAuth();
  const [tracks, setTracks] = useState(null);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState({}); // type -> true when hidden

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

  // Bucket tracks by type, then order the sections: canonical types first (in
  // TYPE_ORDER), any other custom types alphabetically, then Unclassified last.
  const groups = useMemo(() => {
    const byType = new Map();
    for (const t of tracks || []) {
      const key = t.track_type || UNTYPED;
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(t);
    }
    const rank = key => {
      if (key === UNTYPED) return [2, ""];
      const i = TYPE_ORDER.indexOf(key);
      return i === -1 ? [1, key] : [0, i];
    };
    return [...byType.entries()].sort(([a], [b]) => {
      const [ga, sa] = rank(a), [gb, sb] = rank(b);
      return ga !== gb ? ga - gb : (typeof sa === "number" ? sa - sb : String(sa).localeCompare(String(sb)));
    });
  }, [tracks]);

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
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map(([type, rows]) => {
            const isCollapsed = !!collapsed[type];
            return (
              <div key={type}>
                <button
                  type="button"
                  className="list-group-header"
                  onClick={() => setCollapsed(c => ({ ...c, [type]: !c[type] }))}
                  aria-expanded={!isCollapsed}
                >
                  <span className="list-group-caret" style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                  <span className="list-group-title">{type}</span>
                  <span className="list-group-count">{rows.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="list-rows" style={{ marginTop: 8 }}>
                    {rows.map(t => (
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
                            <span className="list-row-meta-label">Length</span>
                            <span className="list-row-meta-value">{t.length || "—"}</span>
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && <TrackCreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
    </section>
  );
}
