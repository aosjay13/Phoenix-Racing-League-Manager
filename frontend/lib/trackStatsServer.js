import { db } from "@/lib/firebase";
import { fetchSeriesByIds } from "@/lib/seriesServer";
import {
  aggregateCareerStats,
  decorateRaceBonuses,
  decorateSessionFlags,
  sessionScopeContext,
  isQualifying,
  makeScorer,
  resolveSeasonConfig,
} from "@/lib/standings";
import { raceDateSortKey } from "@/lib/raceDate";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { parseTime, formatTime } from "@/lib/raceTime";
import { finalSessionName, summarizeRace } from "@/lib/raceSummaryServer";
import { carForClass, classIdSet, classIdsInSeason, classOfResult, fetchSeasonClasses } from "@/lib/classServer";
import { classRecordKey, gameRecordKey, keepFastest } from "@/lib/trackRecords";
import { fetchNameResolver } from "@/lib/driverNamesServer";

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
export async function buildTrackProfile({ trackId, trackName, scope = {} }) {
  // A class selection scopes the leaderboard, the winners list and the headline
  // record to that class — the venue seen through one category's eyes. It's
  // resolved per season (a class doc belongs to one season), so a class picked
  // at series level still narrows every season it covers. The per-game and
  // per-class record breakdowns stay whole, since they exist precisely to show
  // the categories side by side.
  const { className = "", classId: wantedClassId = "" } = scope;
  const classFilterOn = !!(className || wantedClassId);
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
  const templatesById = await fetchTemplatesById();

  const keyFor = e =>
    e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${String(e.name || "").trim().toLowerCase()}`;

  const drivers = {}; // driverKey -> { driver_name, driver_id, user_id, results[] }
  const winners = []; // one row per event won here
  let record = null;  // fastest single lap ever turned here (the track record)
  const recordByGame = {}; // game_id -> fastest single lap turned here in THAT game
  // `${game_id}|${class name}` -> that class's own fastest lap here. Keyed on
  // the class NAME, not its id: a class doc belongs to one season, so "GT3" in
  // Season 3 and "GT3" in Season 4 are different ids for the same category, and
  // a venue record spans seasons. Keyed on the game too, for the same reason
  // recordByGame exists — a GT7 lap and an iRacing lap aren't comparable.
  const recordByClass = {};

  // Register a lap toward the headline record (full scope only), the per-game
  // record, and — when the driver ran in a class — that class's record.
  // `gameId` is the game the season belongs to; `className` is blank for an
  // unclassified driver or a season that doesn't run classes.
  const considerLap = (r, entry, race, seasonId, seasonName, gameId, inFullScope, className) => {
    const secs = isQualifying(r) ? parseTime(r.qual_time) : parseTime(r.fastest_lap_time);
    if (secs == null) return;
    const mk = () => ({
      seconds: secs,
      time: formatTime(secs),
      driver_name: entry.name,
      driver_id: entry.driver_id ?? null,
      user_id: entry.user_id ?? null,
      // The game this lap was set in, so the holder can be named the way that
      // game names them (see lib/driverNames.js).
      game_id: gameId,
      race_id: r.race_id,
      race_name: race?.name ?? null,
      session: r.session || (isQualifying(r) ? "Qualifying" : null),
      from_qualifying: isQualifying(r),
      season_id: seasonId,
      season_name: seasonName,
      date: race?.date || null,
    });
    if (inFullScope && (record == null || secs < record.seconds)) record = mk();
    keepFastest(recordByGame, gameRecordKey({ gameId }), mk());
    keepFastest(recordByClass, classRecordKey({ gameId, className }),
      { ...mk(), game_id: gameId, class_name: className });
  };

  // Each season scores on its SERIES' points unless it overrides them.
  const seriesById = await fetchSeriesByIds(loopSeasonIds.map(id => seasonsById[id]?.series_id));

  for (const seasonId of loopSeasonIds) {
    const season = seasonsById[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season, seriesById[season.series_id] || null);
    const gameId = season.game_id || null;

    const [entriesSnap, resultsSnap, racesSnap, seasonClasses] = await Promise.all([
      db().collection("entries").where("season_id", "==", seasonId).get(),
      db().collection("results").where("season_id", "==", seasonId).get(),
      db().collection("races").where("season_id", "==", seasonId).get(),
      fetchSeasonClasses(seasonId),
    ]);
    const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const allResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById,
      sessionScopeContext({ seasons: [season], classes: seasonClasses, entriesById })));
    // Scored under the class each result was run in, so a class with its own
    // points structure carries it into the venue leaderboard too.
    const scorer = makeScorer(allResults, { config, classes: seasonClasses, entriesById, templatesById });

    // Keep only results from races held at THIS venue (across all in-scope games).
    const results = allResults.filter(r => venueRaceIds.has(r.race_id));
    // The class a result counts toward, as a NAME — that's the identity a
    // cross-season venue record needs (see recordByClass).
    const classNameById = Object.fromEntries(seasonClasses.map(c => [c.id, c.name]));
    const classNameOf = r => classNameById[classOfResult(r, entriesById)] ?? "";
    // This season's own docs for the selected class; empty means the season
    // doesn't run it, so none of its results belong in a class-scoped view.
    const classSel = classIdsInSeason(seasonClasses, { className, classId: wantedClassId });
    const inSelectedClass = r =>
      !classFilterOn || (classSel.length > 0 && classIdSet(classSel).has(classOfResult(r, entriesById)));

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const inFullScope = raceIds.has(r.race_id);
      const race = racesById[r.race_id];

      // Track record(s) — the fastest single lap turned here, across BOTH
      // race-type sessions (lap in fastest_lap_time) and Qualifying (hot lap in
      // qual_time). Recorded per game always, and folded into the headline
      // record only when the race is in the full (game-scoped) selection.
      // The headline record follows the class selection; the per-game and
      // per-class breakdowns are always computed across the whole field.
      considerLap(r, entry, race, seasonId, season.name, gameId, inFullScope && inSelectedClass(r), classNameOf(r));

      // The leaderboard / career aggregation is the game-scoped view only, and
      // narrows to the selected class when there is one.
      if (!inFullScope || !inSelectedClass(r)) continue;
      const scored = {
        ...r,
        // Qualifying scores itself now, so it is not excluded here — only a
        // session whose points toggle is off scores nothing.
        points: r.counts_points === false ? 0 : scorer.points(r),
      };
      const k = keyFor(entry);
      const bucket = (drivers[k] ??= { driver_name: entry.name, driver_id: entry.driver_id ?? null, user_id: entry.user_id ?? null, results: [] });
      bucket.driver_name = entry.name;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      if (entry.user_id) bucket.user_id = entry.user_id;
      bucket.results.push(scored);
    }

    // Winner of each event = P1 of its deciding session (full scope only).
    for (const race of races) {
      if (race.season_id !== seasonId) continue;
      const finalName = finalSessionName(race);
      const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
      const winner = results.find(r =>
        r.race_id === race.id && !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName &&
        Number(r.finish_pos) === 1 && inSelectedClass(r));
      if (!winner) continue;
      const entry = entriesById[winner.entry_id];
      // The car credited to this win is the WINNER's class car, not the
      // season's — on a season whose classes race different machinery, a GT3
      // win shouldn't be listed under the LMP2 default.
      const winnerClass = seasonClasses.find(c => c.id === classOfResult(winner, entriesById)) ?? null;
      const summary = summarizeRace(race, results, entriesById, carForClass(season, winnerClass), classSel);
      winners.push({
        race_id: race.id,
        race_name: race.name,
        round_number: race.round_number ?? null,
        date: race.date || null,
        season_id: seasonId,
        season_name: season.name,
        series_id: season.series_id ?? null,
        // The game each past event was raced on. A venue's history can span
        // several games (the same circuit in iRacing and in GT7), so the
        // winners table leads with it.
        game_id: season.game_id ?? null,
        driver_name: entry?.name ?? "Unknown",
        driver_id: entry?.driver_id ?? null,
        user_id: entry?.user_id ?? null,
        car: summary.car,
        laps: summary.laps,
        scheduled_laps: summary.scheduled_laps,
        laps_extended: summary.laps_extended,
        // Distance as the calendar prints it — "45 Min" for a timed event,
        // "100 Laps" for one run to a distance. See lib/raceLength.js.
        length_type: summary.length_type,
        scheduled_minutes: summary.scheduled_minutes,
        length_label: summary.length_label,
        num_drivers: summary.num_drivers,
        pole: summary.pole,
      });
    }
  }

  // Names come from each driver's profile everywhere a driver is shown — the
  // leaderboard, the headline record, each game's record, and the winners list.
  // A venue's history can span several games, so this resolver answers per game
  // (see lib/driverNames.js): a row belonging to one game shows that game's
  // name for the driver, and anything not tied to a single game shows their
  // overall display name. Ids are collected from every section so a
  // record-holder excluded from the leaderboard (different game) still resolves.
  const nameFor = await fetchNameResolver([
    ...Object.values(drivers).map(d => d.driver_id),
    record?.driver_id,
    ...Object.values(recordByGame).map(r => r.driver_id),
    ...Object.values(recordByClass).map(r => r.driver_id),
    ...winners.map(w => w.driver_id),
  ]);
  // The leaderboard and headline record are shown under whatever game the page
  // is scoped to — a Series/Season pins one just as a Game selection does.
  const scopeGameId =
    scope.gameId ||
    (scope.seasonId ? seasonsById[scope.seasonId]?.game_id : null) ||
    (scope.seriesId ? Object.values(seasonsById).find(s => s.series_id === scope.seriesId)?.game_id : null) ||
    null;
  const canonicalName = Object.fromEntries(nameFor.ids.map(id => [id, nameFor.display(id, scopeGameId)]));

  // Resolve the series each past-result event ran in (seasons sit under series).
  const seriesIds = [...new Set(winners.map(w => w.series_id).filter(Boolean))];
  const seriesName = {};
  if (seriesIds.length) {
    const docs = await Promise.all(seriesIds.map(id => db().collection("series").doc(id).get()));
    for (const doc of docs) if (doc.exists) seriesName[doc.id] = doc.data().name;
  }
  for (const w of winners) w.series_name = (w.series_id && seriesName[w.series_id]) || null;

  // Resolve game names for the per-game record breakdown and the winners list.
  const gameIds = [...new Set([
    ...Object.keys(recordByGame),
    ...Object.values(recordByClass).map(r => r.game_id),
    ...winners.map(w => w.game_id),
  ].filter(Boolean))];
  const gameName = {};
  if (gameIds.length) {
    const docs = await Promise.all(gameIds.map(id => db().collection("games").doc(id).get()));
    for (const doc of docs) if (doc.exists) gameName[doc.id] = doc.data().name;
  }
  for (const w of winners) {
    w.game_name = (w.game_id && gameName[w.game_id]) || null;
    // Each past win belongs to one game, so the winner is named as that game
    // names them (falling back to the name stored on the entry).
    if (w.driver_id) w.driver_name = nameFor.display(w.driver_id, w.game_id) || w.driver_name;
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

  if (record?.driver_id) {
    record.driver_name = nameFor.display(record.driver_id, record.game_id) || record.driver_name;
  }

  const records_by_game = Object.entries(recordByGame)
    .map(([gid, rec]) => ({
      ...rec,
      // Each row IS one game, so the holder is named as that game names them.
      driver_name: (rec.driver_id && nameFor.display(rec.driver_id, gid)) || rec.driver_name,
      game_id: gid,
      game_name: gameName[gid] || "Unknown Game",
    }))
    .sort((a, b) => String(a.game_name).localeCompare(String(b.game_name)));

  // One row per (game, class) that actually turned a lap here, so a GT3 record
  // and an LMP2 record sit side by side instead of the quicker car's lap
  // standing as "the" track record for both.
  const records_by_class = Object.values(recordByClass)
    .map(rec => ({
      ...rec,
      driver_name: (rec.driver_id && nameFor.display(rec.driver_id, rec.game_id)) || rec.driver_name,
      game_name: gameName[rec.game_id] || "Unknown Game",
    }))
    .sort((a, b) =>
      String(a.game_name).localeCompare(String(b.game_name)) ||
      String(a.class_name).localeCompare(String(b.class_name)));

  return {
    races_held: races.length,
    seasons_raced: seasonIds.length,
    record,
    records_by_game,
    records_by_class,
    drivers: driverRows,
    winners,
  };
}
