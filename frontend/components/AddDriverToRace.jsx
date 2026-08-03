"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ensureDriverId } from "@/lib/driverPool";
import { entryClassIds } from "@/lib/classFilter";
import { DriverCreateModal } from "@/components/DriverCreateModal";

// Autocomplete for adding a driver mid race/qualifying entry: search the
// global driver pool + registered player accounts, or open the full driver
// creation modal for a brand-new one. Either path immediately POSTs a season
// `entry` (the same record every result row keys off), so the new row can be
// assigned a finishing position without leaving this screen.
//
// `defaultClassId` is the class the new entry joins — set while entering a
// class's own session, so a driver added mid-entry lands in the class whose
// grid is open instead of unclassified (where that grid wouldn't show them).
export function AddDriverToRace({ seasonId, seriesName, existingNames, defaultClassId = "", onCreated, onError }) {
  const [pool, setPool] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createModalName, setCreateModalName] = useState(null); // non-null while the modal is open

  useEffect(() => {
    let live = true;
    Promise.all([api("/api/drivers"), api("/api/users")])
      .then(([drivers, users]) => {
        if (!live) return;
        const byName = new Map();
        for (const d of drivers) byName.set(d.name.trim().toLowerCase(), { name: d.name, user_id: d.user_id || "", driver_id: d.id });
        for (const u of users) {
          const key = (u.display_name || "").trim().toLowerCase();
          if (key && !byName.has(key)) byName.set(key, { name: u.display_name, user_id: u.uid, driver_id: null });
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
      const driverId = await ensureDriverId({ driverId: candidate.driver_id, name: candidate.name, user_id: candidate.user_id });

      // Reuse the driver's existing entry in this season if they already have
      // one. Entering a class's own grid only lists that class's drivers, so
      // someone already on the roster in another class looks absent here —
      // creating a second entry for them is what used to leave the roster with
      // the same name three times over. Instead, add this class to the entry
      // they already have: one entry, several classes.
      const seasonEntries = await api(`/api/entries?season_id=${seasonId}`);
      const wanted = candidate.name.trim().toLowerCase();
      const mine = seasonEntries.find(e =>
        (driverId && e.driver_id === driverId) ||
        (candidate.user_id && e.user_id === candidate.user_id) ||
        String(e.name || "").trim().toLowerCase() === wanted);

      if (mine) {
        const have = entryClassIds(mine);
        const entry = (defaultClassId && !have.includes(defaultClassId))
          ? await api(`/api/entries/${mine.id}`, { method: "PATCH", body: { class_ids: [...have, defaultClassId] } })
          : mine;
        onCreated(entry);
      } else {
        const body = {
          name: candidate.name, team_id: "", season_id: seasonId, driver_id: driverId,
          class_ids: defaultClassId ? [defaultClassId] : [],
        };
        if (candidate.user_id) body.user_id = candidate.user_id;
        onCreated(await api("/api/entries", { method: "POST", body }));
      }
      setQuery("");
      setOpen(false);
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  function handleCreated(entry) {
    setCreateModalName(null);
    setQuery("");
    setOpen(false);
    onCreated(entry);
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
              onMouseDown={e => e.preventDefault()} onClick={() => setCreateModalName(query.trim())}>
              + Create new driver: &ldquo;{query.trim()}&rdquo;
            </button>
          )}
          {matches.length === 0 && exactExists && (
            <div style={{ padding: 8, fontSize: "0.8rem", color: "var(--ink-2)" }}>Already in this race.</div>
          )}
        </div>
      )}

      {createModalName != null && (
        <DriverCreateModal
          seasonId={seasonId}
          seriesName={seriesName}
          initialName={createModalName}
          defaultClassId={defaultClassId}
          onClose={() => setCreateModalName(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
