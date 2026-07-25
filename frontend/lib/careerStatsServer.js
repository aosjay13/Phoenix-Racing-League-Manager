import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  buildQualPosMap,
  buildQualTemplateMap,
  calculateStandings,
  configForTemplate,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { classKey, classOfResult, fetchClassesForSeasons } from "@/lib/classServer";

// Builds a driver's career stats grouped per game (and all games combined),
// from every entry that matches the given global driver id and/or linked
// account. Matching on both means a profile still resolves for people who
// only ever raced under a linked account (older entries without a driver_id)
// as well as pool drivers who never made an account. Titles = completed
// seasons where one of their entries finished P1 in points.
export async function buildCareerProfile({ driverId = null, userId = null }) {
  const queries = [];
  if (driverId) queries.push(db().collection("entries").where("driver_id", "==", driverId).get());
  if (userId) queries.push(db().collection("entries").where("user_id", "==", userId).get());
  if (!queries.length) return { all_games: aggregateCareerStats([], 0), by_game: [], by_track: [], seasons_raced: 0 };

  const snaps = await Promise.all(queries);
  // Dedupe by entry id — the same entry can match both queries.
  const entryMap = new Map();
  for (const snap of snaps) for (const d of snap.docs) entryMap.set(d.id, { id: d.id, ...d.data() });
  const myEntries = [...entryMap.values()];

  const seasonIds = [...new Set(myEntries.map(e => e.season_id))];
  const seasonDocs = await Promise.all(seasonIds.map(id => db().collection("seasons").doc(id).get()));
  const seasons = Object.fromEntries(seasonDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

  const gameIds = [...new Set(Object.values(seasons).map(s => s.game_id).filter(Boolean))];
  const gameDocs = await Promise.all(gameIds.map(id => db().collection("games").doc(id).get()));
  const games = Object.fromEntries(gameDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

  const perGame = {};       // gameId -> results
  const titlesPerGame = {}; // gameId -> count
  const perTrack = {};      // trackKey -> { track_id, track_name, results[] }
  // classKey ("gt3") -> the driver's results in that class, across every season
  // that ran it. Keyed by NAME because a class doc belongs to one season, so a
  // driver's GT3 career spans a different id each year.
  const perClass = {};
  const allResults = [];
  let totalTitles = 0;
  const [templatesById, careerClasses] = await Promise.all([
    fetchTemplatesById(),
    fetchClassesForSeasons(seasonIds),
  ]);
  const classById = Object.fromEntries(careerClasses.map(c => [c.id, c]));

  for (const seasonId of seasonIds) {
    const season = seasons[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season);
    const gameId = season.game_id || "unknown";
    const myEntryIds = new Set(myEntries.filter(e => e.season_id === seasonId).map(e => e.id));

    const [resultsSnap, entriesSnap2, racesSnap] = await Promise.all([
      db().collection("results").where("season_id", "==", seasonId).get(),
      db().collection("entries").where("season_id", "==", seasonId).get(),
      db().collection("races").where("season_id", "==", seasonId).get(),
    ]);
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const seasonResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    const seasonEntries = entriesSnap2.docs.map(d => ({ id: d.id, ...d.data() }));
    const qualPosMap = buildQualPosMap(seasonResults);
    const qualTemplateByRace = buildQualTemplateMap(seasonResults);

    const mine = seasonResults
      .filter(r => myEntryIds.has(r.entry_id))
      .map(r => ({
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : pointsFor(r, configForTemplate(config, templatesById[r.points_template_id]), qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null, configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]])),
      }));
    (perGame[gameId] ??= []).push(...mine);
    allResults.push(...mine);

    // Bucket the driver's results by the venue each race was held at, so the
    // profile can show per-track performance. Races are keyed by their linked
    // `track_id` when present; legacy free-text races (no track_id) fall back to
    // grouping by the resolved track NAME so their history isn't lost. Races
    // with no venue recorded at all are skipped from the per-track view.
    for (const r of mine) {
      const race = racesById[r.race_id];
      if (!race) continue;
      const trackId = race.track_id || null;
      const trackName = (race.track || "").trim();
      if (!trackId && !trackName) continue;
      const key = trackId ? `id:${trackId}` : `name:${trackName.toLowerCase()}`;
      const bucket = (perTrack[key] ??= { track_id: trackId, track_name: trackName || "Unknown Track", results: [] });
      if (trackName) bucket.track_name = trackName; // prefer a real name over a bare id
      bucket.results.push(r);
    }

    // Bucket the same results by the class the driver ran them in, so a career
    // shows a GT3 line and an LMP2 line as well as the combined total. Results
    // outside any class (a season that predates classes, or an unclassified
    // driver) are left out of this breakdown — they're already in the totals.
    const seasonEntriesById = Object.fromEntries(seasonEntries.map(e => [e.id, e]));
    for (const r of mine) {
      const cls = classById[classOfResult(r, seasonEntriesById) || ""];
      if (!cls) continue;
      const key = classKey(cls.name);
      const bucket = (perClass[key] ??= { class_id: cls.id, class_name: cls.name, color: cls.color ?? null, sort_order: Number(cls.sort_order || 0), titles: 0, results: [] });
      bucket.class_name = cls.name;
      bucket.results.push(r);
    }

    if (season.status === "completed" && mine.length) {
      // The season's own championship — the overall one when the season crowns
      // it, and each class championship the driver won on top of that. A class
      // title is a title: it cascades into the career total exactly like a
      // single-class season's does.
      const seasonClasses = careerClasses.filter(c => c.season_id === seasonId);
      const combinedOn = season.combined_championship !== false;
      if (!seasonClasses.length || combinedOn) {
        const standings = calculateStandings(seasonResults, seasonEntries, [], config, templatesById);
        if (standings.rows[0] && myEntryIds.has(standings.rows[0].entry_id)) {
          totalTitles += 1;
          titlesPerGame[gameId] = (titlesPerGame[gameId] || 0) + 1;
        }
      }
      for (const cls of seasonClasses) {
        const classResults = seasonResults.filter(r => classOfResult(r, seasonEntriesById) === cls.id);
        const classEntries = seasonEntries.filter(e => e.class_id === cls.id);
        if (!classResults.length || !classEntries.length) continue;
        const standings = calculateStandings(classResults, classEntries, [], config, templatesById);
        if (!standings.rows[0] || !myEntryIds.has(standings.rows[0].entry_id)) continue;
        totalTitles += 1;
        titlesPerGame[gameId] = (titlesPerGame[gameId] || 0) + 1;
        const bucket = perClass[classKey(cls.name)];
        if (bucket) bucket.titles += 1;
      }
    }
  }

  const byGame = Object.entries(perGame).map(([gameId, results]) => ({
    game_id: gameId,
    game_name: games[gameId]?.name ?? "Unknown Game",
    game_logo_url: games[gameId]?.logo_url ?? null,
    stats: aggregateCareerStats(results, titlesPerGame[gameId] || 0),
  }));

  // Resolve current track names/logos for venues linked by id (a track may have
  // been renamed since the race ran; the profile should show today's name).
  const trackIds = [...new Set(Object.values(perTrack).map(t => t.track_id).filter(Boolean))];
  const trackDocs = await Promise.all(trackIds.map(id => db().collection("tracks").doc(id).get()));
  const trackInfo = {};
  for (const doc of trackDocs) if (doc.exists) trackInfo[doc.id] = doc.data();

  const byTrack = Object.values(perTrack)
    .map(t => ({
      track_id: t.track_id,
      track_name: (t.track_id && trackInfo[t.track_id]?.name) || t.track_name,
      track_logo_url: (t.track_id && trackInfo[t.track_id]?.logo_url) || null,
      track_location: (t.track_id && trackInfo[t.track_id]?.location) || null,
      // 0-title aggregation: championships aren't a per-venue concept.
      stats: aggregateCareerStats(t.results, 0),
    }))
    // Only surface venues where the driver actually started a race (races that
    // count toward stats) — a qualifying-only appearance produces 0 starts.
    .filter(t => t.stats.starts > 0)
    .sort((a, b) =>
      b.stats.wins - a.stats.wins || b.stats.starts - a.stats.starts ||
      String(a.track_name).localeCompare(String(b.track_name)));

  // Per-class career line, in the running order classes are shown in elsewhere.
  // Empty for a driver who has only ever raced in seasons without classes.
  const byClass = Object.values(perClass)
    .map(c => ({
      class_id: c.class_id,
      class_name: c.class_name,
      color: c.color,
      sort_order: c.sort_order,
      stats: aggregateCareerStats(c.results, c.titles),
    }))
    .filter(c => c.stats.starts > 0 || c.stats.qualifying_sessions > 0)
    .sort((a, b) => a.sort_order - b.sort_order || String(a.class_name).localeCompare(String(b.class_name)));

  return {
    all_games: aggregateCareerStats(allResults, totalTitles),
    by_game: byGame,
    by_track: byTrack,
    by_class: byClass,
    seasons_raced: seasonIds.length,
  };
}
