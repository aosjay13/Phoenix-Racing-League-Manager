"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { duplicateReportFromError, ensureDriverId, isDuplicateDriverError } from "@/lib/driverPool";
import { driverAnswersTo, duplicateReport, searchDrivers } from "@/lib/driverMatch";
import { entryClassIds } from "@/lib/classFilter";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { DuplicateDriverPrompt } from "@/components/DuplicateDriverPrompt";

// Autocomplete for adding a driver mid race/qualifying entry: search the
// global driver pool + registered player accounts, or open the full driver
// creation modal for a brand-new one. Either path immediately POSTs a season
// `entry` (the same record every result row keys off), so the new row can be
// assigned a finishing position without leaving this screen.
//
// THE LIST SEARCHES EVERY NAME A DRIVER ANSWERS TO — their profile name, their
// display name, the name they use in each game, every connected account
// (Discord / PSN / Xbox / Steam / iRacing) and any name a merge folded into
// them (see lib/driverMatch.js). That matters most while entering results,
// because the name on the sheet in front of you is whatever the GAME called
// them: typing "Ryanbirdman" off a BeamNG export has to find Ryan Maynard, or
// the obvious next move is to create a second Ryan and split his history in
// two. Each row says which name it was found through, so an unfamiliar match
// can be placed at a glance.
//
// And creating someone genuinely new asks first when the name resembles a
// driver already in the app — the prompt that never used to exist.
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
  const [drivers, setDrivers] = useState([]);   // the global driver pool
  const [accounts, setAccounts] = useState([]); // player accounts with no driver profile yet
  const [games, setGames] = useState({});       // game_id -> name, to label an in-game match
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [createModalName, setCreateModalName] = useState(null); // non-null while the modal is open
  const [dupe, setDupe] = useState(null); // { name, report } while the "already have them?" prompt is up
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    Promise.all([api("/api/drivers"), api("/api/users"), api("/api/games").catch(() => [])])
      .then(([pool, users, gameList]) => {
        if (!live) return;
        setDrivers(pool);
        setGames(Object.fromEntries((gameList || []).map(g => [g.id, g.name])));
        // Player accounts nobody has made a driver for yet. Matched by account
        // first and name second, so an account whose driver already exists
        // isn't offered twice.
        const linked = new Set(pool.map(d => d.user_id).filter(Boolean));
        const named = new Set(pool.map(d => String(d.name || "").trim().toLowerCase()));
        setAccounts((users || []).filter(u => {
          const name = String(u.display_name || "").trim();
          return name && !linked.has(u.uid) && !named.has(name.toLowerCase());
        }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const q = query.trim();
  const taken = name => existingNames.has(String(name || "").trim().toLowerCase());

  // Drivers first (they carry history), then player accounts that have no
  // profile yet. Anyone already in this race is left out.
  const matches = useMemo(() => {
    if (!q) return [];
    const fromPool = searchDrivers(drivers, q, { games, limit: 8 })
      .filter(h => !taken(h.driver.name))
      .map(h => ({
        key: `d:${h.driver.id}`,
        name: h.driver.name,
        driver_id: h.driver.id,
        user_id: h.driver.user_id || "",
        // Only worth saying when it isn't the name on their profile — that's
        // the case where the admin would otherwise not recognise the row.
        via: h.via.source === "name" ? null : h.via,
      }));
    const needle = q.toLowerCase();
    const fromAccounts = accounts
      .filter(u => String(u.display_name).toLowerCase().includes(needle) && !taken(u.display_name))
      .slice(0, 4)
      .map(u => ({ key: `u:${u.uid}`, name: u.display_name, driver_id: null, user_id: u.uid, via: null, account: true }));
    return [...fromPool, ...fromAccounts].slice(0, 8);
  }, [q, drivers, accounts, games, existingNames]);

  // Somebody in the pool already goes by exactly what was typed — under any of
  // their names — so "create new driver" would be creating a twin.
  const exactExists = q
    ? drivers.some(d => driverAnswersTo(d, q, games))
      || accounts.some(u => String(u.display_name).trim().toLowerCase() === q.toLowerCase())
    : false;

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
    else startCreate(q);
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

  // "＋ Create new driver" doesn't create one yet: it asks whether this is
  // somebody already in the app first, and only opens the full form when the
  // answer is no (or there was nothing to ask about).
  function startCreate(name) {
    const typed = String(name || "").trim();
    if (!typed) return;
    const report = duplicateReport(drivers, { name: typed }, { games });
    if (report.status === "none") { setCreateModalName(typed); return; }
    setDupe({ name: typed, report });
  }

  async function addExisting(candidate) {
    setBusy(true);
    try {
      const driverId = await ensureDriverId({
        driverId: candidate.driver_id, name: candidate.name, user_id: candidate.user_id,
        pool: drivers, games,
      });

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
      setDupe(null);
    } catch (err) {
      // An account with no profile whose name resembles an existing driver:
      // ask rather than quietly making a second one.
      if (isDuplicateDriverError(err)) setDupe({ name: candidate.name, report: duplicateReportFromError(err), account: candidate });
      else onError(err.message);
    }
    finally {
      setBusy(false);
      // The input is disabled while the entry is being written, and a browser
      // blurs a control it disables — so put the caret back afterwards or the
      // next name would be typed into nothing.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  // "Create anyway" for a player account whose name resembled someone: the same
  // add, with the duplicate question already asked and answered.
  async function addExistingConfirmed(candidate) {
    setBusy(true);
    try {
      const driverId = await ensureDriverId({
        name: candidate.name, user_id: candidate.user_id, pool: drivers, games, confirmDuplicate: true,
      });
      const body = {
        name: candidate.name, team_id: "", season_id: seasonId, driver_id: driverId,
        class_ids: defaultClassId ? [defaultClassId] : [],
      };
      if (candidate.user_id) body.user_id = candidate.user_id;
      onCreated(await api("/api/entries", { method: "POST", body }));
      setQuery("");
      setOpen(false);
    } catch (err) { onError(err.message); }
    finally {
      setBusy(false);
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
        title="Type any name they race under — profile name, in-game name, PSN/Xbox/Discord — then press Enter to add the highlighted driver. ↑ / ↓ to pick another, Esc to close."
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
            <button key={opt.type === "existing" ? opt.candidate.key : "__create"} type="button" className="btn btn-ghost"
              style={{
                display: "block", width: "100%", textAlign: "left", marginTop: 0, borderRadius: 0,
                background: i === active ? "var(--bg-elevated)" : "transparent",
                color: opt.type === "create" ? "var(--accent-cyan)" : "var(--ink-0)",
              }}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}>
              {opt.type === "existing"
                ? (
                  <>
                    {opt.candidate.name}
                    {/* Found through a name that isn't on their profile — say
                        which, so an unexpected row makes sense. */}
                    {opt.candidate.via && (
                      <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)" }}>
                        {opt.candidate.via.label}: {opt.candidate.via.value}
                      </span>
                    )}
                    {opt.candidate.account && (
                      <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)" }}>
                        player account · no driver profile yet
                      </span>
                    )}
                  </>
                )
                : <>＋ Create new driver: &ldquo;{q}&rdquo;</>}
            </button>
          ))}
          {matches.length === 0 && exactExists && (
            <div style={{ padding: 8, fontSize: "0.8rem", color: "var(--ink-2)" }}>Already in this race.</div>
          )}
        </div>
      )}

      {dupe && (
        <DuplicateDriverPrompt
          typedName={dupe.name}
          status={dupe.report.status}
          matches={dupe.report.matches}
          busy={busy}
          onUse={m => {
            setDupe(null);
            addExisting({ key: `d:${m.driver_id}`, name: m.name, driver_id: m.driver_id, user_id: m.user_id || "" });
          }}
          onCreateAnyway={() => {
            const name = dupe.name;
            const account = dupe.account;
            setDupe(null);
            // An account that has no profile yet keeps its link when we go
            // ahead; a typed name opens the full form.
            if (account) addExistingConfirmed(account);
            else setCreateModalName(name);
          }}
          onCancel={() => { setDupe(null); setTimeout(() => inputRef.current?.focus(), 0); }}
        />
      )}

      {createModalName != null && (
        <DriverCreateModal
          seasonId={seasonId}
          seriesName={seriesName}
          initialName={createModalName}
          defaultClassId={defaultClassId}
          confirmDuplicate
          onClose={() => setCreateModalName(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
