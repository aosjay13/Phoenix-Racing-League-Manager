import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  calculateStandings,
  decorateRaceBonuses,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";

// Public profile + career stats, grouped per game (and all games combined).
// Titles = completed seasons where a linked entry finished P1 in points.
export async function GET(request, { params }) {
  const uid = params.uid;
  const userDoc = await db().collection("users").doc(uid).get();
  if (!userDoc.exists) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const { email, role, ...publicProfile } = userDoc.data();

  const entriesSnap = await db().collection("entries").where("user_id", "==", uid).get();
  const myEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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

  for (const seasonId of seasonIds) {
    const season = seasons[seasonId];
    if (!season) continue;
    const config = resolveSeasonConfig(season);
    const gameId = season.game_id || "unknown";
    const myEntryIds = new Set(myEntries.filter(e => e.season_id === seasonId).map(e => e.id));

    const [resultsSnap, entriesSnap2] = await Promise.all([
      db().collection("results").where("season_id", "==", seasonId).get(),
      db().collection("entries").where("season_id", "==", seasonId).get(),
    ]);
    const seasonResults = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));
    const seasonEntries = entriesSnap2.docs.map(d => ({ id: d.id, ...d.data() }));

    const mine = seasonResults
      .filter(r => myEntryIds.has(r.entry_id))
      .map(r => ({ ...r, points: isQualifying(r) ? 0 : pointsFor(r, config) }));
    (perGame[gameId] ??= []).push(...mine);
    allResults.push(...mine);

    if (season.status === "completed" && mine.length) {
      const standings = calculateStandings(seasonResults, seasonEntries, [], config);
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

  return NextResponse.json({
    uid,
    profile: publicProfile,
    all_games: aggregateCareerStats(allResults, totalTitles),
    by_game: byGame,
    seasons_raced: seasonIds.length,
  });
}
