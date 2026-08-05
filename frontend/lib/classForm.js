// One definition of a class's editable shape, mirroring lib/seasonForm.js for
// the season above it — including the class's OWN points structure.
//
// A class scores on the season's points unless an admin turns its own
// structure on; the whole per-class-points feature hangs off `own_points`
// below. Off, the three points fields are written back as null so the class
// falls straight through to the season (see classScoresOwnPoints in
// lib/standings.js). On, they're saved exactly like a season's — a blank scale
// saves as an explicit zero rather than silently inheriting.

import { BLANK_BONUSES } from "@/lib/seasonForm";
import { ALL_BONUS_TYPES, BONUS_TYPES, classScoresOwnPoints } from "@/lib/standings";
import { listToTableOrZero, tableToList } from "@/lib/pointsTemplates";
import { bangerBonusesOnly, hasBangerBonuses } from "@/lib/bangerRacing";

export const BLANK_CLASS_FORM = {
  name: "",
  color: "",
  description: "",
  car: "",
  sort_order: "",
  // Demo Derby / Banger Racing for this class alone — how a season runs a
  // Banger class next to ordinary racing classes. A flagged series or season
  // already covers every class under it; see lib/bangerRacing.js.
  isBangerRacing: false,
  own_points: false,
  race_points: "",
  qual_points: "",
  bonuses: { ...BLANK_BONUSES },
};

// A class that carries ONLY derby bonus values (see classFormToBody) does have
// a structure as far as the scoring engine is concerned — that's how its
// takedown rate reaches the results — but it is NOT the "own points structure"
// the form's checkbox means: everything else still comes from the season. Read
// back as own_points it would tick that box, and the next save would write the
// blank scale boxes as an explicit all-zeros table, dropping the class to 0
// points a finish. So the box follows a real scale or a traditional bonus only.
function hasOwnScale(cls = {}) {
  return !!tableToList(cls.race_points) || !!tableToList(cls.qual_points);
}

function hasTraditionalBonus(cls = {}) {
  let b = cls.bonus_points || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return BONUS_TYPES.some(([k]) => Number(b[k] || 0) !== 0);
}

// A saved class doc → form state.
export function classToForm(cls = {}) {
  let bonusSrc = cls.bonus_points || {};
  if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
  return {
    name: cls.name || "",
    color: cls.color || "",
    description: cls.description || "",
    car: cls.car || "",
    sort_order: cls.sort_order != null ? String(cls.sort_order) : "",
    isBangerRacing: !!cls.isBangerRacing,
    own_points: classScoresOwnPoints(cls) && (hasOwnScale(cls) || hasTraditionalBonus(cls)),
    race_points: tableToList(cls.race_points),
    qual_points: tableToList(cls.qual_points),
    bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
  };
}

// Form state → the POST/PATCH body. `fallbackSortOrder` is where a class with
// no explicit display order lands (the end of the list).
//
// `banger` — this class runs Demo Derby / Banger Racing — lets a class carry
// JUST the derby bonus values without a full points structure: paying 2 a
// takedown for the Banger class alone shouldn't force an admin to override the
// season's whole race scale as well. Everything else still falls through to the
// season, since only `bonus_points` is set (see configForClass).
export function classFormToBody(form, fallbackSortOrder = 0, { banger = false } = {}) {
  const derbyOnly = banger && !form.own_points && hasBangerBonuses(form.bonuses)
    ? bangerBonusesOnly(form.bonuses)
    : null;
  return {
    name: form.name,
    color: form.color,
    description: form.description,
    car: form.car,
    sort_order: form.sort_order === "" ? fallbackSortOrder : Number(form.sort_order),
    isBangerRacing: !!form.isBangerRacing,
    // Nulls (not omissions) so turning the override back off actually clears a
    // structure the class used to have, rather than leaving it in place.
    ...(form.own_points
      ? {
        race_points: listToTableOrZero(form.race_points),
        qual_points: listToTableOrZero(form.qual_points),
        bonus_points: Object.fromEntries(Object.entries(form.bonuses).map(([k, v]) => [k, Number(v || 0)])),
      }
      : { race_points: null, qual_points: null, bonus_points: derbyOnly }),
  };
}

// The points half of a season's structure, as class form fields — what a class
// is seeded with the moment its own structure is switched on, so "override the
// season" starts from the season rather than from blank (which would score 0).
export function seasonPointsAsClassFields(season = {}) {
  let bonusSrc = season.bonus_points || {};
  if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
  return {
    race_points: tableToList(season.race_points ?? season.points_scale),
    qual_points: tableToList(season.qual_points),
    bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
  };
}
