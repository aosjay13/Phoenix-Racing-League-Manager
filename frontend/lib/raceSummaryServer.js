import { isQualifying } from "@/lib/standings";

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
// A multi-class event has a winner and a pole PER CLASS, since each class runs
// its own race. Pass `classes` (the season's class docs, in running order) and
// `classOf` (a result -> class id resolver, i.e. classOfResult bound to the
// season's entries) and the summary additionally carries `by_class`: one
// { class_id, class_name, winner, pole, num_drivers } row per class that
// contested it. The top-level winner/pole then name the FIRST class's — the top
// one in the admin's order — rather than whichever result happened to sort
// first. Omit both and nothing changes: single-class and legacy events summarize
// exactly as before.
export function summarizeRace(race, results, entriesById, seasonCar = null, { classes = [], classOf = null } = {}) {
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const finalName = finalSessionName(race);
  const raceResults = results.filter(r => r.race_id === race.id);
  // Provisional entries (drivers who didn't race) never count as part of the
  // field or as the winner — they only carry points.
  const finalResults = raceResults.filter(r => !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName);
  const qualResults = raceResults.filter(r => isQualifying(r));

  const p1Of = rs => rs.find(r => Number(r.finish_pos) === 1);
  const inClass = (rs, cid) => (classOf ? rs.filter(r => (classOf(r) || "") === cid) : rs);

  // One row per class that actually ran this event, in the season's class order.
  const by_class = (classOf ? classes : [])
    .map(c => {
      const classFinals = inClass(finalResults, c.id);
      if (!classFinals.length) return null;
      const w = p1Of(classFinals);
      const p = p1Of(inClass(qualResults, c.id));
      return {
        class_id: c.id,
        class_name: c.name,
        winner: personFromEntry(w && entriesById[w.entry_id]),
        pole: personFromEntry(p && entriesById[p.entry_id]),
        num_drivers: new Set(classFinals.map(r => r.entry_id)).size,
      };
    })
    .filter(Boolean);

  // Headline winner/pole: the top class's when the event was split, else the
  // event's outright one.
  const winnerRes = by_class.length ? p1Of(inClass(finalResults, by_class[0].class_id)) : p1Of(finalResults);
  const poleRes = by_class.length ? p1Of(inClass(qualResults, by_class[0].class_id)) : p1Of(qualResults);

  const winnerLaps = winnerRes && Number(winnerRes.laps) > 0 ? Number(winnerRes.laps) : null;
  const scheduledLaps = race.total_laps ? Number(race.total_laps) : null;

  return {
    // Race-level car overrides the season default; blank inherits the season's.
    car: (race.car && String(race.car).trim()) || (seasonCar && String(seasonCar).trim()) || null,
    laps: winnerLaps ?? scheduledLaps,
    scheduled_laps: scheduledLaps,
    laps_extended: winnerLaps != null && scheduledLaps != null && winnerLaps > scheduledLaps,
    // The whole field across every class — an event's turnout, not one class's.
    num_drivers: new Set(finalResults.map(r => r.entry_id)).size,
    winner: personFromEntry(winnerRes && entriesById[winnerRes.entry_id]),
    pole: personFromEntry(poleRes && entriesById[poleRes.entry_id]),
    by_class,
    has_results: raceResults.length > 0,
  };
}
