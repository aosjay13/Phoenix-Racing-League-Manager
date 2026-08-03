"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { TrackCreateModal } from "@/components/TrackCreateModal";
import { TrackMergeModal } from "@/components/TrackMergeModal";
import { DirectoryRow } from "@/components/DirectoryRow";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TRACK_TYPES } from "@/lib/trackTypes";

// Canonical display order for the type sub-sections — the shared vocabulary, so
// adding a type in lib/trackTypes.js updates the form, this filter, and these
// sections at once. Any type not listed there (a one-off value on an older
// track) falls in after them, alphabetically; untyped tracks collect under
// "Unclassified" at the end.
const TYPE_ORDER = TRACK_TYPES;
const UNTYPED = "Unclassified";

export default function TracksPage() {
  const { isAdmin } = useAuth();
  const [tracks, setTracks] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);   // track being edited
  const [deleting, setDeleting] = useState(null); // track being deleted
  const [merging, setMerging] = useState(null);   // surviving track duplicates fold into
  const [toast, setToast] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // type -> true when hidden
  const [typeFilter, setTypeFilter] = useState(""); // "" = every type

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

  // Merge an edited track back into the grid, keeping it alphabetized (a rename
  // can move it).
  function handleSaved(updated) {
    setTracks(prev => (prev || [])
      .map(t => (t.id === updated.id ? { ...t, ...updated } : t))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))));
    setEditing(null);
  }

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  // Duplicates of the same circuit folded into one venue: the merged-away
  // tracks disappear from the pool and the survivor takes the chosen name, so
  // the grid is rebuilt from the response rather than patched.
  function handleMerged(res) {
    const merged = res.track;
    const gone = new Set(res.merged_ids || []);
    setTracks(prev => (prev || [])
      .filter(t => t.id === merged.id || !gone.has(t.id))
      .map(t => (t.id === merged.id ? { ...t, ...merged } : t))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))));
    setMerging(null);
    const races = res.races_moved;
    showToast("success", `Merged ${res.tracks_merged} track${res.tracks_merged === 1 ? "" : "s"} into “${merged.name}” — ${races} race${races === 1 ? "" : "s"} moved across.`);
  }

  async function deleteTrack(track) {
    await api(`/api/tracks/${track.id}`, { method: "DELETE" });
    setTracks(prev => (prev || []).filter(t => t.id !== track.id));
  }

  // Bucket tracks by type, then order the sections: canonical types first (in
  // TYPE_ORDER), any other custom types alphabetically, then Unclassified last.
  const groups = useMemo(() => {
    const byType = new Map();
    const visible = typeFilter
      ? (tracks || []).filter(t => (t.track_type || UNTYPED) === typeFilter)
      : (tracks || []);
    for (const t of visible) {
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
  }, [tracks, typeFilter]);

  // Filter options: the canonical types plus whatever types the data actually
  // holds (so a venue on a one-off value is still reachable), each with a count.
  const filterOptions = useMemo(() => {
    const counts = new Map();
    for (const t of tracks || []) {
      const key = t.track_type || UNTYPED;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const ordered = [...TYPE_ORDER.filter(t => counts.has(t))];
    for (const key of counts.keys()) {
      if (key !== UNTYPED && !ordered.includes(key)) ordered.push(key);
    }
    if (counts.has(UNTYPED)) ordered.push(UNTYPED);
    return ordered.map(key => ({ key, count: counts.get(key) }));
  }, [tracks]);

  if (!tracks) return <div className="skeleton" style={{ height: 240 }} />;

  const shownCount = groups.reduce((n, [, rows]) => n + rows.length, 0);

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

      {tracks.length > 0 && (
        <div className="field" style={{ maxWidth: 280, marginTop: 12 }}>
          <label>Track Type</label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types ({tracks.length})</option>
            {filterOptions.map(o => <option key={o.key} value={o.key}>{o.key} ({o.count})</option>)}
          </select>
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>No tracks yet.{isAdmin ? " Use “＋ Add Track” above to create one." : " Add them in League Setup → Tracks."}</p>
        </div>
      ) : shownCount === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>No {typeFilter} tracks yet.</p>
          <button className="btn btn-ghost" onClick={() => setTypeFilter("")}>Show all types</button>
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
                      <DirectoryRow
                        key={t.id}
                        href={`/tracks/${t.id}`}
                        avatar={{ url: t.logo_url, square: true, fallback: "🏁" }}
                        title={t.name}
                        subtitle={t.location || "—"}
                        meta={[{ label: "Length", value: t.length || "—" }]}
                        actionsWide={isAdmin}
                        actions={isAdmin ? (
                          <>
                            <button type="button" className="btn btn-ghost" onClick={() => setEditing(t)}>Edit</button>
                            <button type="button" className="btn btn-ghost" title="Fold duplicate venues into this one, keeping all their history"
                              onClick={() => setMerging(t)}>Merge</button>
                            <button type="button" className="btn btn-danger" onClick={() => setDeleting(t)}>Delete</button>
                          </>
                        ) : null}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {creating && <TrackCreateModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
      {editing && <TrackCreateModal track={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
      {merging && (
        <TrackMergeModal
          track={merging}
          tracks={tracks}
          onClose={() => setMerging(null)}
          onMerged={handleMerged}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete Track"
          message={`Delete “${deleting.name}”? Past races held here keep their results, but the venue profile and its records will be removed.`}
          confirmLabel="Delete Track"
          onConfirm={() => deleteTrack(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
