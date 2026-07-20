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
  if (!queries.length) return { all_games: aggregateCareerStats([], 0), by_game: [], seasons_raced: 0 };

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
  const allResults = [];
  let totalTitles = 0;
  const templatesById = await fetchTemplatesById();

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

    if (season.status === "completed" && mine.length) {
      const standings = calculateStandings(seasonResults, seasonEntries, [], config, templatesById);
      if (standings.rows[0] && myEntryIds.has(standings.rows[0].entry_id)) {
        totalTitles += 1;
        titlesPerGame[gameId] = (titlesPerGame[gameId] || 0) + 1;
      }
    }
  }

  const byGame = Object.entries(perGame).map(([gameId, results]) => ({
    game_id: gameId,
    game_name: games[gameId]?.name ?? "Unknown Game",
    game_logo_url: games[gameId]?.logo_url ?? null,
    stats: aggregateCareerStats(results, titlesPerGame[gameId] || 0),
  }));

  return {
    all_games: aggregateCareerStats(allResults, totalTitles),
    by_game: byGame,
    seasons_raced: seasonIds.length,
  };
}
