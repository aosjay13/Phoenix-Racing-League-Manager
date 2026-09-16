"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";

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

  const open = unmatched.filter(u => !done[u.name.toLowerCase()] && !ignored[u.name.toLowerCase()]);
  const settled = unmatched.length - open.length;

  function handleAdded(srhName, entry) {
    onDone?.(srhName.toLowerCase(), entry);
    onRosterChanged?.(entry);
  }

  if (!unmatched.length) return null;

  return (
    <div style={{ border: "1.5px solid var(--accent-amber, #d29922)", borderRadius: 10, padding: "12px 14px", margin: "14px 0", background: "var(--bg-elevated)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.92rem" }}>
          {unmatched.length} driver{unmatched.length === 1 ? "" : "s"} not on this season&rsquo;s roster
        </strong>
        {settled > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            {settled} settled · {open.length} left
          </span>
        )}
      </div>
      <p style={{ margin: "4px 0 10px", fontSize: "0.8rem", color: "var(--ink-1)" }}>
        Their rows were left out rather than guessed at. Point each one at the driver they already are,
        or create them — the box searches every name a driver answers to, so somebody who races here under
        a different name is found rather than duplicated. Then re-import the rounds below and their results
        land.
      </p>
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
          return (
            <div key={key} style={{ opacity: skipped ? 0.5 : 1 }}>
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
                    onClick={() => onIgnore?.(key, !skipped)}>
                    {skipped ? "Undo" : "Leave them off"}
                  </button>
                )}
              </div>
              {!entry && !skipped && (
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
