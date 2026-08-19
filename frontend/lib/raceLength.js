// How an event's distance is measured. Some races run a set number of laps
// ("100 Laps"), others run to the clock ("45 Minutes") and whoever leads when
// time expires wins, and others are run off in a set number of rounds ("6
// Rounds") — heats of a demolition derby, or the rounds of an elimination
// ladder. So a race carries a `length_type` of "laps", "time" or "rounds"
// alongside the figure it is measured with:
//
//   length_type: "laps"   → total_laps    (the scheduled lap count)
//   length_type: "time"   → race_minutes  (the scheduled duration, in minutes)
//   length_type: "rounds" → total_rounds  (the scheduled number of rounds)
//
// `length_type` is absent on every race created before the toggle existed, so
// everything here treats a missing (or unrecognised) value as "laps" and those
// events keep reading exactly as they always did.

export const LENGTH_LAPS = "laps";
export const LENGTH_TIME = "time";
export const LENGTH_ROUNDS = "rounds";

const LENGTH_TYPES = [LENGTH_LAPS, LENGTH_TIME, LENGTH_ROUNDS];

export function raceLengthType(race) {
  return LENGTH_TYPES.includes(race?.length_type) ? race.length_type : LENGTH_LAPS;
}

export function isTimedRace(race) {
  return raceLengthType(race) === LENGTH_TIME;
}

// Run off in rounds rather than over a distance or against a clock.
export function isRoundsRace(race) {
  return raceLengthType(race) === LENGTH_ROUNDS;
}

// The scheduled lap count, or null when the event isn't measured in laps (or
// simply hasn't had one entered). This is what the results grid auto-counts
// laps completed from — neither a timed race nor one run in rounds has a
// scheduled total to count down from, so laps are entered by hand there.
export function scheduledLaps(race) {
  if (!race || raceLengthType(race) !== LENGTH_LAPS) return null;
  const n = Number(race.total_laps);
  return n > 0 ? n : null;
}

// The scheduled duration in minutes, or null when the event isn't timed.
export function scheduledMinutes(race) {
  if (!race || !isTimedRace(race)) return null;
  const n = Number(race.race_minutes);
  return n > 0 ? n : null;
}

// The scheduled number of rounds, or null when the event isn't run in rounds.
export function scheduledRounds(race) {
  if (!race || !isRoundsRace(race)) return null;
  const n = Number(race.total_rounds);
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

// Does a race summary of this length type print the winner's lap count as a
// separate secondary figure? True wherever the headline length isn't itself a
// lap count — a timed race ("45 Min") or one run in rounds ("6 Rounds").
export function lapsAreSecondary(lengthType) {
  return lengthType === LENGTH_TIME || lengthType === LENGTH_ROUNDS;
}

// ── Form ↔ doc ─────────────────────────────────────────────────────────────
//
// Three screens edit a race's length (League Setup, the new-race modal and the
// event's own Race Info tab), so the mapping lives here once rather than as the
// same ternaries written out three times — which is what let a new measure be
// added to one form and missed by another.

// A saved race doc → the form fields, as the strings the inputs want.
export function raceLengthForm(race = {}) {
  return {
    length_type: raceLengthType(race),
    total_laps: race.total_laps != null ? String(race.total_laps) : "",
    race_minutes: race.race_minutes ? String(race.race_minutes) : "",
    total_rounds: race.total_rounds ? String(race.total_rounds) : "",
  };
}

// Form fields → the length half of a POST/PATCH body. Only the chosen measure
// keeps its figure; the others are written back as 0, so an event switched from
// 100 laps to 45 minutes can't keep quietly claiming a scheduled distance.
export function raceLengthBody(form = {}) {
  const type = raceLengthType(form);
  const num = v => (v === "" || v == null ? 0 : Number(v));
  return {
    length_type: type,
    total_laps: type === LENGTH_LAPS ? num(form.total_laps) : 0,
    race_minutes: type === LENGTH_TIME ? num(form.race_minutes) : 0,
    total_rounds: type === LENGTH_ROUNDS ? num(form.total_rounds) : 0,
  };
}

// 1 → "1 Round", 6 → "6 Rounds".
export function formatRounds(rounds) {
  const n = Number(rounds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n} Round${n === 1 ? "" : "s"}`;
}

// The distance an event is scheduled for, as text: "100 Laps", "45 Min" or
// "6 Rounds".
export function raceLengthLabel(race, fallback = null) {
  if (isTimedRace(race)) return formatMinutes(race?.race_minutes) ?? fallback;
  if (isRoundsRace(race)) return formatRounds(race?.total_rounds) ?? fallback;
  const laps = scheduledLaps(race);
  return laps ? `${laps} Laps` : fallback;
}

// ── Preliminary sessions: Heat & Consolation lap counts ────────────────────
//
// A heat weekend runs three kinds of race off one event doc, and they are not
// the same distance: eight-lap heats feed a fifteen-lap B-Main which feeds a
// fifty-lap Feature. `total_laps` above is the FEATURE's distance — it is what
// the Schedule, the Calendar and every Race Info card print, and it stays that
// way. These two are the preliminary distances, kept alongside it purely so the
// results grid can auto-count a heat's laps off eight rather than off fifty:
//
//   heat_laps         → the scheduled distance of every Heat of this event
//   consolation_laps  → the scheduled distance of every Consolation (B-/C-Main)
//
// Both are OPTIONAL, and both are a data-entry aid and nothing else. Nothing
// public reads them: summarizeRace (the Schedule's / Calendar's roll-up) is
// built from the event's deciding session, and raceLengthLabel below only ever
// speaks for `total_laps`, so an event with heat laps set reads on every public
// screen exactly as it did before they were.
//
// Left blank, a heat counts off the feature distance exactly as it always has —
// setting one is what changes anything, so no existing event's entry behaviour
// moves under it.
const SESSION_LAP_FIELDS = {
  heat: "heat_laps",
  consolation: "consolation_laps",
};

// The lap count the results grid for `sessionType` should count down from:
// the session's own scheduled distance when the event names one, else the
// feature distance (which is what every session used before these existed).
// Null on a timed or rounds event, and on one with no distance entered at all —
// there is nothing to count off, so laps are typed in per driver.
export function sessionScheduledLaps(race, sessionType = "race") {
  const feature = scheduledLaps(race);
  const field = SESSION_LAP_FIELDS[sessionType];
  if (!field || !race || raceLengthType(race) !== LENGTH_LAPS) return feature;
  const n = Number(race[field]);
  return n > 0 ? n : feature;
}

// True when this session type has a scheduled distance of its own to set.
export function hasSessionLaps(sessionType) {
  return Object.hasOwn(SESSION_LAP_FIELDS, sessionType);
}

// A saved race doc → the two preliminary lap fields, as the strings the inputs
// want. Blank (rather than "0") for an event that has never set one, so the
// placeholder shows and the field reads as the optional aid it is.
export function sessionLapsForm(race = {}) {
  const str = v => (Number(v) > 0 ? String(v) : "");
  return { heat_laps: str(race.heat_laps), consolation_laps: str(race.consolation_laps) };
}

// Form fields → the heat/consolation half of a POST/PATCH body. Zeroed — i.e.
// back to "use the feature distance" — for an event that isn't a heat weekend
// or isn't measured in laps at all, so a preliminary distance can't survive the
// format being switched away from under it.
export function sessionLapsBody(form = {}, heatFormat = true) {
  const on = !!heatFormat && raceLengthType(form) === LENGTH_LAPS;
  const num = v => {
    const n = Number(v);
    return on && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return { heat_laps: num(form.heat_laps), consolation_laps: num(form.consolation_laps) };
}
