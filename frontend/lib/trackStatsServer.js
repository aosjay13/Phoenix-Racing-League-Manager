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
import { raceDateSortKey } from "@/lib/raceDate";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { parseTime, formatTime } from "@/lib/raceTime";
import { finalSessionName, summarizeRace } from "@/lib/raceSummaryServer";
import { classKey, classOfResult, fetchClassesForSeasons, resolveClassScope } from "@/lib/classServer";

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
//
// `records_by_game` is the exception: since lap times aren't comparable across
// games (a GT7 lap and an iRacing lap around the same circuit are different
// records), the fastest lap is ALSO broken out per game. That breakdown ignores
// the Game dropdown (a Series/Season still pins one game) so a track always
// lists every game's own track record side by side.
//
// Lap times aren't comparable across CLASSES either — an LMP1 lap and a GTE lap
// around the same layout are different records, and the quicker class would
// otherwise permanently own the venue's headline time. So `records_by_class`
// breaks the fastest lap out per class as well, and `scope.classId` narrows the
// leaderboard, past winners and headline record to one class. A venue whose
// races were never split into classes returns an empty `records_by_class` and is
// completely unaffected.
export async function buildTrackProfile({ trackId, trackName, scope = {} }) {
  const empty = { races_held: 0, seasons_raced: 0, record: null, records_by_game: [], records_by_class: [], drivers: [], winners: [] };
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

  // Full scope (Game + Series + Season) — governs the leaderboard, past winners,
  // headline record, and the races_held / seasons_raced counts.
  const inScope = season => {
    if (!season) return false;
    if (scope.seasonId) return season.id === scope.seasonId;
    if (scope.seriesId) return season.series_id === scope.seriesId;
    if (scope.gameId) return season.game_id === scope.gameId;
    return true;
  };
  // Series/Season scope only — the per-game record breakdown deliberately keeps
  // every game so a track always shows all of them (a Series/Season already
  // pins one game, so this only widens things when just a Game is selected).
  const inScopeAllGames = season => {
    if (!season) return false;
    if (scope.seasonId) return season.id === scope.seasonId;
    if (scope.seriesId) return season.series_id === scope.seriesId;
    return true;
  };

  const races = allRaces.filter(r => inScope(seasonsById[r.season_id]));       // full scope
  const gameRaces = allRaces.filter(r => inScopeAllGames(seasonsById[r.season_id])); // per-game breakdown
  if (!gameRaces.length) return empty;

  const raceIds = new Set(races.map(r => r.id));                 // full-scope venue races
  const venueRaceIds = new Set(gameRaces.map(r => r.id));        // all-games venue races
  const seasonIds = [...new Set(races.map(r => r.season_id).filter(Boolean))];
  const loopSeasonIds = [...new Set(gameRaces.map(r => r.season_id).filter(Boolean))];
  const [templatesById, venueClasses] = await Promise.all([
    fetchTemplatesById(),
    fetchClassesForSeasons(loopSeasonIds),
  ]);
  // The selected class widened to every same-named class across the seasons that
  // raced here, so "GTE at Le Mans" spans each season that ran the class.
  const classScope = await resolveClassScope(scope.classId || "", loopSeasonIds, venueClasses);
  const classSelector = classScope?.ids ?? null;
  const classById = Object.fromEntries(venueClasses.map(c => [c.id, c]));

  const keyFor = e =>
    e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${String(e.name || "").trim().toLowerCase()}`;

  const drivers = {}; // driverKey -> { driver_name, driver_id, user_id, results[] }
  const winners = []; // one row per event won here
  let record = null;  // fastest single lap ever turned here (the track record)
  const recordByGame = {};  // game_id -> fastest single lap turned here in THAT game
  const recordByClass = {}; // classKey -> fastest single lap turned here in THAT class

  // Register a lap toward the headline record (full scope only), the per-game
  // record and the per-class record. `gameId` is the game the season belongs to;
  // `cls` is the class doc the driver ran the lap in (null = no class).
  //
  // Machinery differs between classes, so their lap times are separate records:
  // a GT3 lap never overwrites the LMP2 record on the same layout, and vice
  // versa. The headline record stays the outright fastest lap of whatever the
  // dropdowns currently select — which, with a class picked, is that class's own.
  const considerLap = (r, entry, race, seasonId, seasonName, gameId, cls, inFullScope) => {
    const secs = isQualifying(r) ? parseTime(r.qual_time) : parseTime(r.fastest_lap_time);
    if (secs == null) return;
    const mk = () => ({
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
      season_name: seasonName,
      class_id: cls?.id ?? null,
      class_name: cls?.name ?? null,
      date: race?.date || null,
    });
    if (inFullScope && (record == null || secs < record.seconds)) record = mk();
    if (gameId) {
      const cur = recordByGame[gameId];
      if (cur == null || secs < cur.seconds) recordByGame[gameId] = mk();
    }
    if (cls) {
      const key = classKey(cls.name);
      const cur = recordByClass[key];
      if (cur == null || secs < cur.seconds) recordByClass[key] = { ...mk(), sort_order: Number(cls.sort_order || 0) };
    }
  };

  for (const seasonId of loopSeasonIds) {
    const season = seasonsById[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season);
    const gameId = season.game_id || null;

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

    // Keep only results from races held at THIS venue (across all in-scope games).
    const allVenueResults = allResults.filter(r => venueRaceIds.has(r.race_id));
    // The class a result was run in — stamped on the result when it was saved,
    // else the driver's current roster class. A selected class excludes
    // everything outside it from every figure on the page, records included.
    const classOf = r => classById[classOfResult(r, entriesById) || ""]?.id || "";
    const results = classSelector ? allVenueResults.filter(r => classSelector.has(classOf(r))) : allVenueResults;

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const cls = classById[classOf(r)] || null;
      const inFullScope = raceIds.has(r.race_id);
      const race = racesById[r.race_id];

      // Track record(s) — the fastest single lap turned here, across BOTH
      // race-type sessions (lap in fastest_lap_time) and Qualifying (hot lap in
      // qual_time). Recorded per game and per class always, and folded into the
      // headline record only when the race is in the full (game-scoped)
      // selection.
      considerLap(r, entry, race, seasonId, season.name, gameId, cls, inFullScope);

      // The leaderboard / career aggregation is the game-scoped view only.
      if (!inFullScope) continue;
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
    }

    // Winner of each event = P1 of its deciding session (full scope only). A
    // multi-class event has one winner PER CLASS — each class runs its own race
    // — so every P1 of that session is listed, tagged with the class it won.
    // Single-class and legacy events have exactly one, as before.
    for (const race of races) {
      if (race.season_id !== seasonId) continue;
      const finalName = finalSessionName(race);
      const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
      const classWinners = results.filter(r =>
        r.race_id === race.id && !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName && Number(r.finish_pos) === 1);
      if (!classWinners.length) continue;
      const seasonClasses = venueClasses.filter(c => c.season_id === seasonId);
      const summary = summarizeRace(race, results, entriesById, season.car || null, {
        classes: seasonClasses,
        classOf: seasonClasses.length ? (r => classOf(r)) : null,
      });
      for (const winner of classWinners) {
        const entry = entriesById[winner.entry_id];
        const cls = classById[classOf(winner)] || null;
        // Each class win is paired with that class's own pole, not the event's.
        const classSummary = summary.by_class.find(c => c.class_id === cls?.id) || null;
        winners.push({
          race_id: race.id,
          race_name: race.name,
          round_number: race.round_number ?? null,
          date: race.date || null,
          season_id: seasonId,
          season_name: season.name,
          series_id: season.series_id ?? null,
          class_id: cls?.id ?? null,
          class_name: cls?.name ?? null,
          driver_name: entry?.name ?? "Unknown",
          driver_id: entry?.driver_id ?? null,
          user_id: entry?.user_id ?? null,
          car: summary.car,
          laps: summary.laps,
          scheduled_laps: summary.scheduled_laps,
          laps_extended: summary.laps_extended,
          num_drivers: classSummary?.num_drivers ?? summary.num_drivers,
          pole: classSummary?.pole ?? summary.pole,
        });
      }
    }
  }

  // Prefer canonical global-driver names everywhere a driver is shown — the
  // leaderboard, the headline record, and each game's record. Collect ids from
  // all of those so a record-holder excluded from the leaderboard (different
  // game) still resolves.
  const driverIds = [...new Set([
    ...Object.values(drivers).map(d => d.driver_id),
    record?.driver_id,
    ...Object.values(recordByGame).map(r => r.driver_id),
    ...Object.values(recordByClass).map(r => r.driver_id),
  ].filter(Boolean))];
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

  // Resolve game names for the per-game record breakdown.
  const gameIds = [...new Set(Object.keys(recordByGame))];
  const gameName = {};
  if (gameIds.length) {
    const docs = await Promise.all(gameIds.map(id => db().collection("games").doc(id).get()));
    for (const doc of docs) if (doc.exists) gameName[doc.id] = doc.data().name;
  }

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

  // Most recent first. Race dates are bare calendar dates, so they're compared
  // as such (never through `new Date()`) — see lib/raceDate.js.
  winners.sort((a, b) => raceDateSortKey(b.date, -Infinity) - raceDateSortKey(a.date, -Infinity));

  if (record?.driver_id && canonicalName[record.driver_id]) record.driver_name = canonicalName[record.driver_id];

  const records_by_game = Object.entries(recordByGame)
    .map(([gid, rec]) => ({
      ...rec,
      driver_name: (rec.driver_id && canonicalName[rec.driver_id]) || rec.driver_name,
      game_id: gid,
      game_name: gameName[gid] || "Unknown Game",
    }))
    .sort((a, b) => String(a.game_name).localeCompare(String(b.game_name)));

  // One lap record per class, in the classes' running order. Different classes
  // run different machinery, so the quickest class never buries the others'
  // records — each is the outright fastest lap that class has turned here.
  const records_by_class = Object.values(recordByClass)
    .map(rec => ({
      ...rec,
      driver_name: (rec.driver_id && canonicalName[rec.driver_id]) || rec.driver_name,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || String(a.class_name).localeCompare(String(b.class_name)));

  return {
    races_held: races.length,
    seasons_raced: seasonIds.length,
    record,
    records_by_game,
    records_by_class,
    class_id: scope.classId || null,
    class_name: classScope?.name ?? null,
    drivers: driverRows,
    winners,
  };
}
