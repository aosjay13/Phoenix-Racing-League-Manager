"use client";

import { RACE_STAT_FIELDS } from "@/lib/raceStats";

// Caution Flags & Lead Changes — the two OPTIONAL race statistics an event can
// carry, entered on its Race Info tab once the race has been run.
//
// They describe the race itself rather than any driver in it, which is why they
// sit here with the event's name, track and distance rather than as two more
// columns on the results grid. Nothing scores off them: they are printed at the
// top of the public results page and read nowhere else.
//
// Leave either blank and it stays off the page entirely — an event with no
// figures reads exactly as it did before these existed. A 0 is treated the same
// way as a blank on purpose: "no cautions counted" and "zero cautions" can't be
// told apart once the box is empty, so neither is printed as a counted figure.
const ROWS = {
  caution_flags: ["Caution flags (optional)", "e.g. 6",
    "How many caution flags flew during this race."],
  lead_changes: ["Lead changes (optional)", "e.g. 14",
    "How many times the race lead changed hands."],
};

export function RaceStatsFields({ value, onPatch, disabled = false, idPrefix = "race" }) {
  return (
    <>
      {RACE_STAT_FIELDS.map(field => {
        const [label, placeholder, hint] = ROWS[field];
        return (
          <div className="field" key={field}>
            <label htmlFor={`${idPrefix}_${field}`}>{label}</label>
            <input id={`${idPrefix}_${field}`} type="number" min="0" step="1" disabled={disabled}
              value={value?.[field] ?? ""} placeholder={placeholder}
              onChange={e => onPatch({ [field]: e.target.value })} />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{hint}</span>
          </div>
        );
      })}
      <p style={{ fontSize: "0.78rem", color: "var(--ink-2)", margin: "-2px 0 10px" }}>
        Race statistics, not driver ones — they appear at the <strong>top of this event&rsquo;s
        results page</strong>, beside the track and the date, and count toward nothing. Leave
        either blank (or on 0) and it is left off the page altogether.
      </p>
    </>
  );
}
