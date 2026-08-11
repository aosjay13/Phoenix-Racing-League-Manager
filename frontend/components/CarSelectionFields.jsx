"use client";

import { INHERIT, LEVEL_LABELS, OFF, ON, parseCarOptions } from "@/lib/carSelection";

// The sign-up requirement settings block, rendered identically by League Setup's
// Games, Series, Seasons and Classes panels — one component so the four levels
// can never drift apart, the same way <SeasonForm> and <PointsFields> are
// shared. Form state lives in the caller (see lib/carSelection.js for its shape
// and serialization).
//
// `level` is "game" | "series" | "season" | "class", used for the wording and
// for unique input ids. `inherited` is what the levels ABOVE this one resolve
// to, so every switch can show what leaving it on **Inherit** actually means
// right now — and so an admin can see, before they change anything, whether
// they're overriding something.
//
// Each switch is a three-way choice, not a checkbox, because "I never touched
// this" and "I want this OFF here" are different answers:
//
//   Inherit (default) → whatever the game/series/season above says
//   Required          → required here, whatever the level above says
//   Not required      → NOT required here, even if the level above requires it
//
// That's what makes "a class overrides its season, a season overrides its
// series, a series overrides its game" true rather than aspirational.
const COVERS = {
  game: "every series, season and class in this game",
  series: "every season and class in this series",
  season: "every class in this season",
  class: "this class",
};

const ABOVE = {
  game: "the league default",
  series: "the game",
  season: "the series",
  class: "the season",
};

// One three-way switch, with a line saying what Inherit resolves to today.
function RequirementSelect({ id, label, value, onChange, disabled, help, inheritedOn, inheritedFrom }) {
  const inheritLabel = inheritedOn
    ? `Inherit — required by the ${LEVEL_LABELS[inheritedFrom] || "level above"}`
    : "Inherit — not required";
  return (
    <div className="field requirement-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value || INHERIT} disabled={disabled}
        onChange={e => onChange(e.target.value)}>
        <option value={INHERIT}>{inheritLabel}</option>
        <option value={ON}>Required</option>
        <option value={OFF}>Not required{inheritedOn ? " — overrides the level above" : ""}</option>
      </select>
      <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{help}</span>
    </div>
  );
}

// `inherited` is a resolveSignupRules() result for the levels ABOVE this one.
// Flattened here so the component reads one shape whichever caller built it.
function inheritedState(inherited) {
  return {
    car: { on: !!inherited?.require_car, from: inherited?.require_car_from },
    number: { on: !!inherited?.require_number, from: inherited?.require_number_from },
    locked: { on: !!inherited?.locked, from: inherited?.car?.locked_from },
    options: inherited?.car_options ?? [],
    options_from: inherited?.car?.options_from,
  };
}

export function CarSelectionFields({ value, onChange, level = "season", disabled = false, inherited = null }) {
  const set = patch => onChange(f => ({ ...f, ...patch }));
  const id = suffix => `${level}_car_${suffix}`;
  const parsed = parseCarOptions(value.car_options);
  const from = inheritedState(inherited);
  const inheritedOptions = from.options;
  const covers = COVERS[level];
  const above = ABOVE[level];

  return (
    <div className="car-lockin-block">
      <p className="requirement-intro">
        What a sign-up for {covers} has to carry. Each setting follows{" "}
        <strong>{above}</strong> unless you change it here — the most specific level always wins,
        so <em>game → series → season → class</em>.
      </p>

      <RequirementSelect
        id={id("require")} label="Require Car Selection / Lock-in"
        value={value.require_car_selection_mode} disabled={disabled}
        onChange={v => set({ require_car_selection_mode: v })}
        inheritedOn={from.car.on} inheritedFrom={from.car.from}
        help={<>
          Required: every driver on the roster of {covers} locks in the car they&rsquo;ll race,
          chosen from the list below, from the <strong>Series Information</strong> section of their
          Dashboard. Their pick is saved onto their roster entry and everyone in the series can see
          who has chosen what.
        </>}
      />

      <div className="field">
        <label htmlFor={id("options")}>Car Selection — one per line</label>
        <textarea id={id("options")} rows={5} disabled={disabled} value={value.car_options}
          onChange={e => set({ car_options: e.target.value })}
          placeholder={"Porsche 911 GT3 R\nFerrari 296 GT3\nBMW M4 GT3"} />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          The cars a driver may choose from — whatever you type here becomes one radio button each
          on the sign-up form, and whichever they pick is shown on the roster. One per line (a
          single comma-separated line works too), so a name with spaces in it stays one
          car. {parsed.length > 0
            ? <>{parsed.length} car{parsed.length === 1 ? "" : "s"} offered: {parsed.join(" · ")}.</>
            : <>Leave blank to use{" "}
                {inheritedOptions.length
                  ? <>the {LEVEL_LABELS[from.options_from] || "inherited"} list ({inheritedOptions.join(" · ")}).</>
                  : <>the list from the level above — with none set anywhere, drivers have nothing to pick from.</>}
              </>}
          {" "}The most specific list wins, so a class can run its own machinery while the rest of
          the season picks from the series&rsquo; list.
          {" "}This is the only car list there is: a spec series that only asks which make somebody
          runs types <em>Chevrolet / Ford / Toyota</em> in here.
        </span>
      </div>

      {/* The other thing a sign-up can be made to carry. Independent of the
          lock-in above: a league can demand numbers without caring what anyone
          drives. */}
      <RequirementSelect
        id={id("require_number")} label="Require Car Number Selection"
        value={value.require_car_number_mode} disabled={disabled}
        onChange={v => set({ require_car_number_mode: v })}
        inheritedOn={from.number.on} inheritedFrom={from.number.from}
        help={<>
          Required: nobody in {covers} can submit a sign-up without a car number. Numbers are
          unique per season either way — a driver can&rsquo;t take one somebody already has.
        </>}
      />

      <div className="field">
        <label htmlFor={id("note")}>Instructions for Drivers</label>
        <input id={id("note")} disabled={disabled} value={value.car_selection_note}
          onChange={e => set({ car_selection_note: e.target.value })}
          placeholder="e.g. Please lock in your car for the upcoming season by Friday." />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Shown at the top of the car-selection screen. Blank falls back to the level above.
        </span>
      </div>

      <RequirementSelect
        id={id("locked")} label="Lock the selections (no more changes)"
        value={value.car_selection_locked_mode} disabled={disabled}
        onChange={v => set({ car_selection_locked_mode: v })}
        inheritedOn={from.locked.on} inheritedFrom={from.locked.from}
        help={<>
          Required (locked): the picks already made are frozen and read-only — nobody in {covers} can
          change or make one. Nothing is deleted; set it back to reopen. Not required keeps this
          level open even while the level above is locked.
        </>}
      />
    </div>
  );
}
