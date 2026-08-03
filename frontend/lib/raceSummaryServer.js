import { isQualifying } from "@/lib/standings";
import { classIdSet, classOfResult } from "@/lib/classFilter";
import { formatMinutes, isTimedRace, raceLengthType, scheduledLaps, scheduledMinutes } from "@/lib/raceLength";

// Which single session decides "the winner" of an event: the Feature for
// heat-format weekends, otherwise the last standard session in the event.
// Mirrors the session-naming rules the results pipeline uses.
export function finalSessionName(race) {
  if (race.heat_format) return race.feature_name || "A-Main Feature";
  const s = Array.isArray(race.sessions) && race.sessions.length ? race.sessions : ["Race"];
  return s[s.length - 1];
}

function personFromEntry(entry) {
  if (!entry) return null;
  return {
    name: entry.name || "Unknown",
    driver_id: entry.driver_id ?? null,
    user_id: entry.user_id ?? null,
    car_number: entry.number ?? entry.car_number ?? null,
  };
}

// Distils one race into the SimRacerHub-style summary row: pole sitter (P1 of
// its Qualifying session), winner (P1 of its deciding session), the field size
// (distinct entries in that deciding session) and the race distance.
// `results` may span many races — it's filtered to this one here.
//
// The lap count auto-tracks what the winner actually ran, not the scheduled
// total_laps: the winner is a lead-lap finisher, so their laps completed is the
// event's true distance — capturing green-white-checkered finishes that push
// the race past its scheduled length. Falls back to the scheduled total (then
// null) when the winner has no laps recorded.
//
// A timed event (length_type "time") is billed by its clock instead: `laps`
// still carries what the winner ran, but `length_label` — the text every
// calendar prints in its Length column — reads "45 Min", and nothing is ever
// flagged GWC because there was no scheduled distance to run past.
//
// `classSelection` narrows the whole summary to one class: on an event whose
// sessions are split by class, the Pro row of the schedule shows Pro's pole,
// Pro's winner and Pro's field size, not the outright ones. It's a class id, or
// (above one season) every id that class resolves to — see classIdSet. Left
// blank the summary covers the combined field, exactly as before.
//
// `defaultCar` is the car to fall back on when the event doesn't override it —
// the class's car when the summary is scoped to a class, else the season's.
// Resolution order lives in carForRace (lib/classFilter.js); callers pass the
// already-resolved fallback so this stays a pure roll-up.
export function summarizeRace(race, results, entriesById, defaultCar = null, classSelection = "") {
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const finalName = finalSessionName(race);
  const classes = classIdSet(classSelection);
  const inClass = r => !classes || classes.has(classOfResult(r, entriesById));
  const raceResults = results.filter(r => r.race_id === race.id && inClass(r));
  // Provisional entries (drivers who didn't race) never count as part of the
  // field or as the winner — they only carry points.
  const finalResults = raceResults.filter(r => !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName);

  const winnerRes = finalResults.find(r => Number(r.finish_pos) === 1);
  const poleRes = raceResults.find(r => isQualifying(r) && Number(r.finish_pos) === 1);

  const winnerLaps = winnerRes && Number(winnerRes.laps) > 0 ? Number(winnerRes.laps) : null;
  const schedLaps = scheduledLaps(race);
  const timed = isTimedRace(race);
  const schedMinutes = scheduledMinutes(race);
  const laps = winnerLaps ?? schedLaps;

  return {
    // Race-level car wins; blank inherits whatever the caller resolved as the
    // default for this scope (the class's car, else the season's).
    car: (race.car && String(race.car).trim()) || (defaultCar && String(defaultCar).trim()) || null,
    laps,
    scheduled_laps: schedLaps,
    // A timed race has no scheduled lap count to run past, so it can't be
    // "extended" — GWC only ever applies to a race scheduled for a distance.
    laps_extended: !timed && winnerLaps != null && schedLaps != null && winnerLaps > schedLaps,
    // How this event's distance is measured, and the text to print for it: a
    // timed race is billed by its clock ("45 Min") with the winner's lap count
    // as the secondary figure, a lap race by its distance ("100 Laps").
    length_type: raceLengthType(race),
    scheduled_minutes: schedMinutes,
    length_label: timed
      ? (formatMinutes(schedMinutes) ?? (laps ? `${laps} Laps` : null))
      : (laps ? `${laps} Laps` : null),
    num_drivers: new Set(finalResults.map(r => r.entry_id)).size,
    winner: personFromEntry(winnerRes && entriesById[winnerRes.entry_id]),
    pole: personFromEntry(poleRes && entriesById[poleRes.entry_id]),
    has_results: raceResults.length > 0,
  };
}
