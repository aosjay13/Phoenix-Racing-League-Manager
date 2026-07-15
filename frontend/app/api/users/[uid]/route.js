import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { aggregateCareerStats, pointsFor, DEFAULT_POINTS_SCALE } from "@/lib/standings";

// Public profile + career stats, grouped per game (and all games combined).
export async function GET(request, { params }) {
  const uid = params.uid;
  const userDoc = await db().collection("users").doc(uid).get();
  if (!userDoc.exists) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const { email, role, ...publicProfile } = userDoc.data();

  const entriesSnap = await db().collection("entries").where("user_id", "==", uid).get();
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const seasonIds = [...new Set(entries.map(e => e.season_id))];
  const seasonDocs = await Promise.all(seasonIds.map(id => db().collection("seasons").doc(id).get()));
  const seasons = Object.fromEntries(seasonDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

  const gameIds = [...new Set(Object.values(seasons).map(s => s.game_id).filter(Boolean))];
  const gameDocs = await Promise.all(gameIds.map(id => db().collection("games").doc(id).get()));
  const games = Object.fromEntries(gameDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

  // Results per entry, with points computed against that season's scale.
  const perGame = {};
  const allResults = [];
  for (const entry of entries) {
    const season = seasons[entry.season_id];
    if (!season) continue;
    let scale = DEFAULT_POINTS_SCALE;
    if (season.points_scale) {
      try {
        const parsed = typeof season.points_scale === "string" ? JSON.parse(season.points_scale) : season.points_scale;
        if (parsed && Object.keys(parsed).length) scale = parsed;
      } catch {}
    }
    const snap = await db().collection("results").where("entry_id", "==", entry.id).get();
    const results = snap.docs.map(d => {
      const r = d.data();
      return { ...r, points: pointsFor(r, scale) };
    });
    const gameId = season.game_id || "unknown";
    (perGame[gameId] ??= []).push(...results);
    allResults.push(...results);
  }

  const byGame = Object.entries(perGame).map(([gameId, results]) => ({
    game_id: gameId,
    game_name: games[gameId]?.name ?? "Unknown Game",
    game_logo_url: games[gameId]?.logo_url ?? null,
    stats: aggregateCareerStats(results),
  }));

  return NextResponse.json({
    uid,
    profile: publicProfile,
    all_games: aggregateCareerStats(allResults),
    by_game: byGame,
    seasons_raced: seasonIds.length,
  });
}
