"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Autocomplete for adding a driver mid race/qualifying entry: search the
// global driver pool + registered player accounts, or create a brand-new
// driver on the spot. Either path immediately POSTs a season `entry` (the
// same record every result row keys off), so the new row can be assigned a
// finishing position without leaving this screen.
export function AddDriverToRace({ seasonId, existingNames, onCreated, onError }) {
  const [pool, setPool] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api("/api/drivers"), api("/api/users")])
      .then(([drivers, users]) => {
        if (!live) return;
        const byName = new Map();
        for (const d of drivers) byName.set(d.name.trim().toLowerCase(), { name: d.name, user_id: d.user_id || "" });
        for (const u of users) {
          const key = (u.display_name || "").trim().toLowerCase();
          if (key && !byName.has(key)) byName.set(key, { name: u.display_name, user_id: u.uid });
        }
        setPool([...byName.values()]);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q
    ? pool.filter(c => c.name.toLowerCase().includes(q) && !existingNames.has(c.name.toLowerCase())).slice(0, 8)
    : [];
  const exactExists = pool.some(c => c.name.toLowerCase() === q);

  async function addExisting(candidate) {
    setBusy(true);
    try {
      const body = { name: candidate.name, team_id: "", season_id: seasonId };
      if (candidate.user_id) body.user_id = candidate.user_id;
      const entry = await api("/api/entries", { method: "POST", body });
      onCreated(entry);
      setQuery("");
      setOpen(false);
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  async function createNew() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    try {
      // Best-effort: register the identity in the global pool too, so it's
      // reusable from Roster or another race even if this fails.
      api("/api/drivers", { method: "POST", body: { name } }).catch(() => {});
      const entry = await api("/api/entries", { method: "POST", body: { name, team_id: "", season_id: seasonId } });
      onCreated(entry);
      setQuery("");
      setOpen(false);
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ position: "relative", maxWidth: 320, marginTop: 12 }}>
      <input
        placeholder="+ Add a driver to this race…"
        value={query}
        disabled={busy || !seasonId}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          background: "var(--surface-1, #14141c)", border: "1px solid var(--border)",
          borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: "auto",
        }}>
          {matches.map(c => (
            <button key={c.name} type="button" className="btn btn-ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0 }}
              onMouseDown={e => e.preventDefault()} onClick={() => addExisting(c)}>
              {c.name}
            </button>
          ))}
          {!exactExists && (
            <button type="button" className="btn btn-ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0, color: "var(--accent-cyan)" }}
              onMouseDown={e => e.preventDefault()} onClick={createNew}>
              + Create new driver: &ldquo;{query.trim()}&rdquo;
            </button>
          )}
          {matches.length === 0 && exactExists && (
            <div style={{ padding: 8, fontSize: "0.8rem", color: "var(--ink-2)" }}>Already in this race.</div>
          )}
        </div>
      )}
    </div>
  );
}
