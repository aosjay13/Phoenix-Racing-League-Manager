"use client";

import { LENGTH_LAPS, LENGTH_ROUNDS, LENGTH_TIME } from "@/lib/raceLength";

// Race distance, entered one of three ways: a lap count for a race that runs a
// set distance, a duration for a race run to the clock, or a round count for an
// event run off in rounds (derby heats, an elimination ladder). The toggle
// picks which figure the event carries; only that figure's input is on screen,
// so an event can never claim to be both 100 laps and 45 minutes.
//
// Controlled: the parent owns `length_type`, `total_laps`, `race_minutes` and
// `total_rounds`, and gets a patch object back. `idPrefix` keeps the radio
// inputs unique when two of these end up on one page.
export function RaceLengthField({
  lengthType = LENGTH_LAPS, totalLaps = "", raceMinutes = "", totalRounds = "",
  disabled = false, idPrefix = "race_length", onChange,
}) {
  const type = [LENGTH_TIME, LENGTH_ROUNDS].includes(lengthType) ? lengthType : LENGTH_LAPS;
  const pick = t => () => { if (!disabled) onChange({ length_type: t }); };
  const tab = (t, label) => (
    <button type="button" id={`${idPrefix}_${t}`} disabled={disabled}
      className={`tab${type === t ? " active" : ""}`} role="radio" aria-checked={type === t}
      onClick={pick(t)}>{label}</button>
  );

  return (
    <div className="field">
      <label>Race Length</label>
      <div className="tab-row" style={{ marginTop: 0 }} role="radiogroup" aria-label="Race length format">
        {tab(LENGTH_LAPS, "Laps")}
        {tab(LENGTH_TIME, "Time")}
        {tab(LENGTH_ROUNDS, "Rounds")}
      </div>
      {type === LENGTH_TIME && (
        <>
          <input type="number" min="0" step="1" disabled={disabled} value={raceMinutes} placeholder="e.g. 45"
            aria-label="Race duration in minutes"
            onChange={e => onChange({ race_minutes: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Length in <strong>minutes</strong> — the race runs to the clock, so laps completed are
            entered per driver on the results grid rather than counted down from a scheduled total.
          </span>
        </>
      )}
      {type === LENGTH_ROUNDS && (
        <>
          <input type="number" min="0" step="1" disabled={disabled} value={totalRounds} placeholder="e.g. 6"
            aria-label="Total rounds"
            onChange={e => onChange({ total_rounds: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Number of <strong>rounds</strong> the event is run off in — derby heats, or the rounds of an
            elimination ladder. There&rsquo;s no scheduled lap distance, so laps completed are entered per
            driver on the results grid rather than counted down from a total.
          </span>
        </>
      )}
      {type === LENGTH_LAPS && (
        <>
          <input type="number" min="0" step="1" disabled={disabled} value={totalLaps} placeholder="e.g. 100"
            aria-label="Total race laps"
            onChange={e => onChange({ total_laps: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Total race <strong>laps</strong> — used to auto-count laps completed: lead-lap finishers get
            the full total, laps-down (e.g. 2L) and DNFs subtract from it.
          </span>
        </>
      )}
    </div>
  );
}
