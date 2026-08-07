// One definition of a series' editable shape, mirroring lib/seasonForm.js and
// lib/classForm.js for the levels below it.
//
// A series carries the league's DEFAULT points structure — the top of the
// chain, which every season in it inherits and can override:
//
//     series (default) → season → class → the session's template
//
// Blank scales here mean "not set", NOT "score 0": a series that defines
// nothing leaves its seasons scoring exactly as they did before series points
// existed (see resolveSeasonConfig). That's the opposite of a season's blank
// scale, which does save as an explicit zero — a season has nothing above it to
// fall through to unless its series defines something.

import { ALL_BONUS_TYPES } from "@/lib/standings";
import { listToTable, tableToList } from "@/lib/pointsTemplates";
import { BLANK_CAR_SELECTION_FORM, carSelectionFormToBody, carSelectionToForm } from "@/lib/carSelection";

export const BLANK_SERIES_FORM = {
  name: "",
  logo_url: "",
  isBangerRacing: false,
  // Bracket Style Racing for every season and class in this series — see
  // lib/bracketRacing.js.
  isBracketRacing: false,
  // Car selection / lock-in for every season and class in this series — see
  // lib/carSelection.js.
  ...BLANK_CAR_SELECTION_FORM,
  race_points: "",
  qual_points: "",
  bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, "0"])),
};

// A saved series doc → form state.
export function seriesToForm(series = {}) {
  let bonusSrc = series.bonus_points || {};
  if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
  return {
    name: series.name || "",
    logo_url: series.logo_url || "",
    isBangerRacing: !!series.isBangerRacing,
    isBracketRacing: !!series.isBracketRacing,
    ...carSelectionToForm(series),
    race_points: tableToList(series.race_points),
    qual_points: tableToList(series.qual_points),
    bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
  };
}

// Form state → the POST/PATCH body. Nulls (not omissions) for blank scales, so
// clearing one actually clears it rather than leaving the old table in place.
export function seriesFormToBody(form) {
  const { bonuses, ...rest } = form;
  return {
    ...rest,
    // The car list is stored as an array of names, not the textarea's raw text.
    ...carSelectionFormToBody(form),
    race_points: listToTable(form.race_points),
    qual_points: listToTable(form.qual_points),
    // All zeros is "no bonuses set" — stored as null rather than a map of
    // zeros, so an untouched series doesn't read as one that defines points
    // (see definesPoints).
    bonus_points: Object.values(bonuses).some(v => Number(v || 0) !== 0)
      ? Object.fromEntries(Object.entries(bonuses).map(([k, v]) => [k, Number(v || 0)]))
      : null,
  };
}
