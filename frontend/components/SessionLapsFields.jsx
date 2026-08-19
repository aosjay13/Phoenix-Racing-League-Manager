"use client";

import { LENGTH_LAPS, raceLengthType } from "@/lib/raceLength";

// Heat / Consolation distance — the two OPTIONAL lap counts a heat weekend can
// carry alongside its Feature distance. Rendered on all three race forms (New
// Race, League Setup → Races, and the event's own Race Info tab), directly under
// the heats and consolations they describe.
//
// What they're for: a heat weekend runs eight-lap heats into a fifteen-lap
// B-Main into a fifty-lap Feature off ONE event doc. Race Length above is the
// Feature's, so entering a heat's results used to auto-count every driver off
// the Feature's fifty. Naming the heat distance here is what lets the Heats tab
// count off eight instead.
//
// What they are NOT: a second public race length. Nothing outside the results
// grid reads them — the Schedule, the Calendar and the event's Race Info card
// all keep printing the Feature distance and nothing else — which is why they
// sit here rather than inside RaceLengthField, whose figure IS the public one.
//
// Only shown for a lap-measured event: a race run to the clock or in rounds has
// no scheduled distance for any of its sessions to count off.
export function SessionLapsFields({ value, onPatch, disabled = false, idPrefix = "race" }) {
  if (raceLengthType(value) !== LENGTH_LAPS) return null;

  const rows = [
    ["heat_laps", "Heat laps (optional)", "e.g. 8",
      "How many laps each Heat of this event runs."],
    ["consolation_laps", "Consolation laps (optional)", "e.g. 15",
      "How many laps each Consolation (B-Main, C-Main…) runs."],
  ];

  return (
    <>
      {rows.map(([field, label, placeholder, hint]) => (
        <div className="field" key={field}>
          <label htmlFor={`${idPrefix}_${field}`}>{label}</label>
          <input id={`${idPrefix}_${field}`} type="number" min="0" step="1" disabled={disabled}
            value={value[field] ?? ""} placeholder={placeholder}
            onChange={e => onPatch({ [field]: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{hint}</span>
        </div>
      ))}
      <p style={{ fontSize: "0.78rem", color: "var(--ink-2)", margin: "-2px 0 10px" }}>
        Used for <strong>results entry only</strong> — the Heats and Consolation tabs auto-count laps
        completed off the figure named here instead of off the Feature distance. The Schedule, the
        Calendar and this event&rsquo;s Race Info card keep showing the <strong>Feature</strong> lap
        count and nothing else. Leave either blank and that session counts off the Feature distance,
        exactly as before.
      </p>
    </>
  );
}
