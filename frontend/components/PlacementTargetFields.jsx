"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// What a placement night sorts drivers INTO — the shared block behind both the
// create dialog and the session settings, so a target picked in one is the same
// target picked in the other.
//
// Two kinds, and they compose:
//
//   • Series. For the leagues whose divisions ARE series — a Pro Series and an
//     Amateur Series, each with its own seasons, schedule and championship,
//     rather than two classes inside one season. Each series names the SEASON
//     whose roster it builds, because a roster belongs to a season; it defaults
//     to that series' newest, which is the one being raced.
//   • Classes. The divisions inside the trial's own season, exactly as before.
//
// A league that runs classes alone never ticks a series and sees precisely what
// it saw before series placement existed.
export function PlacementTargetFields({
  idPrefix, seriesList = [], classes = [], seasonId = "",
  seriesIds = [], seriesSeasons = {}, classIds = [],
  onChange,
}) {
  // series id -> that series' seasons, loaded when it's ticked so the season
  // dropdown beside it can be filled.
  const [seasonsBySeries, setSeasonsBySeries] = useState({});

  useEffect(() => {
    let live = true;
    const missing = seriesIds.filter(id => !seasonsBySeries[id]);
    if (!missing.length) return;
    Promise.all(missing.map(id =>
      api(`/api/seasons?series_id=${id}`).then(list => [id, list]).catch(() => [id, []])
    )).then(pairs => {
      if (!live) return;
      setSeasonsBySeries(prev => ({ ...prev, ...Object.fromEntries(pairs) }));
      // Default each newly-ticked series to its newest season — /api/seasons
      // answers newest first (by race date), so that's the one being raced.
      const defaults = {};
      for (const [id, list] of pairs) {
        if (!seriesSeasons[id] && list[0]?.id) defaults[id] = list[0].id;
      }
      if (Object.keys(defaults).length) {
        onChange({ series_seasons: { ...seriesSeasons, ...defaults } });
      }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesIds.join("|")]);

  function toggleSeries(id) {
    const on = seriesIds.includes(id);
    const nextIds = on ? seriesIds.filter(s => s !== id) : [...seriesIds, id];
    // Unticking a series drops the season it was routing rosters to, so a
    // stale destination can't survive out of sight.
    const nextSeasons = { ...seriesSeasons };
    if (on) delete nextSeasons[id];
    onChange({ series_ids: nextIds, series_seasons: nextSeasons });
  }

  function toggleClass(id) {
    onChange({
      class_ids: classIds.includes(id) ? classIds.filter(c => c !== id) : [...classIds, id],
    });
  }

  return (
    <>
      <div className="field">
        <span className="field-label">Place into these series</span>
        {seriesList.length === 0 ? (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            No series in the selected game yet.
          </span>
        ) : (
          <div className="option-rows">
            {seriesList.map(s => {
              const on = seriesIds.includes(s.id);
              const seasons = seasonsBySeries[s.id] || [];
              return (
                <div key={s.id}>
                  <label className="check-row" style={{ margin: 0 }}>
                    <input type="checkbox" id={`${idPrefix}_series_${s.id}`} checked={on}
                      onChange={() => toggleSeries(s.id)} />
                    <span>{s.name}</span>
                  </label>
                  {on && (
                    <select
                      aria-label={`Season whose roster ${s.name} builds`}
                      style={{ marginTop: 4, marginLeft: 28, maxWidth: 260 }}
                      value={seriesSeasons[s.id] || ""}
                      onChange={e => onChange({ series_seasons: { ...seriesSeasons, [s.id]: e.target.value } })}>
                      <option value="">
                        {seasons.length ? "Pick the season to build…" : "No seasons in this series yet"}
                      </option>
                      {seasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          For leagues whose divisions are <strong>separate series</strong>. Each one builds the roster
          of the season named beneath it — the newest by default. Fastest drivers fill the first
          series listed when you sort the field by time.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Place into these divisions (classes)</span>
        {!seasonId ? (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            No season attached yet, so there are no classes to place into. Series placement above
            works without one.
          </span>
        ) : classes.length === 0 ? (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            This season has no classes — add them in League Setup and they&rsquo;ll appear here.
          </span>
        ) : (
          <div className="option-rows">
            {classes.map(c => (
              <label key={c.id} className="check-row" style={{ margin: 0 }}>
                <input type="checkbox" id={`${idPrefix}_class_${c.id}`} checked={classIds.includes(c.id)}
                  onChange={() => toggleClass(c.id)} />
                <span>{c.car ? `${c.name} · ${c.car}` : c.name}</span>
              </label>
            ))}
          </div>
        )}
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Classes inside this session&rsquo;s own season. Pick <strong>both</strong> kinds to sort a
          driver into a series <em>and</em> a class within it — the classes on offer for a driver
          then come from whichever season their series builds.
        </span>
      </div>
    </>
  );
}
