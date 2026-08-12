"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { raceNeighbours } from "@/lib/raceNav";

// Previous / next round navigation for one event's screen — the results viewer
// and the admin results editor both render it, so browsing a season never has
// to go back through the Schedule to open the round beside the one you're on.
//
// `mode` keeps you where you already are: "view" links to the public results
// pages, "edit" to the admin editor. An admin flicking through rounds entering
// results stays in the editor; a player reading results stays in the viewer.
//
// Order is the Schedule's own — round number ascending, dates and names only
// breaking a tie — so "next" is the next round as the calendar lists it. On a
// season running per-class calendars, a round pinned to ONE class steps through
// that class's calendar (its own rounds plus the shared ones); everything else
// steps through the whole season.
//
// `tab` (edit mode only) is the tab currently open, carried onto the next round
// when that round has it: flicking from one Feature to the next stays on the
// Feature rather than dropping back to Race Info. A round of a different format
// gets the nearest equivalent.
export function RaceNav({ race, mode = "view", tab = null }) {
  const [races, setRaces] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!race?.season_id) { setRaces(null); return undefined; }
    api(`/api/races?season_id=${race.season_id}`)
      .then(list => { if (!cancelled) setRaces(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setRaces([]); });
    return () => { cancelled = true; };
  }, [race?.season_id]);

  // Nothing until the season's calendar is in hand, and nothing for a season
  // holding a single round — there is no round either side of it to offer.
  if (!races || !race) return null;
  const { ordered, at, prev, next } = raceNeighbours(races, race);
  if (at < 0 || ordered.length < 2) return null;

  // Where the same tab lives on the round being opened. A heat weekend and a
  // standard round don't share tabs, so the closest equivalent is used rather
  // than a tab that would silently fall back to Race Info.
  const tabFor = target => {
    if (mode !== "edit" || !tab) return "";
    const heat = !!target.heat_format;
    let want = tab;
    if (heat && tab === "results") want = "feature";
    if (!heat && (tab === "heats" || tab === "consolation" || tab === "feature")) want = "results";
    return `?tab=${want}`;
  };
  const hrefFor = target => (mode === "edit"
    ? `/races/${target.id}/edit${tabFor(target)}`
    : `/races/${target.id}`);

  const label = target => `R${target.round_number ?? "?"} · ${target.name || "Untitled"}`;
  const btn = { marginTop: 0, padding: "6px 12px", fontSize: "0.82rem", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {prev ? (
        <Link href={hrefFor(prev)} className="btn btn-ghost" style={btn} title={`Previous round — ${label(prev)}`}>
          ← {label(prev)}
        </Link>
      ) : (
        <button type="button" className="btn btn-ghost" style={{ ...btn, opacity: 0.45, cursor: "default" }} disabled
          title="This is the first round of the season">← First round</button>
      )}
      <span style={{ fontSize: "0.78rem", color: "var(--ink-2)", whiteSpace: "nowrap" }}>
        Round {at + 1} of {ordered.length}
      </span>
      {next ? (
        <Link href={hrefFor(next)} className="btn btn-ghost" style={btn} title={`Next round — ${label(next)}`}>
          {label(next)} →
        </Link>
      ) : (
        <button type="button" className="btn btn-ghost" style={{ ...btn, opacity: 0.45, cursor: "default" }} disabled
          title="This is the last round of the season">Last round →</button>
      )}
    </div>
  );
}
