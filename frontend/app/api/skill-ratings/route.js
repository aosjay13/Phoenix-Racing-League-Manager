import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { ratingForGame } from "@/lib/skillRating";

export const dynamic = "force-dynamic";

// Skill Ratings leaderboard — drivers ranked by their SR in ONE game. SR is
// gated per game (a driver's GT7 rating is independent of their iRacing rating),
// so a game must always be in scope. Driven by the shared Game / Series / Season
// dropdowns:
//   scope=game&game_id=…     → drivers who started an SR race in that game
//   scope=series&series_id=… → …in that series (game inferred from the series)
//   scope=season&season_id=… → …in that season (game inferred from the season)
//   scope=league             → rejected: "All Games" has no single rating to show
// The rating shown is always the driver's rating in the resolved game; a
// narrowed series/season scope only decides which drivers are listed and their
// in-scope race count / most-recent trend.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  // Resolve both the game (which per-game rating to show) and the seasons in
  // scope (which drivers to list). Every valid scope resolves to exactly one
  // game_id — SR is meaningless across games.
  let gameId = null;
  let seasonIds = null;
  if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(seasonId).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    gameId = doc.data().game_id || null;
    seasonIds = [seasonId];
  } else if (scope === "series") {
    const seriesId = searchParams.get("series_id");
    if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    const doc = await db().collection("series").doc(seriesId).get();
    if (!doc.exists) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    gameId = doc.data().game_id || null;
    const snap = await db().collection("seasons").where("series_id", "==", seriesId).get();
    seasonIds = snap.docs.map(d => d.id);
  } else if (scope === "game") {
    gameId = searchParams.get("game_id");
    if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
    const snap = await db().collection("seasons").where("game_id", "==", gameId).get();
    seasonIds = snap.docs.map(d => d.id);
  } else {
    // Whole-league scope has no single game and therefore no comparable rating.
    return NextResponse.json({ error: "Select a game to view Skill Ratings", requires_game: true, count: 0, rows: [] }, { status: 400 });
  }

  if (!gameId) {
    return NextResponse.json({ error: "This scope isn't tied to a game yet.", requires_game: true, count: 0, rows: [] }, { status: 400 });
  }

  // Base rows: every global driver with their SR in this game (baseline when
  // they've never been rated in it).
  const driversSnap = await db().collection("drivers").get();
  const drivers = {};
  for (const d of driversSnap.docs) {
    const data = d.data();
    drivers[d.id] = {
      driver_id: d.id,
      driver_name: data.name || "Unknown",
      user_id: data.user_id || null,
      skill_rating: ratingForGame(data.skillRatings, gameId),
      total_races: 0,
      last_delta: null,
      _lastAt: null,
    };
  }

  // A game/series scope with no seasons yet has nothing to rank.
  if (!seasonIds.length) {
    return NextResponse.json({ scope, game_id: gameId, count: 0, rows: [] });
  }

  // Gather the results (with sr_delta), entries (result → global driver) and
  // races (for recency) within scope.
  const resultDocs = [];
  const entryDocs = [];
  const raceDocs = [];
  const perSeason = await Promise.all(seasonIds.map(async sid => {
    const [r, e, ra] = await Promise.all([
      db().collection("results").where("season_id", "==", sid).get(),
      db().collection("entries").where("season_id", "==", sid).get(),
      db().collection("races").where("season_id", "==", sid).get(),
    ]);
    return { r: r.docs, e: e.docs, ra: ra.docs };
  }));
  for (const p of perSeason) { resultDocs.push(...p.r); entryDocs.push(...p.e); raceDocs.push(...p.ra); }

  const driverByEntry = {};
  for (const e of entryDocs) { const id = e.data().driver_id; if (id) driverByEntry[e.id] = id; }
  const raceDate = {};
  for (const ra of raceDocs) raceDate[ra.id] = ra.data().date || null;

  const seen = new Set();
  for (const doc of resultDocs) {
    const r = doc.data();
    if (r.sr_delta == null) continue; // only SR-bearing main-race results
    const driverId = driverByEntry[r.entry_id];
    const row = drivers[driverId];
    if (!row) continue;
    row.total_races += 1;
    seen.add(driverId);
    // Most-recent trend: by race date, breaking ties on the result's save time.
    const at = `${raceDate[r.race_id] || ""}|${r.created_at || ""}`;
    if (row._lastAt == null || at >= row._lastAt) {
      row._lastAt = at;
      row.last_delta = Number(r.sr_delta);
    }
  }

  // List only drivers who actually raced an SR event in this scope.
  let rows = Object.values(drivers).filter(r => seen.has(r.driver_id));
  rows.sort((a, b) =>
    b.skill_rating - a.skill_rating ||
    b.total_races - a.total_races ||
    String(a.driver_name).localeCompare(String(b.driver_name))
  );
  rows = rows.map((r, i) => {
    const { _lastAt, ...rest } = r;
    return { rank: i + 1, ...rest };
  });

  return NextResponse.json({ scope, game_id: gameId, count: rows.length, rows });
}
