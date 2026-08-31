"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { driverAnswersTo, duplicateReport, matchReason, searchDrivers } from "@/lib/driverMatch";
import { DuplicateDriverPrompt } from "@/components/DuplicateDriverPrompt";

// Adding somebody to a time trial / placement sheet.
//
// This box used to match on one thing: a driver's profile name. That is the
// single worst place in the app for that, because a placement night's sheet is
// typed straight off the game's own timing screen — so the name in front of
// the admin is whatever the GAME calls them, which is exactly the name that
// isn't on their profile. Typing "Ryanbirdman" found nobody, went in as a
// plain name, and at the end of the night the roster build created a second
// Ryan with none of his history on it.
//
// So it searches every name a driver answers to — profile name, display name,
// their name in each game, every connected account (Discord / PSN / Xbox /
// Steam / iRacing) and any name a merge folded into them — and says which one
// it matched through, so an unfamiliar row can be placed at a glance. See
// lib/driverMatch.js, which is the same module the roster, the race entry
// screen and the bulk importer ask.
//
// A name that matches nobody is still perfectly valid: a placement night is
// run FOR drivers who are on no roster and often in no pool yet. But if it
// resembles somebody already in the app, it asks first — one click to attach
// the row to the driver it's really about, and their laps count toward the
// person rather than a name.
export function AddDriverToTrial({
  pool = [], drivers = [], games = {}, taken, onAdd, disabled, onNotice = () => {},
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dupe, setDupe] = useState(null);
  const inputRef = useRef(null);

  const q = query.trim();
  const isTaken = name => taken.has(String(name || "").trim().toLowerCase());

  // The roster/pool candidates the sheet can add, ranked. `pool` carries the
  // season's roster (with car numbers and the entry a qualifying export files
  // against) plus every global driver; the alias search runs over the driver
  // pool, and its hits are mapped back onto the roster row where there is one
  // so a driver added this way still brings their number and entry.
  const matches = useMemo(() => {
    if (!q) return [];
    const byDriverId = new Map(pool.filter(p => p.driver_id).map(p => [p.driver_id, p]));
    const byName = new Map(pool.map(p => [String(p.name || "").trim().toLowerCase(), p]));
    const seen = new Set();
    const out = [];

    // Staff screen — searches every name, iRacing's included (see
    // visibleNames in lib/driverMatch.js).
    for (const hit of searchDrivers(drivers, q, { games, limit: 8, privileged: true })) {
      const known = byDriverId.get(hit.driver.id) || byName.get(String(hit.driver.name || "").trim().toLowerCase());
      const candidate = {
        ...(known || {}),
        name: known?.name || hit.driver.name,
        driver_id: hit.driver.id,
        user_id: known?.user_id || hit.driver.user_id || "",
        source: known?.source || "driver pool",
        // Only worth saying when it isn't the name on their profile — that's
        // the case where the admin would otherwise not recognise the row.
        via: hit.via.source === "name" ? null : hit.via,
      };
      if (isTaken(candidate.name) || seen.has(candidate.name.toLowerCase())) continue;
      seen.add(candidate.name.toLowerCase());
      out.push(candidate);
    }

    // Roster rows with no driver profile behind them yet (a legacy entry) are
    // still addable — they're matched on their own name.
    const needle = q.toLowerCase();
    for (const p of pool) {
      if (p.driver_id || out.length >= 8) continue;
      const name = String(p.name || "").trim();
      if (!name.toLowerCase().includes(needle) || isTaken(name) || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ ...p, via: null });
    }
    return out.slice(0, 8);
  }, [q, pool, drivers, games, taken]);

  // Somebody already goes by exactly what was typed — under any of their names
  // — so "add by name" would be adding a row for a person the app can identify.
  const exactExists = q
    ? drivers.some(d => driverAnswersTo(d, q, games)) || pool.some(p => String(p.name || "").toLowerCase() === q.toLowerCase())
    : false;

  const options = [
    ...matches.map(c => ({ type: "existing", candidate: c })),
    ...(!exactExists && q ? [{ type: "byName" }] : []),
  ];

  useEffect(() => { setActive(0); }, [query, open]);

  function add(candidate) {
    onAdd(candidate);
    setQuery("");
    setOpen(false);
    setDupe(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // "Add by name" asks the global pool first. `linked` means one driver
  // demonstrably answers to this name — that isn't a question, so the row is
  // attached to them and the admin is spared a dialog. It is NOT spared the
  // news, though: silently filing a night's laps under a profile whose name
  // isn't the one that was typed is the sort of helpfulness that reads as a bug
  // when somebody notices it later.
  function addByName(name) {
    const typed = String(name || "").trim();
    if (!typed) return;
    const report = duplicateReport(drivers, { name: typed }, { games });
    if (report.status === "none") return add({ name: typed });
    if (report.status === "linked") {
      const m = report.match;
      add({ name: m.name, driver_id: m.driver_id, user_id: m.user_id || "" });
      onNotice(`“${typed}” is ${m.name}, already in the app (${matchReason(m)}) — their laps go on that profile.`);
      return;
    }
    setDupe({ name: typed, report });
  }

  function choose(opt) {
    if (!opt) return;
    if (opt.type === "existing") add(opt.candidate);
    else addByName(q);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!q) return;
      choose(options[active] || options[0]);
    } else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div style={{ position: "relative", maxWidth: 340, marginTop: 12 }}>
      <input ref={inputRef} value={query} disabled={disabled}
        placeholder="+ Add a driver to this session…"
        title="Type any name they race under — profile name, in-game name, PSN/Xbox/Discord. Enter adds the highlighted driver; ↑/↓ picks another; Esc closes."
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown} />
      {open && q && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          background: "var(--bg-elevated, #14141c)", border: "1px solid var(--border)",
          borderRadius: 8, marginTop: 4, maxHeight: 260, overflowY: "auto",
        }}>
          {options.map((opt, i) => (
            <button key={opt.type === "existing" ? `${opt.candidate.driver_id || opt.candidate.entry_id || opt.candidate.name}` : "__byname"}
              type="button" className="btn btn-ghost"
              style={{
                display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0,
                background: i === active ? "var(--bg-elevated)" : "transparent",
                color: opt.type === "byName" ? "var(--accent-cyan)" : "var(--ink-0)",
              }}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}>
              {opt.type === "existing" ? (
                <>
                  {opt.candidate.name}
                  {opt.candidate.source && (
                    <span style={{ color: "var(--ink-2)", fontSize: "0.76rem" }}> · {opt.candidate.source}</span>
                  )}
                  {/* Found through a name that isn't on their profile — say
                      which, so an unexpected row makes sense. */}
                  {opt.candidate.via && (
                    <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)" }}>
                      {opt.candidate.via.label}: {opt.candidate.via.value}
                    </span>
                  )}
                </>
              ) : <>＋ Add &ldquo;{q}&rdquo; by name</>}
            </button>
          ))}
          {/* Typing the name of somebody already on the sheet leaves nothing to
              offer — they're filtered out of the matches, and "add by name"
              would be a second row for the same person. Say so, rather than
              dropping an empty box under the cursor. */}
          {options.length === 0 && (
            <div style={{ padding: 8, fontSize: "0.8rem", color: "var(--ink-2)" }}>
              {exactExists ? "Already on this sheet." : "No matches."}
            </div>
          )}
        </div>
      )}

      {dupe && (
        <DuplicateDriverPrompt
          typedName={dupe.name}
          status={dupe.report.status}
          matches={dupe.report.matches}
          createLabel="No — add this name on its own"
          onUse={m => add({ name: m.name, driver_id: m.driver_id, user_id: m.user_id || "" })}
          onCreateAnyway={() => add({ name: dupe.name })}
          onCancel={() => { setDupe(null); setTimeout(() => inputRef.current?.focus(), 0); }}
        />
      )}
    </div>
  );
}
