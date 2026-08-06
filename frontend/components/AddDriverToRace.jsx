"use client";

import { useEffect, useRef, useState } from "react";
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
//
// Keyboard-first, because adding a field is a dozen drivers in a row and
// reaching for the mouse between each one is the slow part: ↓/↑ move the
// highlight, Enter takes the highlighted row (the top match by default, so
// type-then-Enter is the whole interaction), Escape closes the list. Focus
// stays in the box after an add and the query clears itself, so the next name
// can be typed straight away.
export function AddDriverToRace({ seasonId, seriesName, existingNames, defaultClassId = "", onCreated, onError }) {
  const [pool, setPool] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [createModalName, setCreateModalName] = useState(null); // non-null while the modal is open
  const inputRef = useRef(null);

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

  // One flat list so the keyboard and the mouse pick from exactly the same
  // options in the same order — the "create new driver" row included, since
  // typing a name nobody has and hitting Enter should open that.
  const options = [
    ...matches.map(c => ({ type: "existing", candidate: c })),
    ...(!exactExists && q ? [{ type: "create" }] : []),
  ];

  // Any change to what's typed (or reopening the list) puts the highlight back
  // on the top match, so Enter always takes the obvious answer.
  useEffect(() => { setActive(0); }, [query, open]);

  function choose(opt) {
    if (!opt || busy) return;
    if (opt.type === "existing") addExisting(opt.candidate);
    else setCreateModalName(query.trim());
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      // Always swallow Enter: this box sits inside the results form, and a bare
      // Enter there would submit it instead of adding the driver.
      e.preventDefault();
      if (open) choose(options[active]);
    }
    else if (e.key === "Escape") { setOpen(false); }
  }

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
    finally {
      setBusy(false);
      // The input is disabled while the entry is being written, and a browser
      // blurs a control it disables — so put the caret back afterwards or the
      // next name would be typed into nothing.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleCreated(entry) {
    setCreateModalName(null);
    setQuery("");
    setOpen(false);
    onCreated(entry);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ position: "relative", maxWidth: 320, marginTop: 12 }}>
      <input
        ref={inputRef}
        placeholder="+ Add a driver to this race…"
        title="Type a name, then press Enter to add the highlighted driver. ↑ / ↓ to pick another, Esc to close."
        value={query}
        disabled={busy || !seasonId}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && q && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          background: "var(--surface-1, #14141c)", border: "1px solid var(--border)",
          borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: "auto",
        }}>
          {options.map((opt, i) => (
            <button key={opt.type === "existing" ? opt.candidate.name : "__create"} type="button" className="btn btn-ghost"
              style={{
                display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0,
                background: i === active ? "var(--bg-elevated)" : "transparent",
                color: opt.type === "create" ? "var(--accent-cyan)" : "var(--ink-0)",
              }}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}>
              {opt.type === "existing"
                ? opt.candidate.name
                : <>＋ Create new driver: &ldquo;{query.trim()}&rdquo;</>}
            </button>
          ))}
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
