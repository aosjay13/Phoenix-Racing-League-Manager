import { isQualifying } from "@/lib/standings";
import { classIdSet, classOfResult } from "@/lib/classFilter";
import { formatMinutes, formatRounds, isRoundsRace, isTimedRace, raceLengthType, scheduledLaps, scheduledMinutes, scheduledRounds } from "@/lib/raceLength";

// Which single session decides "the winner" of an event: the Feature for
// heat-format weekends, otherwise the last standard session in the event.
// Mirrors the session-naming rules the results pipeline uses.
export function finalSessionName(race) {
  if (race.heat_format) return race.feature_name || "A-Main Feature";
  const s = Array.isArray(race.sessions) && race.sessions.length ? race.sessions : ["Race"];
  return s[s.length - 1];
}

// Results grouped by the race they belong to, built once.
//
// Every caller below used to hand summarizeRace the WHOLE league's results and
// let it filter down to one race — which is a full scan per race, so a schedule
// feed cost races x results and got measurably worse every season the league
// raced (see scripts/cpu-profile). Grouping once up front turns that product
// back into a single pass, and callers hand each race its own results.
//
// A Map rather than an object: race ids come from Firestore and an object would
// have to hash every one of them into a string key it then never uses again.
export function indexResultsByRace(results) {
  const byRace = new Map();
  for (const r of results) {
    const list = byRace.get(r.race_id);
    if (list) list.push(r);
    else byRace.set(r.race_id, [r]);
  }
  return byRace;
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
// `results` is either every result to consider — filtered to this race here —
// or an index from indexResultsByRace, which is the same thing done once for
// every race instead of once per race. Prefer the index in anything that
// summarizes more than a single event.
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
// flagged GWC because there was no scheduled distance to run past. An event run
// in rounds ("rounds") reads "6 Rounds" the same way, for the same reason.
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
  // Already grouped, or grouped on the spot for a one-off caller.
  const forRace = results instanceof Map
    ? (results.get(race.id) ?? [])
    : results.filter(r => r.race_id === race.id);
  // Unscoped is the common case, and it has nothing to narrow — skip the pass
  // rather than copy the array to answer "true" for every row in it.
  const raceResults = classes ? forRace.filter(inClass) : forRace;
  // Provisional entries (drivers who didn't race) never count as part of the
  // field or as the winner — they only carry points.
  const finalResults = raceResults.filter(r => !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName);

  const winnerRes = finalResults.find(r => Number(r.finish_pos) === 1);
  const poleRes = raceResults.find(r => isQualifying(r) && Number(r.finish_pos) === 1);

  const winnerLaps = winnerRes && Number(winnerRes.laps) > 0 ? Number(winnerRes.laps) : null;
  const schedLaps = scheduledLaps(race);
  const timed = isTimedRace(race);
  const rounds = isRoundsRace(race);
  const schedMinutes = scheduledMinutes(race);
  const schedRounds = scheduledRounds(race);
  const laps = winnerLaps ?? schedLaps;

  return {
    // Race-level car wins; blank inherits whatever the caller resolved as the
    // default for this scope (the class's car, else the season's).
    car: (race.car && String(race.car).trim()) || (defaultCar && String(defaultCar).trim()) || null,
    laps,
    scheduled_laps: schedLaps,
    // A timed race has no scheduled lap count to run past, so it can't be
    // "extended" — GWC only ever applies to a race scheduled for a distance.
    laps_extended: !timed && !rounds && winnerLaps != null && schedLaps != null && winnerLaps > schedLaps,
    // How this event's distance is measured, and the text to print for it: a
    // timed race is billed by its clock ("45 Min") and a rounds race by its
    // round count ("6 Rounds"), each with the winner's lap count as the
    // secondary figure; a lap race by its distance ("100 Laps").
    length_type: raceLengthType(race),
    scheduled_minutes: schedMinutes,
    scheduled_rounds: schedRounds,
    length_label: timed
      ? (formatMinutes(schedMinutes) ?? (laps ? `${laps} Laps` : null))
      : rounds
        ? (formatRounds(schedRounds) ?? (laps ? `${laps} Laps` : null))
        : (laps ? `${laps} Laps` : null),
    num_drivers: new Set(finalResults.map(r => r.entry_id)).size,
    winner: personFromEntry(winnerRes && entriesById[winnerRes.entry_id]),
    pole: personFromEntry(poleRes && entriesById[poleRes.entry_id]),
    has_results: raceResults.length > 0,
  };
}
