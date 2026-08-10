"use client";

import { useState } from "react";
import { ImageUpload } from "@/components/ImageUpload";
import { PointsFields } from "@/components/PointsFields";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { scoresNoPoints } from "@/lib/seasonForm";
import { BANGER_MODES, bangerEntryScope } from "@/lib/bangerRacing";
import { resolveSignupRules } from "@/lib/carSelection";

// Every season field, in one place. Rendered identically by League Setup's
// Seasons panel and by the Schedule page's "+ New Season" dialog, so the two
// can never offer different options — which is the whole point of it being a
// component rather than JSX copied into each screen.
//
// It renders only the fields; the surrounding <form>, submit button and save
// call belong to the caller, which knows whether it's creating or editing.
// State lives in the caller too (`value` / `onChange`) so the caller can seed
// it from an existing season — see lib/seasonForm.js for the shape.
// `banger` — the series this season belongs to is a Demo Derby / Banger Racing
// series — adds the derby bonus values (points per takedown, survival, most
// lethal) to the Points & Bonuses block. See lib/bangerRacing.js.
// `gameDoc` / `seriesDoc` are the game and series this season belongs to, read
// only to show what the season already inherits from them — the sign-up
// requirements in force above it (see lib/carSelection.js).
export function SeasonForm({
  value, onChange, templates = [], onTemplatesChanged,
  disabled = false, defaultPointsOpen = false, onError, banger = false, classesAreBanger = false,
  seriesDoc = null, gameDoc = null,
}) {
  // `banger` here means the SERIES runs derby, which already covers every
  // season in it; the season's own switch below is for a derby season inside an
  // ordinary series. Either one opens the derby bonus values.
  const seriesBanger = banger;
  // Which derby bonus values to offer below: the season's own answer wins, so a
  // season set to "No" doesn't carry derby rates it will never pay.
  const bangerOn = bangerEntryScope({
    series: seriesBanger ? { isBangerRacing: true } : null,
    season: { isBangerRacing: !!value.isBangerRacing, banger_mode: value.banger_mode },
    classes: classesAreBanger ? [{ isBangerRacing: true }] : [],
  });
  const [showPoints, setShowPoints] = useState(defaultPointsOpen);

  const set = patch => onChange(f => ({ ...f, ...patch }));
  const field = name => e => set({ [name]: e.target.value });
  const check = name => e => set({ [name]: e.target.checked });

  // Blank race points are legal but almost always a slip, so say so up front
  // rather than letting a season quietly score nothing all year.
  const noPoints = scoresNoPoints(value);

  return (
    <>
      <div className="field"><label>Season Name</label>
        <input required disabled={disabled} value={value.name} onChange={field("name")} placeholder="Season 3" /></div>

      <div className="field"><label>Drop Weeks (worst results ignored)</label>
        <input type="number" min="0" disabled={disabled} value={value.drop_weeks} onChange={field("drop_weeks")} /></div>

      <div className="field"><label>Car Type</label>
        <input disabled={disabled} value={value.car} onChange={field("car")} placeholder="e.g. NASCAR Next Gen, GT3" />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          The car this season races. Classes and individual races both default to this — override it
          per class, or per race.
        </span></div>

      <ImageUpload label="Season Logo" kind="season-logo" value={value.logo_url} onUploaded={url => set({ logo_url: url })} />

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_combined_championship" disabled={disabled}
          checked={value.combined_championship} onChange={check("combined_championship")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_combined_championship" style={{ margin: 0 }}>
          Enable Overall Championship
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            For a season split into classes: also crown ONE overall champion across the whole
            field, on top of each class&rsquo;s own championship — three classes with this on
            crowns four champions, and all four are tracked as titles. Turn it off for class-only
            championships — the combined &ldquo;All Classes&rdquo; table stays viewable, just
            flagged as unofficial. No effect on a season without classes.
          </span>
        </label>
      </div>

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_per_class_schedules" disabled={disabled}
          checked={value.per_class_schedules} onChange={check("per_class_schedules")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_per_class_schedules" style={{ margin: 0 }}>
          Per-Class Schedules
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): every class runs the same season schedule. On: each race can be
            pinned to one class, so classes can run their own calendars — races left on
            &ldquo;All Classes&rdquo; stay shared, so you can mix a common opener with
            class-specific rounds. Turning it off later doesn&rsquo;t delete anything; pinned
            races simply go back to showing for everyone.
          </span>
        </label>
      </div>

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_per_class_results" disabled={disabled}
          checked={value.per_class_results} onChange={check("per_class_results")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_per_class_results" style={{ margin: 0 }}>
          Separate Results by Class
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): all classes at an event share one results grid, with a Class column
            per row — one outright winner. On: even when every class races the same round, each
            class gets its <strong>own</strong> Qualifying and Race, with its own pole, its own
            P1 and its own field. This is the default for new events; any single event can be
            flipped either way on its Race Info tab. With no single outright order, the overall
            championship above just adds the classes&rsquo; points together — turn it off for a
            pure class-championship season.
          </span>
        </label>
      </div>

      {/* Demo Derby / Banger Racing for this season — three answers, not two.
          "Follow the classes" is the old behaviour; "No" is what a racing season
          that happens to run ONE derby class needs, so the derby stops bleeding
          into the season's own standings and results grids. */}
      <div className="field">
        <label htmlFor="season_banger_mode">Demo Derby / Banger Racing</label>
        <select id="season_banger_mode" disabled={disabled} value={value.banger_mode || ""}
          onChange={e => set({ banger_mode: e.target.value, isBangerRacing: e.target.value === "on" })}>
          {BANGER_MODES.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          {value.banger_mode === "on" ? (
            <>This season&rsquo;s standings and stats carry Takedowns, Survival and Most Lethal, and every
              event in it records them.</>
          ) : (
            <><strong>{value.name || "This season"} is a racing season</strong>
              {seriesBanger && " — but its series is labelled Demo Derby / Banger Racing, which covers every season in it"}.
              A class labelled as a derby is still a derby: it keeps its own derby stats, rates and
              championship, and its results can still be entered here. The season&rsquo;s own standings
              stay clean.</>
          )}
        </span>
      </div>

      {/* Car selection / lock-in for this season — the same block the Series
          and Classes panels render, so all three levels offer one setting. */}
      <CarSelectionFields value={value} onChange={onChange} level="season" disabled={disabled}
        inherited={resolveSignupRules({ game: gameDoc, series: seriesDoc })} />

      <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setShowPoints(v => !v)}>
        {showPoints ? "▾" : "▸"} Points &amp; Bonuses
      </button>
      {!showPoints && noPoints && (
        <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
          ⚠ No race points set — every finish would score 0. Open Points &amp; Bonuses and load a template.
        </p>
      )}

      {showPoints && (
        <PointsFields value={value} onPatch={set} templates={templates} onTemplatesChanged={onTemplatesChanged}
          disabled={disabled} onError={onError} noPoints={noPoints} banger={bangerOn} />
      )}
    </>
  );
}
