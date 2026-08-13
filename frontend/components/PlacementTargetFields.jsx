"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

// "Where are these drivers going?" — the destinations a placement night sorts
// its field into, and the one screen an admin has to understand before the
// board makes any sense.
//
// It is driven by the GAME selected in the top menu, so everything that game
// runs is on offer in one list, whether or not this session is attached to a
// season yet — a placement night is routinely held before the season it feeds
// exists, and the destinations are exactly what it's held to decide.
//
// Two kinds of destination, and they compose:
//
//   • Series. For the leagues whose divisions ARE series — a Pro Series and an
//     Amateur Series, each with its own seasons, schedule and championship.
//     Each names the SEASON whose roster it builds, because a roster belongs
//     to a season; it defaults to that series' newest, which is the one being
//     raced.
//   • Classes. The divisions inside a season — "Pro" / "Amateur", GT3 / LMP2.
//     Offered for this session's own season AND inside each series, since
//     that's where the classes an admin means usually live.
//
// Ticking a class inside a series ticks the series too: a driver placed in
// "Pro Series ▸ GT3" is in the Pro Series, and asking somebody to tick both
// boxes to express one fact is how a night ends up half-configured.
//
// A league that runs classes in one season alone ticks two boxes and sees
// precisely what it saw before any of this existed.
export function PlacementTargetFields({
  idPrefix, seriesList = [], classes = [], seasonId = "", seasonName = "",
  seriesIds = [], seriesSeasons = {}, classIds = [],
  onChange,
}) {
  // series id -> that series' seasons, loaded when it's ticked so the season
  // dropdown beside it can be filled.
  const [seasonsBySeries, setSeasonsBySeries] = useState({});
  // season id -> its classes, so a series can offer its own divisions.
  const [classesBySeason, setClassesBySeason] = useState({});

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

  // The divisions each ticked series offers: the classes of the season it
  // builds. Loaded per season, and cached, so switching a series' season shows
  // that season's classes rather than the previous one's.
  const wantedSeasons = useMemo(
    () => [...new Set(seriesIds.map(id => seriesSeasons[id]).filter(Boolean))],
    [seriesIds, seriesSeasons]
  );
  useEffect(() => {
    let live = true;
    const missing = wantedSeasons.filter(id => !classesBySeason[id]);
    if (!missing.length) return;
    Promise.all(missing.map(id =>
      api(`/api/classes?season_id=${id}`).then(list => [id, list]).catch(() => [id, []])
    )).then(pairs => {
      if (live) setClassesBySeason(prev => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedSeasons.join("|")]);

  const classesForSeries = id => classesBySeason[seriesSeasons[id]] || [];

  function toggleSeries(id) {
    const on = seriesIds.includes(id);
    const nextIds = on ? seriesIds.filter(s => s !== id) : [...seriesIds, id];
    // Unticking a series drops the season it was routing rosters to, and the
    // divisions inside that season — a stale destination must not survive out
    // of sight, ticked but invisible.
    const nextSeasons = { ...seriesSeasons };
    let nextClassIds = classIds;
    if (on) {
      const dropped = new Set(classesForSeries(id).map(c => c.id));
      nextClassIds = classIds.filter(c => !dropped.has(c));
      delete nextSeasons[id];
    }
    onChange({ series_ids: nextIds, series_seasons: nextSeasons, class_ids: nextClassIds });
  }

  // Changing which season a series builds changes which divisions it offers,
  // so the ones ticked from the old season go with it.
  function setSeriesSeason(id, seasonValue) {
    const dropped = new Set(classesForSeries(id).map(c => c.id));
    onChange({
      series_seasons: { ...seriesSeasons, [id]: seasonValue },
      class_ids: classIds.filter(c => !dropped.has(c)),
    });
  }

  // Ticking a division inside a series ticks the series as well — one fact,
  // one click.
  function toggleClass(id, ownerSeriesId = "") {
    const on = classIds.includes(id);
    const patch = { class_ids: on ? classIds.filter(c => c !== id) : [...classIds, id] };
    if (!on && ownerSeriesId && !seriesIds.includes(ownerSeriesId)) {
      patch.series_ids = [...seriesIds, ownerSeriesId];
    }
    onChange(patch);
  }

  // What's been picked, in one line, so a long list of checkboxes still ends
  // with a plain answer to "where are they going?".
  const chosen = useMemo(() => {
    const out = [];
    for (const s of seriesList) {
      if (!seriesIds.includes(s.id)) continue;
      const picked = classesForSeries(s.id).filter(c => classIds.includes(c.id));
      if (picked.length) out.push(...picked.map(c => `${s.name} · ${c.name}`));
      else out.push(s.name);
    }
    out.push(...classes.filter(c => classIds.includes(c.id)).map(c => c.name));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesList, seriesIds, classIds, classes, classesBySeason, seriesSeasons]);

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
              const divisions = classesForSeries(s.id);
              return (
                <div key={s.id}>
                  <label className="check-row" style={{ margin: 0 }}>
                    <input type="checkbox" id={`${idPrefix}_series_${s.id}`} checked={on}
                      onChange={() => toggleSeries(s.id)} />
                    <span>{s.name}</span>
                  </label>
                  {on && (
                    <>
                      <select
                        aria-label={`Season whose roster ${s.name} builds`}
                        style={{ marginTop: 4, marginLeft: 28, maxWidth: 260 }}
                        value={seriesSeasons[s.id] || ""}
                        onChange={e => setSeriesSeason(s.id, e.target.value)}>
                        <option value="">
                          {seasons.length ? "Pick the season to build…" : "No seasons in this series yet"}
                        </option>
                        {seasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
                      </select>
                      {divisions.length > 0 && (
                        <div style={{ marginLeft: 28, marginTop: 4 }}>
                          <span style={{ display: "block", fontSize: "0.74rem", color: "var(--ink-2)" }}>
                            …and into these divisions inside it (leave all unticked to place into the
                            series itself)
                          </span>
                          {divisions.map(c => (
                            <label key={c.id} className="check-row" style={{ margin: 0 }}>
                              <input type="checkbox" id={`${idPrefix}_sc_${c.id}`} checked={classIds.includes(c.id)}
                                onChange={() => toggleClass(c.id, s.id)} />
                              <span>{c.car ? `${c.name} · ${c.car}` : c.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          For leagues whose divisions are <strong>separate series</strong>. Each one builds the roster
          of the season named beneath it — the newest by default. Fastest drivers fill the first
          series listed when you auto-place the field.
        </span>
      </div>

      <div className="field">
        <span className="field-label">
          Place into these divisions{seasonName ? ` in ${seasonName}` : " (classes)"}
        </span>
        {!seasonId ? (
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            This session isn&rsquo;t attached to a season, so it has no classes of its own to place
            into. Series placement above works without one — pick a series and its divisions appear
            underneath it.
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
          driver into a series <em>and</em> a division within it.
        </span>
      </div>

      <div className="bonus-panel">
        <div className="bonus-panel-title">These drivers are going to</div>
        {chosen.length ? (
          <div className="bonus-panel-row">
            {chosen.map((label, i) => <span key={`${label}-${i}`} className="bonus-chip">{label}</span>)}
          </div>
        ) : (
          <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
            Nowhere yet — tick a series or a division above and it becomes a column on the board.
          </p>
        )}
      </div>
    </>
  );
}
