"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Searchable venue picker backed by the global Tracks pool. Typing filters the
// dropdown; picking a row reports { id, name, track } (the full track doc) so
// the caller can pin `track_id` and keep `track`/`track_logo_url` in sync.
//
// Free text is still allowed: if the admin types a name that matches no track,
// onChange fires with id=null and just the typed name, preserving the old
// free-text behaviour (and legacy races that predate the Tracks database).
export function TrackSelect({ tracks, valueId, valueName, onChange, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(valueName || "");
  const boxRef = useRef(null);

  // Keep the input text in sync when the selected value changes externally
  // (e.g. loading an existing race into an edit form).
  useEffect(() => { setText(valueName || ""); }, [valueName, valueId]);

  useEffect(() => {
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = tracks || [];
    if (!q) return list;
    return list.filter(t =>
      String(t.name || "").toLowerCase().includes(q) ||
      String(t.location || "").toLowerCase().includes(q));
  }, [tracks, text]);

  function pick(track) {
    setText(track.name);
    setOpen(false);
    onChange?.({ id: track.id, name: track.name, track });
  }

  function handleType(v) {
    setText(v);
    setOpen(true);
    // Typing detaches from any pinned track; report the free-text name, and
    // re-pin only if it exactly matches a known track.
    const exact = (tracks || []).find(t => String(t.name || "").trim().toLowerCase() === v.trim().toLowerCase());
    onChange?.({ id: exact?.id ?? null, name: v, track: exact ?? null });
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        value={text}
        disabled={disabled}
        placeholder={placeholder || "Search tracks…"}
        onChange={e => handleType(e.target.value)}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && !disabled && (matches.length > 0 || (tracks || []).length > 0) && (
        <div style={{
          position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0,
          maxHeight: 240, overflowY: "auto", background: "var(--bg-elevated)",
          border: "1px solid var(--border)", borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}>
          {matches.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
              No matching track — press Enter to keep &ldquo;{text}&rdquo; as free text.
            </div>
          ) : matches.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "8px 12px", background: t.id === valueId ? "var(--accent-cyan-dim)" : "transparent",
                border: "none", color: "var(--ink-0)", cursor: "pointer",
              }}
            >
              {t.logo_url
                ? <img src={t.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />
                : <span className="avatar avatar-sm avatar-fallback" style={{ borderRadius: 6 }}>🏁</span>}
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block" }}>{t.name}</strong>
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  {[t.location, t.track_type, t.length].filter(Boolean).join(" · ") || "Track"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
