// How an event's distance is measured. Some races run a set number of laps
// ("100 Laps"), others run to the clock ("45 Minutes") and whoever leads when
// time expires wins — so a race carries a `length_type` of "laps" or "time"
// alongside the two figures it can be measured with:
//
//   length_type: "laps"  → total_laps   (the scheduled lap count)
//   length_type: "time"  → race_minutes (the scheduled duration, in minutes)
//
// `length_type` is absent on every race created before the toggle existed, so
// everything here treats a missing value as "laps" and those events keep
// reading exactly as they always did.

export const LENGTH_LAPS = "laps";
export const LENGTH_TIME = "time";

export function raceLengthType(race) {
  return race?.length_type === LENGTH_TIME ? LENGTH_TIME : LENGTH_LAPS;
}

export function isTimedRace(race) {
  return raceLengthType(race) === LENGTH_TIME;
}

// The scheduled lap count, or null when the event isn't measured in laps (or
// simply hasn't had one entered). This is what the results grid auto-counts
// laps completed from — a timed race has no scheduled total to count down from,
// so laps are entered by hand there.
export function scheduledLaps(race) {
  if (!race || isTimedRace(race)) return null;
  const n = Number(race.total_laps);
  return n > 0 ? n : null;
}

// The scheduled duration in minutes, or null when the event isn't timed.
export function scheduledMinutes(race) {
  if (!race || !isTimedRace(race)) return null;
  const n = Number(race.race_minutes);
  return n > 0 ? n : null;
}

// 45 → "45 Min", 60 → "1 Hr", 90 → "1 Hr 30 Min", 150 → "2 Hr 30 Min".
export function formatMinutes(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return null;
  const hours = Math.floor(total / 60);
  const mins = Math.round(total % 60);
  if (!hours) return `${mins} Min`;
  return mins ? `${hours} Hr ${mins} Min` : `${hours} Hr`;
}

// The distance an event is scheduled for, as text: "100 Laps" or "45 Min".
export function raceLengthLabel(race, fallback = null) {
  if (isTimedRace(race)) return formatMinutes(race?.race_minutes) ?? fallback;
  const laps = scheduledLaps(race);
  return laps ? `${laps} Laps` : fallback;
}
