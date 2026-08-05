import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  makeScorer,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { fetchSeasonClasses } from "@/lib/classServer";
import { describeCrowns, seasonChampions, titlesByEntry } from "@/lib/champions";

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
  const allResults = [];
  const titleList = [];     // one row per season won, newest resolved by caller
  let totalTitles = 0;
  const templatesById = await fetchTemplatesById();

  for (const seasonId of seasonIds) {
    const season = seasons[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season);
    const gameId = season.game_id || "unknown";
    const myEntryIds = new Set(myEntries.filter(e => e.season_id === seasonId).map(e => e.id));

    const [resultsSnap, entriesSnap2, racesSnap, seasonClasses] = await Promise.all([
      db().collection("results").where("season_id", "==", seasonId).get(),
      db().collection("entries").where("season_id", "==", seasonId).get(),
      db().collection("races").where("season_id", "==", seasonId).get(),
      fetchSeasonClasses(seasonId),
    ]);
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const seasonResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    const seasonEntries = entriesSnap2.docs.map(d => ({ id: d.id, ...d.data() }));
    // Scored under the class each result was run in, so a class with its own
    // points structure reaches the career totals as well as the standings.
    const scorer = makeScorer(seasonResults, {
      config, classes: seasonClasses, templatesById,
      entriesById: Object.fromEntries(seasonEntries.map(e => [e.id, e])),
    });

    const mine = seasonResults
      .filter(r => myEntryIds.has(r.entry_id))
      .map(r => ({
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : scorer.points(r),
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

    // Championships. Every crown the season handed out is considered — each
    // class's champion as well as the overall one, and no overall at all when
    // the season runs class-only titles — then narrowed to this driver. A
    // driver who won both their class and the overall in one season scores
    // two, with both crowns recorded so the profile can show which they were.
    const mineRec = [...titlesByEntry(seasonChampions(season, seasonResults, seasonEntries, config, templatesById, seasonClasses))]
      .find(([entryId]) => myEntryIds.has(entryId))?.[1];
    if (mineRec) {
      totalTitles += mineRec.titles;
      titlesPerGame[gameId] = (titlesPerGame[gameId] || 0) + mineRec.titles;
      titleList.push({
        season_id: seasonId,
        season_name: season.name ?? "Season",
        game_id: season.game_id ?? null,
        game_name: games[season.game_id]?.name ?? null,
        overall: mineRec.overall,
        class_names: mineRec.class_names,
        label: describeCrowns(mineRec),
      });
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

  return {
    all_games: aggregateCareerStats(allResults, totalTitles),
    by_game: byGame,
    by_track: byTrack,
    // Every championship won, so the profile can name them ("Season 4 —
    // Overall + GT3") rather than just showing a count.
    titles_detail: titleList,
    seasons_raced: seasonIds.length,
  };
}
