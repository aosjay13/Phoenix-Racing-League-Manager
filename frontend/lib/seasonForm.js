// One definition of a season's editable shape, shared by every screen that
// creates or edits one — the League Setup panel and the Schedule page's
// "+ New Season" dialog today. Keeping the field list, the defaults and the
// serialization here (rather than inline in each screen) is what stops the two
// drifting: a season made from the Schedule is byte-for-byte a season made from
// League Setup.
//
// Form state is all strings/booleans, because it comes straight from inputs;
// seasonFormToBody does the parsing into the shapes the API stores.

import { ALL_BONUS_TYPES } from "@/lib/standings";
import { listToTableOrZero, tableToList } from "@/lib/pointsTemplates";

export const BLANK_BONUSES = Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, "0"]));

// A brand-new season. Points start blank, which saves as an explicit zero scale
// — see seasonFormToBody. New seasons track a combined (overall) championship;
// schedules and results start shared across every class until an admin opts in.
export const BLANK_SEASON_FORM = {
  name: "",
  drop_weeks: "0",
  logo_url: "",
  car: "",
  race_points: "",
  qual_points: "",
  combined_championship: true,
  per_class_schedules: false,
  per_class_results: false,
  // Demo Derby / Banger Racing for this season: "" follows its classes, "on" is
  // the whole season, "off" keeps it a racing season even when a class is a
  // derby. `isBangerRacing` mirrors "on" for everything that reads the flag
  // directly. See lib/bangerRacing.js.
  isBangerRacing: false,
  banger_mode: "",
  bonuses: { ...BLANK_BONUSES },
};

// A saved season doc → form state. `bonus_points` may be an object or a JSON
// string depending on when it was written, and `points_scale` is the legacy name
// for `race_points`.
export function seasonToForm(season = {}) {
  let bonusSrc = season.bonus_points || {};
  if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
  return {
    name: season.name || "",
    drop_weeks: String(season.drop_weeks ?? 0),
    logo_url: season.logo_url || "",
    car: season.car || "",
    race_points: tableToList(season.race_points ?? season.points_scale),
    qual_points: tableToList(season.qual_points),
    combined_championship: season.combined_championship !== false,
    per_class_schedules: !!season.per_class_schedules,
    per_class_results: !!season.per_class_results,
    isBangerRacing: !!season.isBangerRacing,
    banger_mode: season.banger_mode || (season.isBangerRacing ? "on" : ""),
    bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
  };
}

// Form state → the POST/PATCH body. Blank points save as an explicit 0 scale
// rather than being left unset: an unset scale falls through to the app's
// built-in default, so "I left it blank" would silently score 350/320/300…
// instead of nothing. Storing the zero makes blank mean exactly blank.
export function seasonFormToBody(form) {
  const { bonuses, ...rest } = form;
  return {
    ...rest,
    // The mode and the boolean are two views of one setting, kept in step so
    // anything reading either gets the same answer.
    banger_mode: form.banger_mode || "",
    isBangerRacing: form.banger_mode === "on",
    race_points: listToTableOrZero(form.race_points),
    qual_points: listToTableOrZero(form.qual_points),
    bonus_points: Object.fromEntries(Object.entries(bonuses).map(([k, v]) => [k, Number(v || 0)])),
  };
}

// The points half of the form on its own, for "save this scale as a template".
export function pointsFormToTemplate(form, name) {
  return {
    name,
    race_points: listToTableOrZero(form.race_points),
    qual_points: listToTableOrZero(form.qual_points),
    bonus_points: Object.fromEntries(Object.entries(form.bonuses).map(([k, v]) => [k, Number(v || 0)])),
  };
}

// Does this form score nothing? True when the race scale is blank/all-zero,
// which is legal (a season can be run for stats alone) but is far more often a
// slip — both editors surface it as a warning rather than blocking the save.
export function scoresNoPoints(form) {
  const table = listToTableOrZero(form.race_points);
  return Object.values(table).every(v => !Number(v));
}
