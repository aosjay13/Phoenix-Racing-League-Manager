import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { computeGameSkillRatings } from "@/lib/skillRatingServer";

export const dynamic = "force-dynamic";

// Skill Ratings leaderboard — drivers ranked by their SR in ONE game. SR is
// gated per game (a driver's GT7 rating is independent of their iRacing rating),
// so a game must always be in scope. Driven by the shared Game / Series / Season
// dropdowns:
//   scope=game&game_id=…     → every driver rated in that game
//   scope=series&series_id=… → …restricted to those who raced in that series
//   scope=season&season_id=… → …restricted to those who raced in that season
//   scope=league             → rejected: "All Games" has no single rating to show
//
// Ratings and the +/- trend come from an authoritative chronological replay of
// the game's SR races (see computeGameSkillRatings) — NOT the incrementally
// stored per-result deltas — so they're consistent and order-independent. A
// narrowed series/season scope only changes which drivers are listed; each still
// shows their game-wide rating (SR follows a driver across a game's series).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  // Resolve the game (which per-game rating to show) plus, for narrower scopes,
  // the specific seasons whose participants should be listed.
  let gameId = null;
  let scopeSeasonIds = null; // null = list everyone rated in the game
  if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(seasonId).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    gameId = doc.data().game_id || null;
    scopeSeasonIds = new Set([seasonId]);
  } else if (scope === "series") {
    const seriesId = searchParams.get("series_id");
    if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    const doc = await db().collection("series").doc(seriesId).get();
    if (!doc.exists) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    gameId = doc.data().game_id || null;
    const snap = await db().collection("seasons").where("series_id", "==", seriesId).get();
    scopeSeasonIds = new Set(snap.docs.map(d => d.id));
  } else if (scope === "game") {
    gameId = searchParams.get("game_id");
    if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
  } else {
    // Whole-league scope has no single game and therefore no comparable rating.
    return NextResponse.json({ error: "Select a game to view Skill Ratings", requires_game: true, count: 0, rows: [] }, { status: 400 });
  }

  if (!gameId) {
    return NextResponse.json({ error: "This scope isn't tied to a game yet.", requires_game: true, count: 0, rows: [] }, { status: 400 });
  }

  // Authoritative ratings + trend for this game, replayed chronologically.
  const [{ ratings, seasonsByDriver }, driversSnap] = await Promise.all([
    computeGameSkillRatings(gameId),
    db().collection("drivers").get(),
  ]);
  const nameById = {};
  for (const d of driversSnap.docs) nameById[d.id] = { driver_name: d.data().name || "Unknown", user_id: d.data().user_id || null };

  let rows = Object.entries(ratings)
    // Narrower scope: keep only drivers who raced an SR event in its seasons.
    .filter(([driverId]) => {
      if (!scopeSeasonIds) return true;
      const raced = seasonsByDriver[driverId];
      return !!raced && [...raced].some(sid => scopeSeasonIds.has(sid));
    })
    .map(([driverId, rec]) => ({
      driver_id: driverId,
      driver_name: nameById[driverId]?.driver_name || "Unknown",
      user_id: nameById[driverId]?.user_id || null,
      skill_rating: rec.rating,
      total_races: rec.races,
      last_delta: rec.last_delta,
    }));

  rows.sort((a, b) =>
    b.skill_rating - a.skill_rating ||
    b.total_races - a.total_races ||
    String(a.driver_name).localeCompare(String(b.driver_name))
  );
  rows = rows.map((r, i) => ({ rank: i + 1, ...r }));

  return NextResponse.json({ scope, game_id: gameId, count: rows.length, rows });
}
