"use client";

import { parseCarOptions } from "@/lib/carSelection";

// The "Require Car Selection / Lock-in" settings block, rendered identically by
// League Setup's Series, Seasons and Classes panels — one component so the
// three levels can never drift apart, the same way <SeasonForm> and
// <PointsFields> are shared. Form state lives in the caller (see
// lib/carSelection.js for its shape and serialization).
//
// `level` is "series" | "season" | "class", used only for the wording and for
// unique input ids. `inheritedFrom` names the level above that already requires
// a selection (or already publishes a car list), so an admin can see what this
// level inherits before overriding it.
const COVERS = {
  series: "every season and class in this series",
  season: "every class in this season",
  class: "this class",
};

export function CarSelectionFields({ value, onChange, level = "season", disabled = false, inherited = null }) {
  const set = patch => onChange(f => ({ ...f, ...patch }));
  const id = suffix => `${level}_car_${suffix}`;
  const parsed = parseCarOptions(value.car_options);
  // A requirement above this level is already in force here, so the switch below
  // can only add to it — say so rather than letting an admin think turning it
  // off here opts this level out.
  const inheritedRequired = !!inherited?.required;
  const inheritedOptions = inherited?.options ?? [];

  return (
    <div className="car-lockin-block">
      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id={id("require")} disabled={disabled}
          checked={!!value.require_car_selection}
          onChange={e => set({ require_car_selection: e.target.checked })}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor={id("require")} style={{ margin: 0 }}>
          Require Car Selection / Lock-in
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): nothing changes — nobody is asked to pick a car. On: every driver on
            the roster of {COVERS[level]} locks in the car they&rsquo;ll race, chosen from the list
            below, from the <strong>Series Information</strong> section of their Dashboard. Their
            pick is saved onto their roster entry and everyone in the series can see who has
            chosen what.
            {inheritedRequired && (
              <>
                {" "}<strong>Already required by the {inherited.required_from}</strong>, which covers
                this level — leave this off unless you want this level to keep asking on its own.
              </>
            )}
          </span>
        </label>
      </div>

      <div className="field">
        <label htmlFor={id("options")}>Available Cars — one per line</label>
        <textarea id={id("options")} rows={5} disabled={disabled} value={value.car_options}
          onChange={e => set({ car_options: e.target.value })}
          placeholder={"Porsche 911 GT3 R\nFerrari 296 GT3\nBMW M4 GT3"} />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          The cars a driver may choose from. One per line (a single comma-separated line works
          too). {parsed.length > 0
            ? <>{parsed.length} car{parsed.length === 1 ? "" : "s"} offered: {parsed.join(" · ")}.</>
            : <>Leave blank to use{" "}
                {inheritedOptions.length
                  ? <>the {inherited.options_from}&rsquo;s list ({inheritedOptions.join(" · ")}).</>
                  : <>the list from the level above — with none set anywhere, drivers have nothing to pick from.</>}
              </>}
          {" "}The most specific list wins, so a class can run its own machinery while the rest of
          the season picks from the series&rsquo; list.
        </span>
      </div>

      <div className="field">
        <label htmlFor={id("note")}>Instructions for Drivers</label>
        <input id={id("note")} disabled={disabled} value={value.car_selection_note}
          onChange={e => set({ car_selection_note: e.target.value })}
          placeholder="e.g. Please lock in your car for the upcoming season by Friday." />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Shown at the top of the car-selection screen. Blank falls back to the level above.
        </span>
      </div>

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id={id("locked")} disabled={disabled}
          checked={!!value.car_selection_locked}
          onChange={e => set({ car_selection_locked: e.target.checked })}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor={id("locked")} style={{ margin: 0 }}>
          Lock the selections (no more changes)
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): drivers can change their mind as often as they like, right up until you
            tick this. On: the picks already made are frozen and read-only — nobody in{" "}
            {COVERS[level]} can change or make one. Nothing is deleted; untick it to reopen.
          </span>
        </label>
      </div>
    </div>
  );
}
