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
// (distinct entries in that deciding session) and the scheduled distance.
// `results` may span many races — it's filtered to this one here.
export function summarizeRace(race, results, entriesById) {
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const finalName = finalSessionName(race);
  const raceResults = results.filter(r => r.race_id === race.id);
  const finalResults = raceResults.filter(r => !isQualifying(r) && (r.session || firstStd) === finalName);

  const winnerRes = finalResults.find(r => Number(r.finish_pos) === 1);
  const poleRes = raceResults.find(r => isQualifying(r) && Number(r.finish_pos) === 1);

  return {
    laps: race.total_laps ? Number(race.total_laps) : null,
    num_drivers: new Set(finalResults.map(r => r.entry_id)).size,
    winner: personFromEntry(winnerRes && entriesById[winnerRes.entry_id]),
    pole: personFromEntry(poleRes && entriesById[poleRes.entry_id]),
    has_results: raceResults.length > 0,
  };
}
