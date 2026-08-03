"use client";

import { LENGTH_LAPS, LENGTH_TIME } from "@/lib/raceLength";

// Race distance, entered one of two ways: a lap count for a race that runs a
// set distance, or a duration for a race run to the clock. The toggle picks
// which figure the event carries; only that figure's input is on screen, so an
// event can never claim to be both 100 laps and 45 minutes.
//
// Controlled: the parent owns `length_type`, `total_laps` and `race_minutes`
// and gets a patch object back. `idPrefix` keeps the radio inputs unique when
// two of these end up on one page.
export function RaceLengthField({
  lengthType = LENGTH_LAPS, totalLaps = "", raceMinutes = "",
  disabled = false, idPrefix = "race_length", onChange,
}) {
  const timed = lengthType === LENGTH_TIME;
  const pick = type => () => { if (!disabled) onChange({ length_type: type }); };

  return (
    <div className="field">
      <label>Race Length</label>
      <div className="tab-row" style={{ marginTop: 0 }} role="radiogroup" aria-label="Race length format">
        <button type="button" id={`${idPrefix}_laps`} disabled={disabled}
          className={`tab${timed ? "" : " active"}`} role="radio" aria-checked={!timed}
          onClick={pick(LENGTH_LAPS)}>Laps</button>
        <button type="button" id={`${idPrefix}_time`} disabled={disabled}
          className={`tab${timed ? " active" : ""}`} role="radio" aria-checked={timed}
          onClick={pick(LENGTH_TIME)}>Time</button>
      </div>
      {timed ? (
        <>
          <input type="number" min="0" step="1" disabled={disabled} value={raceMinutes} placeholder="e.g. 45"
            aria-label="Race duration in minutes"
            onChange={e => onChange({ race_minutes: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Length in <strong>minutes</strong> — the race runs to the clock, so laps completed are
            entered per driver on the results grid rather than counted down from a scheduled total.
          </span>
        </>
      ) : (
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
