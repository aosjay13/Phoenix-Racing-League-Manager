"use client";

import { useState } from "react";
import { ImageUpload } from "@/components/ImageUpload";
import { PointsFields } from "@/components/PointsFields";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { HeatPointsDefaultFields } from "@/components/HeatPointsDefaultFields";
import { normalizedBuiltinTemplates } from "@/lib/pointsTemplates";
import { scoresNoPoints } from "@/lib/seasonForm";
import { BANGER_MODES, bangerEntryScope } from "@/lib/bangerRacing";
import { resolveSignupRules } from "@/lib/carSelection";
import { PlayoffSettingsModal } from "@/components/PlayoffSettingsModal";
import { describePlayoffFormat, normalizePlayoffConfig, playoffFormat, playoffSetupWarnings } from "@/lib/playoffs";

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
// `races` is this season's calendar, when the screen has one. The playoff menu
// reads it to say where the regular season ends and how many rounds are left
// for the playoff; without it the menu still works, it just can't check the
// format against a calendar that doesn't exist yet (a season being created).
// `seasonId` is the season being EDITED, when there is one. The playoff menu
// loads that season's roster from it, for the wildcard picker — a season being
// created has no roster to pick from, and the picker says so.
export function SeasonForm({
  value, onChange, templates = [], onTemplatesChanged,
  disabled = false, defaultPointsOpen = false, onError, banger = false, classesAreBanger = false,
  seriesDoc = null, gameDoc = null, races = [], seasonId = "",
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
  // The playoff menu is a dialog rather than another block of this column: a
  // playoff is a ladder, and a ladder needs the width (see
  // components/PlayoffSettingsModal.jsx).
  const [showPlayoffs, setShowPlayoffs] = useState(false);
  const playoffCfg = normalizePlayoffConfig(value.playoff_config);
  const playoffWarnings = value.playoffs_enabled ? playoffSetupWarnings(playoffCfg, races) : [];

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

      <div className="field check-row">
        <input type="checkbox" id="season_combined_championship" disabled={disabled}
          checked={value.combined_championship} onChange={check("combined_championship")} />
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

      {/* Playoffs. A structural answer like the overall championship above it —
          it decides HOW this season's title is settled, not what a finish pays —
          so it sits with the other championship ticks rather than down with the
          scoring. Everything it needs is behind one button, because a playoff
          format is six questions and a round ladder, and none of that belongs in
          a form column. See components/PlayoffSettingsModal.jsx. */}
      <div className="field check-row">
        <input type="checkbox" id="season_playoffs_enabled" disabled={disabled}
          checked={!!value.playoffs_enabled} onChange={check("playoffs_enabled")} />
        <label htmlFor="season_playoffs_enabled" style={{ margin: 0 }}>
          Playoffs
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): the driver leading the points at the end of the year is champion. On: the regular
            season ends at a round you pick — crowning a regular season champion, if your series does that —
            and the rounds after it are raced under their own rules: a points reset, elimination rounds, a
            Chase, or whatever your league actually voted on. Nothing about how a race scores changes; a
            playoff changes who the points decide.
          </span>
        </label>
      </div>

      {value.playoffs_enabled && (
        <div className="playoff-callout">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="playoff-chip">
              {playoffFormat(playoffCfg.format).icon} {playoffFormat(playoffCfg.format).name}
            </span>
            <span style={{ display: "block", marginTop: 4, fontSize: "0.8rem", color: "var(--ink-1)" }}>
              {describePlayoffFormat(playoffCfg)}
            </span>
            {playoffWarnings.length > 0 && (
              <span style={{ display: "block", marginTop: 4, fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
                ⚠ {playoffWarnings[0]}
                {playoffWarnings.length > 1 && ` (+${playoffWarnings.length - 1} more)`}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 0, whiteSpace: "nowrap" }}
            disabled={disabled} onClick={() => setShowPlayoffs(true)}>
            ⚙ Playoff Format…
          </button>
        </div>
      )}

      {showPlayoffs && (
        <PlayoffSettingsModal
          value={value.playoff_config}
          onChange={cfg => set({ playoff_config: cfg })}
          races={races}
          seasonId={seasonId}
          seasonName={value.name}
          disabled={disabled}
          onClose={() => setShowPlayoffs(false)}
        />
      )}

      <div className="field check-row">
        <input type="checkbox" id="season_per_class_schedules" disabled={disabled}
          checked={value.per_class_schedules} onChange={check("per_class_schedules")} />
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

      <div className="field check-row">
        <input type="checkbox" id="season_per_class_results" disabled={disabled}
          checked={value.per_class_results} onChange={check("per_class_results")} />
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

      {/* Heat racing for the whole season. It sits with the other structural
          ticks rather than below the derby dropdown, because it's the same kind
          of answer: it says what shape this season's events are. Ticking it
          doesn't build an event — each race still declares its own heats on its
          Race Info tab — it pre-ticks heat format on new races and unlocks the
          two points defaults below, so a league running heats all year sets its
          scoring once here instead of once per event. An event's own defaults,
          and a class's, override these; see lib/standings.js. */}
      <div className="field check-row">
        <input type="checkbox" id="season_heat_format" disabled={disabled}
          checked={!!value.heat_format} onChange={check("heat_format")} />
        <label htmlFor="season_heat_format" style={{ margin: 0 }}>
          Heats and Consolation Races
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            On: this season runs heat racing (Heats → Consolation → Feature). Every new race in it
            starts in heat format, and you can name the points template every heat and every
            consolation scores on — once, here, instead of once per race entry. Each event still lists
            its own heats and B-Mains on its Race Info tab, and can override either default there.
            The templates those sessions score on are set with the rest of the scoring, in
            <strong> Points &amp; Bonuses</strong> below.
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

      {/* The heat/consolation default templates ride INSIDE this block, under Race
          Points and Qualifying Points, so a heat season's whole scoring setup —
          the scales, what its heats and consolations score on, and the bonuses —
          reads as one thing instead of two. They appear only for a season ticked
          as running heats. */}
      {showPoints && (
        <PointsFields value={value} onPatch={set} templates={templates} onTemplatesChanged={onTemplatesChanged}
          disabled={disabled} onError={onError} noPoints={noPoints} banger={bangerOn}
          afterScales={value.heat_format ? (
            <HeatPointsDefaultFields idPrefix="season" value={value} onPatch={set} disabled={disabled}
              templates={[...normalizedBuiltinTemplates(), ...templates]} scopeLabel="season" />
          ) : null} />
      )}
    </>
  );
}
