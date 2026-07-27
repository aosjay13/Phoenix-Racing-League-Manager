import { isQualifying } from "@/lib/standings";
import { isClassScoped, resultInSessionClass } from "@/lib/classFilter";

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
// `classId` narrows the whole summary to one class: on an event whose sessions
// are split by class, the Pro row of the schedule shows Pro's pole, Pro's
// winner and Pro's field size, not the outright ones. Left blank the summary
// covers the combined field, exactly as before.
//
// `defaultCar` is the car to fall back on when the event doesn't override it —
// the class's car when the summary is scoped to a class, else the season's.
// Resolution order lives in carForRace (lib/classFilter.js); callers pass the
// already-resolved fallback so this stays a pure roll-up.
export function summarizeRace(race, results, entriesById, defaultCar = null, classId = "") {
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const finalName = finalSessionName(race);
  const inClass = r => !isClassScoped(classId) || resultInSessionClass(r, classId, entriesById);
  const raceResults = results.filter(r => r.race_id === race.id && inClass(r));
  // Provisional entries (drivers who didn't race) never count as part of the
  // field or as the winner — they only carry points.
  const finalResults = raceResults.filter(r => !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName);

  const winnerRes = finalResults.find(r => Number(r.finish_pos) === 1);
  const poleRes = raceResults.find(r => isQualifying(r) && Number(r.finish_pos) === 1);

  const winnerLaps = winnerRes && Number(winnerRes.laps) > 0 ? Number(winnerRes.laps) : null;
  const scheduledLaps = race.total_laps ? Number(race.total_laps) : null;

  return {
    // Race-level car wins; blank inherits whatever the caller resolved as the
    // default for this scope (the class's car, else the season's).
    car: (race.car && String(race.car).trim()) || (defaultCar && String(defaultCar).trim()) || null,
    laps: winnerLaps ?? scheduledLaps,
    scheduled_laps: scheduledLaps,
    laps_extended: winnerLaps != null && scheduledLaps != null && winnerLaps > scheduledLaps,
    num_drivers: new Set(finalResults.map(r => r.entry_id)).size,
    winner: personFromEntry(winnerRes && entriesById[winnerRes.entry_id]),
    pole: personFromEntry(poleRes && entriesById[poleRes.entry_id]),
    has_results: raceResults.length > 0,
  };
}
