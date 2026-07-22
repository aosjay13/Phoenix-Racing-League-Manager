import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  buildQualPosMap,
  buildQualTemplateMap,
  configForTemplate,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { parseTime, formatTime } from "@/lib/raceTime";
import { finalSessionName, summarizeRace } from "@/lib/raceSummaryServer";

// Aggregates a venue's history from every race held there. Races are linked by
// `track_id`; legacy races that only stored the track NAME (before track_id
// existed, and still carry no id) are matched by exact name so their history
// isn't lost. Results are scored the same way standings/career stats are, then
// grouped into a per-driver leaderboard ("most wins here") and a chronological
// list of past event winners.
// `scope` mirrors the top-of-page Game / Series / Season dropdowns, so the
// venue's records/history reflect exactly the branch the user is viewing:
// a season narrows to that season, a series to its seasons, a game to its
// seasons, and nothing selected shows every race ever held here.
export async function buildTrackProfile({ trackId, trackName, scope = {} }) {
  const empty = { races_held: 0, seasons_raced: 0, record: null, drivers: [], winners: [] };
  const wantedName = String(trackName || "").trim();
  const queries = [db().collection("races").where("track_id", "==", trackId).get()];
  if (wantedName) queries.push(db().collection("races").where("track", "==", wantedName).get());
  const snaps = await Promise.all(queries);

  const raceMap = new Map();
  for (const d of snaps[0].docs) raceMap.set(d.id, { id: d.id, ...d.data() });
  if (snaps[1]) {
    for (const d of snaps[1].docs) {
      const data = d.data();
      // Only fold in a name-matched race when it has no explicit track_id — a
      // race pinned to a DIFFERENT track's id must not be double-counted here.
      if (!data.track_id) raceMap.set(d.id, { id: d.id, ...data });
    }
  }
  const allRaces = [...raceMap.values()];
  if (!allRaces.length) return empty;

  // Load the season docs for every matched race, then keep only the races whose
  // season falls inside the selected Game/Series/Season context.
  const matchedSeasonIds = [...new Set(allRaces.map(r => r.season_id).filter(Boolean))];
  const seasonDocs = await Promise.all(matchedSeasonIds.map(id => db().collection("seasons").doc(id).get()));
  const seasonsById = {};
  for (const doc of seasonDocs) if (doc.exists) seasonsById[doc.id] = { id: doc.id, ...doc.data() };

  const inScope = season => {
    if (!season) return false;
    if (scope.seasonId) return season.id === scope.seasonId;
    if (scope.seriesId) return season.series_id === scope.seriesId;
    if (scope.gameId) return season.game_id === scope.gameId;
    return true;
  };
  const races = allRaces.filter(r => inScope(seasonsById[r.season_id]));
  if (!races.length) return empty;

  const raceIds = new Set(races.map(r => r.id));
  const seasonIds = [...new Set(races.map(r => r.season_id).filter(Boolean))];
  const templatesById = await fetchTemplatesById();

  const keyFor = e =>
    e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${String(e.name || "").trim().toLowerCase()}`;

  const drivers = {}; // driverKey -> { driver_name, driver_id, user_id, results[] }
  const winners = []; // one row per event won here
  let record = null;  // fastest single lap ever turned here (the track record)

  for (const seasonId of seasonIds) {
    const season = seasonsById[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season);

    const [entriesSnap, resultsSnap, racesSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", seasonId).get(),
      db().collection("results").where("season_id", "==", seasonId).get(),
      db().collection("races").where("season_id", "==", seasonId).get(),
    ]);
    const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const allResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    const qualPosMap = buildQualPosMap(allResults);
    const qualTemplateByRace = buildQualTemplateMap(allResults);

    // Keep only results from races held at THIS venue.
    const results = allResults.filter(r => raceIds.has(r.race_id));

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const scored = {
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : pointsFor(
          r,
          configForTemplate(config, templatesById[r.points_template_id]),
          qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null,
          configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]]),
        ),
      };
      const k = keyFor(entry);
      const bucket = (drivers[k] ??= { driver_name: entry.name, driver_id: entry.driver_id ?? null, user_id: entry.user_id ?? null, results: [] });
      bucket.driver_name = entry.name;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      if (entry.user_id) bucket.user_id = entry.user_id;
      bucket.results.push(scored);

      // Track record = the fastest single lap turned here, across BOTH race-type
      // sessions (whose lap lives in fastest_lap_time) and Qualifying (whose hot
      // lap lives in qual_time) — a qualifying lap is still a real lap set at
      // this venue, so it counts toward the venue record.
      const secs = isQualifying(r) ? parseTime(r.qual_time) : parseTime(r.fastest_lap_time);
      if (secs != null && (record == null || secs < record.seconds)) {
        const race = racesById[r.race_id];
        record = {
          seconds: secs,
          time: formatTime(secs),
          driver_name: entry.name,
          driver_id: entry.driver_id ?? null,
          user_id: entry.user_id ?? null,
          race_id: r.race_id,
          race_name: race?.name ?? null,
          session: r.session || (isQualifying(r) ? "Qualifying" : null),
          from_qualifying: isQualifying(r),
          season_id: seasonId,
          season_name: season.name,
          date: race?.date || null,
        };
      }
    }

    // Winner of each event = P1 of its deciding session.
    for (const race of races) {
      if (race.season_id !== seasonId) continue;
      const finalName = finalSessionName(race);
      const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
      const winner = results.find(r =>
        r.race_id === race.id && !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName && Number(r.finish_pos) === 1);
      if (!winner) continue;
      const entry = entriesById[winner.entry_id];
      const summary = summarizeRace(race, results, entriesById, season.car || null);
      winners.push({
        race_id: race.id,
        race_name: race.name,
        round_number: race.round_number ?? null,
        date: race.date || null,
        season_id: seasonId,
        season_name: season.name,
        series_id: season.series_id ?? null,
        driver_name: entry?.name ?? "Unknown",
        driver_id: entry?.driver_id ?? null,
        user_id: entry?.user_id ?? null,
        car: summary.car,
        laps: summary.laps,
        scheduled_laps: summary.scheduled_laps,
        laps_extended: summary.laps_extended,
        num_drivers: summary.num_drivers,
        pole: summary.pole,
      });
    }
  }

  // Prefer canonical global-driver names for the leaderboard.
  const driverIds = [...new Set(Object.values(drivers).map(d => d.driver_id).filter(Boolean))];
  const canonicalName = {};
  if (driverIds.length) {
    const docs = await Promise.all(driverIds.map(id => db().collection("drivers").doc(id).get()));
    for (const doc of docs) if (doc.exists) canonicalName[doc.id] = doc.data().name;
  }

  // Resolve the series each past-result event ran in (seasons sit under series).
  const seriesIds = [...new Set(winners.map(w => w.series_id).filter(Boolean))];
  const seriesName = {};
  if (seriesIds.length) {
    const docs = await Promise.all(seriesIds.map(id => db().collection("series").doc(id).get()));
    for (const doc of docs) if (doc.exists) seriesName[doc.id] = doc.data().name;
  }
  for (const w of winners) w.series_name = (w.series_id && seriesName[w.series_id]) || null;

  const driverRows = Object.values(drivers)
    .map(d => ({
      driver_name: (d.driver_id && canonicalName[d.driver_id]) || d.driver_name,
      driver_id: d.driver_id,
      user_id: d.user_id,
      ...aggregateCareerStats(d.results, 0),
    }))
    .filter(d => d.starts > 0)
    .sort((a, b) =>
      b.wins - a.wins || b.podiums - a.podiums || (a.avg_finish ?? 99) - (b.avg_finish ?? 99) ||
      String(a.driver_name).localeCompare(String(b.driver_name)));

  winners.sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });

  if (record?.driver_id && canonicalName[record.driver_id]) record.driver_name = canonicalName[record.driver_id];

  return { races_held: races.length, seasons_raced: seasonIds.length, record, drivers: driverRows, winners };
}
