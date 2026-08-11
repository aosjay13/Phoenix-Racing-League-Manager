"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Fold duplicate venues into one and name the result. `track` is the venue that
// survives (it keeps its id, so every existing link to it still resolves);
// `tracks` is the full pool to pick duplicates from. `onMerged` receives the
// API response so the caller can refresh its list.
//
// Every race held at a picked duplicate moves onto the survivor and takes the
// chosen name, which carries the whole venue history with it — the leaderboard,
// past winners, lap records and each driver's per-track stats are all derived
// from those races.
export function TrackMergeModal({ track, tracks = [], onClose, onMerged }) {
  const [name, setName] = useState(track.name || "");
  const [picked, setPicked] = useState([]);      // ids being merged away
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const others = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return tracks
      .filter(t => t.id !== track.id)
      .filter(t => !q || `${t.name} ${t.location || ""}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [tracks, track.id, filter]);

  function toggle(id) {
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  async function submit(e) {
    e.preventDefault();
    // The modal renders through a portal, but React events still bubble along
    // the component tree — without this the submit reaches an enclosing form
    // (the League Setup track form) and saves that instead.
    e.stopPropagation();
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/admin/tracks/merge", {
        method: "POST",
        body: { into_id: track.id, from_ids: picked, name: name.trim() || track.name },
      });
      onMerged(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Merge into “${track.name}”`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
          Pick the duplicate venues for this same circuit. Every race held at them moves onto{" "}
          <strong>{track.name}</strong> and the duplicates are removed — all history comes with it:
          past winners, the venue leaderboard, lap records and each driver&rsquo;s stats here.
          Nothing is deleted from the record books.
        </p>

        <div className="field">
          <label>Name the merged track</label>
          <input required value={name} onChange={e => setName(e.target.value)} placeholder={track.name} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            What the venue is called afterwards — every race that moved is relabelled with it, so the
            schedule, results and stats all read the same way.
          </span>
        </div>

        <div className="field">
          <label>Merge these in{picked.length ? ` (${picked.length} selected)` : ""}</label>
          {tracks.length > 8 && (
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search tracks…" />
          )}
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 9 }}>
            {others.length === 0 ? (
              <p style={{ margin: 0, padding: "12px 14px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
                {tracks.length > 1 ? "No tracks match that search." : "There's only one track in the pool."}
              </p>
            ) : others.map(t => (
              <label key={t.id} htmlFor={`merge_track_${t.id}`} className="check-row check-row-center"
                style={{
                  gap: 10, padding: "9px 12px", cursor: "pointer",
                  borderTop: "1px solid var(--border)", fontWeight: 400, textTransform: "none", letterSpacing: 0,
                }}>
                <input type="checkbox" id={`merge_track_${t.id}`} checked={picked.includes(t.id)}
                  onChange={() => toggle(t.id)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--ink-0)", fontSize: "0.9rem" }}>{t.name}</span>
                  <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>
                    {[t.location, t.track_type, t.length].filter(Boolean).join(" · ") || "No details"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Blank details on <strong>{track.name}</strong> — location, length, type, logo, notes — are
            filled in from the venues you merge in.
          </span>
        </div>

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !picked.length || !name.trim()}>
          {busy ? "Merging…" : picked.length > 1 ? `Merge ${picked.length} Tracks` : "Merge Track"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  );
}
