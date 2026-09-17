"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { nextUnanswered } from "@/lib/srhSeasonResults";
import { ensureDriverId, isDuplicateDriverError } from "@/lib/driverPool";
import { entryClassIds } from "@/lib/classFilter";

// The drivers a season import found on SimRacerHub and couldn't place — and
// the means to place them, without leaving the dialog.
//
// The importer never guesses at a name: a driver no roster place could be
// found for has their rows left out and their name said out loud. That is the
// right refusal, and on its own it is also a dead end — the admin reads "4
// drivers not on this season's roster", goes to the Roster screen, adds them
// by hand off a list they have to hold in their head, and comes back. For a
// season's worth of rounds that is the slowest part of the whole import.
//
// So the names come with the same box the results screen uses to add a driver
// mid-entry: literally AddDriverToRace, seeded with the name SimRacerHub
// printed. It searches EVERY name a driver answers to — profile name, the name
// they race under in this game, and each connected account (Discord, PSN, Xbox,
// Steam, iRacing) — so "Anderson, Nathan" off a SimRacerHub page finds the
// Nathan Anderson who has raced here for three seasons instead of starting a
// second one. Creating somebody genuinely new opens the full driver form and
// still asks first when the name resembles a driver already in the app.
//
// Reusing that component rather than writing a picker of its own is the point:
// who a driver is has one answer in this app, and a second search box with its
// own idea of which names count is exactly what splits a driver's history in
// two.
//
// It WORKS the list rather than displaying it. Checking a season turns up the
// same handful of people over and over, and a panel of a dozen boxes that all
// sit there waiting is a panel nobody finishes. So one name is active at a
// time: its box has the caret and its list is already down, and answering it
// opens the next one. The rest stay on screen — visible enough to see how far
// there is to go, and clickable to jump — but the one in front of you is the
// one the keyboard is pointed at.
//
// Nothing here re-imports. Resolving a name adds them to the season's roster;
// the rounds they were missing from are then re-run by the dialog, which is
// when their rows actually land.
// `done` and `ignored` are the dialog's, not this component's: the panel is
// taken down while a re-import runs, and a decision made before it must not be
// forgotten by the remount. `done` is srh name (lower-cased) -> the roster
// entry it went to, kept so a row reads as settled rather than vanishing — a
// list that shortens as you work it gives no sense of what you just decided.
// `ignored` is the same for the ones to leave off: a guest who ran one round is
// a real answer, and it should stop being asked.
export function SrhUnmatchedDrivers({
  seasonId, seriesName, unmatched = [], entries = [],
  done = {}, onDone, ignored = {}, onIgnore,
  onRosterChanged, onNotice, onError,
}) {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [bulk, setBulk] = useState(null);   // { at, total } while a bulk add runs
  const [bulkNote, setBulkNote] = useState("");

  // A season with classes puts every driver in one, and an entry with no class
  // is missing from that class's standings — so a season that HAS classes is
  // asked which one these drivers join, once, rather than per name.
  useEffect(() => {
    let live = true;
    if (!seasonId) return undefined;
    api(`/api/classes?season_id=${seasonId}`)
      .then(list => { if (live) setClasses(list || []); })
      .catch(() => { if (live) setClasses([]); });
    return () => { live = false; };
  }, [seasonId]);

  // Names already on the roster, so the picker doesn't offer somebody who is
  // there — the same guard the results screen's box uses.
  const existingNames = useMemo(
    () => new Set(entries.map(e => String(e.name || "").trim().toLowerCase()).filter(Boolean)),
    [entries],
  );

  const isOpen = u => !done[u.name.toLowerCase()] && !ignored[u.name.toLowerCase()];
  const open = unmatched.filter(isOpen);
  const settled = unmatched.length - open.length;

  // The name being worked. Follows the list on its own — the first unanswered
  // one — until the admin clicks another, which is how jumping back to fix a
  // mistake works without losing the run.
  const [activeKey, setActiveKey] = useState("");
  const activeRef = useRef(null);
  const activeIsOpen = open.some(u => u.name.toLowerCase() === activeKey);
  const firstOpen = open[0]?.name.toLowerCase() || "";
  const active = activeIsOpen ? activeKey : firstOpen;
  // Depends on the first open NAME rather than the list, which is a fresh array
  // every render and would re-run this on each one.
  useEffect(() => {
    if (!activeIsOpen && firstOpen) setActiveKey(firstOpen);
  }, [activeIsOpen, firstOpen]);

  // Keep the name being worked in view as the run moves down a long list. Not
  // on the first one: the dialog has just scrolled to this panel's heading,
  // which is what explains why the panel is there at all.
  const started = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (started.current) activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    started.current = true;
  }, [active]);

  // Which of the run this is, for the "3 of 9" line — counted over the whole
  // list rather than what's left, so the number climbs as you work instead of
  // standing still.
  const position = unmatched.findIndex(u => u.name.toLowerCase() === active) + 1;

  // Move on to the next unanswered name. See nextUnanswered — the answer just
  // given hasn't reached `done`/`ignored` yet (it was set in the same tick), so
  // the name being advanced FROM is excluded there rather than here.
  const advanceFrom = useCallback(key => {
    const answered = [
      ...Object.keys(done).filter(k => done[k]),
      ...Object.keys(ignored).filter(k => ignored[k]),
    ];
    setActiveKey(nextUnanswered(unmatched.map(u => u.name.toLowerCase()), key, answered));
  }, [unmatched, done, ignored]);

  function handleAdded(srhName, entry) {
    const key = srhName.toLowerCase();
    onDone?.(key, entry);
    onRosterChanged?.(entry);
    advanceFrom(key);
  }

  // ── Add everyone the app can place on its own ────────────────────────────
  //
  // A brand new season in a brand new series starts with an empty roster, so
  // EVERY name on the pages is one to add — and answering thirty of them one at
  // a time is not an import in one click by any reading.
  //
  // So the ones that need no decision are done in one press, and only those.
  // What counts as needing no decision is not this component's opinion: it is
  // duplicateReport's, the same rule the picker below and POST /api/drivers
  // apply. A name nothing in the driver pool resembles ("none") is created; a
  // name matching exactly one driver, or a player account, IS that driver
  // ("linked") and the entry hangs on them. Anything a human should look at —
  // several candidates, or one that merely resembles them — is left alone and
  // stays in the list, because a bulk add that guessed at those is precisely
  // how a league ends up with two of somebody.
  async function addAll() {
    const todo = open.slice();
    if (!todo.length) return;
    setBulk({ at: 0, total: todo.length });
    setBulkNote("");
    let created = 0, linked = 0, asked = 0;
    try {
      const [pool, gameList, seasonEntries] = await Promise.all([
        api("/api/drivers").catch(() => []),
        api("/api/games").catch(() => []),
        api(`/api/entries?season_id=${seasonId}`).catch(() => []),
      ]);
      const games = Object.fromEntries((gameList || []).map(g => [g.id, g.name]));
      const roster = [...(seasonEntries || [])];

      for (let i = 0; i < todo.length; i++) {
        const u = todo[i];
        setBulk({ at: i + 1, total: todo.length });
        let driverId;
        try {
          // Reuses the driver when the pool already holds them, creates one
          // when it plainly doesn't, and throws when it is a question.
          driverId = await ensureDriverId({ name: u.name, pool, games });
        } catch (err) {
          if (isDuplicateDriverError(err)) { asked += 1; continue; }
          throw err;
        }
        const known = pool.some(d => d.id === driverId);
        // Already on this season's roster under another name — take the entry
        // they have rather than making a second one, the same way the picker
        // does.
        const mine = roster.find(e => e.driver_id === driverId);
        let entry = mine;
        if (mine) {
          const have = entryClassIds(mine);
          if (classId && !have.includes(classId)) {
            entry = await api(`/api/entries/${mine.id}`, { method: "PATCH", body: { class_ids: [...have, classId] } });
          }
        } else {
          entry = await api("/api/entries", {
            method: "POST",
            body: {
              name: u.name, team_id: "", season_id: seasonId, driver_id: driverId,
              class_ids: classId ? [classId] : [],
            },
          });
          roster.push(entry);
        }
        if (known) linked += 1; else created += 1;
        onDone?.(u.name.toLowerCase(), entry);
        onRosterChanged?.(entry);
      }

      const said = [
        created ? `${created} new driver${created === 1 ? "" : "s"} created` : "",
        linked ? `${linked} matched to ${linked === 1 ? "a driver" : "drivers"} you already have` : "",
        asked ? `${asked} left below — ${asked === 1 ? "it resembles" : "they resemble"} somebody already in the app, so ${asked === 1 ? "it needs" : "they need"} your answer` : "",
      ].filter(Boolean).join(" · ");
      setBulkNote(said || "Nothing to add.");
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBulk(null);
    }
  }

  if (!unmatched.length) return null;

  return (
    <div style={{ border: "1.5px solid var(--accent-amber, #d29922)", borderRadius: 10, padding: "12px 14px", margin: "14px 0", background: "var(--bg-elevated)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.92rem" }}>
          {unmatched.length} driver{unmatched.length === 1 ? "" : "s"} not on this season&rsquo;s roster
        </strong>
        {open.length > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            on {position || 1} of {unmatched.length}
            {settled > 0 ? ` · ${settled} settled · ${open.length} left` : ""}
          </span>
        )}
        {open.length === 0 && (
          <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: "0.72rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>
            ✓ all {unmatched.length} answered — re-import the rounds below
          </span>
        )}
      </div>
      <p style={{ margin: "4px 0 10px", fontSize: "0.8rem", color: "var(--ink-1)" }}>
        {entries.length === 0
          ? "This season's roster is empty, which is where a new season starts — so every driver on those pages is one to add. "
          : "Their rows were left out rather than guessed at. "}
        The first one is open below with its list down:
        point it at the driver they already are, or create them, and the next one opens itself. The box
        searches every name a driver answers to, so somebody who races here under a different name is found
        rather than duplicated, and creating someone genuinely new asks first if the name resembles a driver
        you already have. When they&rsquo;re all answered, re-import the rounds below and their results land.
      </p>
      {/* The one press that makes a brand new season work. Everything needing
          no decision goes on the roster at once; the rest stay below. */}
      {open.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}>
          <button type="button" className="btn btn-primary" style={{ marginTop: 0 }}
            disabled={!!bulk}
            title="Create the drivers nothing in your driver database resembles, and hang the rest on the driver they already are. Anything that needs a decision is left below."
            onClick={addAll}>
            {bulk ? `Adding ${bulk.at} of ${bulk.total}…` : `Add all ${open.length} to the roster`}
          </button>
          <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
            {entries.length === 0
              ? "This season has no roster yet, so every name above is one to add — start here."
              : "Only the ones needing no decision; anyone resembling a driver you already have is left for you."}
          </span>
        </div>
      )}
      {bulkNote && <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "#3fb950" }}>{bulkNote}</p>}

      <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "var(--ink-2)" }}>
        If the box says a name is <em>already on this season&rsquo;s roster</em>, then they are on it under a
        name too far from the one SimRacerHub prints for the import to be sure. Add SimRacerHub&rsquo;s
        spelling to their profile as their iRacing name and every round after this matches them on its own.
      </p>

      {classes.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="srh_unmatched_class">Add them to class</label>
          <select id="srh_unmatched_class" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">Unclassified</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
            This season runs classes, and a driver with none is missing from every class table. Change it
            between drivers if they don&rsquo;t all race the same one.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {unmatched.map(u => {
          const key = u.name.toLowerCase();
          const entry = done[key];
          const skipped = ignored[key];
          const rounds = u.rounds || [];
          const isActive = key === active;
          return (
            <div key={key} ref={isActive ? activeRef : null}
              onMouseDown={() => { if (!entry && !skipped && !isActive) setActiveKey(key); }}
              style={{
                opacity: skipped ? 0.5 : 1,
                cursor: !entry && !skipped && !isActive ? "pointer" : undefined,
                borderLeft: isActive ? "3px solid var(--accent-cyan)" : "3px solid transparent",
                paddingLeft: 8,
              }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.86rem" }}>{u.name}</strong>
                <span style={{ fontSize: "0.74rem", color: "var(--ink-2)" }}
                  title={rounds.map(r => r.label).filter(Boolean).join("\n")}>
                  {rounds.length} round{rounds.length === 1 ? "" : "s"}
                </span>
                {entry && (
                  <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: "0.7rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>
                    ✓ on the roster as {entry.name}
                  </span>
                )}
                {skipped && (
                  <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: "0.7rem", background: "rgba(255,255,255,0.08)", color: "var(--ink-2)" }}>
                    left off
                  </span>
                )}
                {!entry && (
                  <button type="button" className="btn btn-ghost"
                    style={{ marginTop: 0, padding: "2px 8px", fontSize: "0.74rem", marginLeft: "auto" }}
                    onClick={() => { onIgnore?.(key, !skipped); if (!skipped) advanceFrom(key); }}>
                    {skipped ? "Undo" : "Leave them off"}
                  </button>
                )}
              </div>
              {!entry && !skipped && !isActive && (
                <div style={{ fontSize: "0.76rem", color: "var(--ink-2)", marginTop: 2 }}>
                  Waiting — click to answer this one next.
                </div>
              )}
              {!entry && !skipped && isActive && (
                <AddDriverToRace
                  seasonId={seasonId}
                  seriesName={seriesName}
                  existingNames={existingNames}
                  defaultClassId={classId}
                  // The name SimRacerHub printed, already typed — click the box
                  // and the candidates for it are there.
                  initialQuery={u.name}
                  placeholder="Who is this? Search every name they race under…"
                  emptyLabel="Already on this season's roster."
                  clearOnAdd={false}
                  // The caret lands here with the list already down, so the run
                  // is worked without reaching for the mouse between names.
                  autoOpen
                  style={{ maxWidth: 420, marginTop: 4 }}
                  onCreated={e => handleAdded(u.name, e)}
                  onNotice={onNotice}
                  onError={onError}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
