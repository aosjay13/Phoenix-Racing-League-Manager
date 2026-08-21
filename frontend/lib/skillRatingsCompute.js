// Skill Ratings leaderboard — drivers ranked by their SR in ONE game, computed
// in the browser.
//
// This is the code that used to run inside GET /api/skill-ratings, moved rather
// than rewritten. A rating is the game's whole history replayed chronologically
// from the 1500 baseline (see lib/skillRatingReplay.js), which made this a
// full-history read on every visit — the browser replays it now, off a raw
// bundle fetched at game scope.
//
//   scope=game&game_id=…     → every driver rated in that game
//   scope=series&series_id=… → …restricted to those who raced in that series
//   scope=season&season_id=… → …restricted to those who raced in that season
//   scope=league             → rejected: "All Games" has no single rating
//
// SR is gated per game (a driver's GT7 rating is independent of their iRacing
// rating), so a game must always be in scope, and a narrowed series/season scope
// only changes which drivers are LISTED — each still shows their game-wide
// rating, because SR follows a driver across a game's series. That is why the
// bundle this reads is always the whole game's, whatever the dropdowns say.

import { replaySkillRatings } from "@/lib/skillRatingReplay";
import { SR_BASELINE } from "@/lib/skillRating";
import { driverNames, indexBundle } from "@/lib/rawIndex";

// One game's ratings, replayed out of whatever seasons the bundle holds for it.
// Split out because two screens want it: the leaderboard below, and a driver's
// profile, which asks for every game they have raced.
export function replayGame(index, gameId) {
  const bundle = index.bundle;
  const seasons = index.seasons.filter(s => (s.game_id || null) === gameId);
  const seasonIds = new Set(seasons.map(s => s.id));
  const inGame = rows => rows.filter(r => seasonIds.has(r.season_id));
  return replaySkillRatings({
    seasons,
    results: inGame(bundle.results || []),
    entries: inGame(bundle.entries || []),
    races: inGame(bundle.races || []),
  });
}

// A driver's per-game Skill Ratings, strongest first — the profile's "Skill
// Ratings" section. Rating and trend come from the same chronological replay the
// leaderboard uses, so the two always agree and neither depends on the order
// results were entered. A game the driver raced but that never moved their SR
// shows the 1500 baseline as unranked.
//
// `games` is the driver's career by_game list, so this only replays games they
// actually appear in.
export function driverGameRatings(index, driverId, games = []) {
  return games.map(g => {
    const rec = driverId ? replayGame(index, g.game_id).ratings[driverId] : null;
    return {
      game_id: g.game_id,
      game_name: g.game_name,
      game_logo_url: g.game_logo_url ?? null,
      rating: rec ? rec.rating : SR_BASELINE,
      ranked: !!rec,
      last_delta: rec ? rec.last_delta : null,
    };
  }).sort((a, b) => b.rating - a.rating);
}

export function buildSkillRatings(index, { scope = "league", gameId = "", seriesId = "", seasonId = "" } = {}) {
  const bundle = index.bundle;

  // Resolve the game (which per-game rating to show) plus, for narrower scopes,
  // the specific seasons whose participants should be listed.
  let game = null;
  let scopeSeasonIds = null; // null = list everyone rated in the game
  if (scope === "season") {
    if (!seasonId) return { status: 400, body: { error: "season_id required" } };
    const season = index.seasonById[seasonId];
    if (!season) return { status: 404, body: { error: "Season not found" } };
    game = season.game_id || null;
    scopeSeasonIds = new Set([seasonId]);
  } else if (scope === "series") {
    if (!seriesId) return { status: 400, body: { error: "series_id required" } };
    const series = index.seriesById[seriesId];
    if (!series) return { status: 404, body: { error: "Series not found" } };
    game = series.game_id || null;
    scopeSeasonIds = new Set(index.seasons.filter(s => s.series_id === seriesId).map(s => s.id));
  } else if (scope === "game") {
    game = gameId || null;
    if (!game) return { status: 400, body: { error: "game_id required" } };
  } else {
    // Whole-league scope has no single game and therefore no comparable rating.
    return { status: 400, body: { error: "Select a game to view Skill Ratings", requires_game: true, count: 0, rows: [] } };
  }

  if (!game) {
    return { status: 400, body: { error: "This scope isn't tied to a game yet.", requires_game: true, count: 0, rows: [] } };
  }

  // Authoritative ratings + trend for this game, replayed chronologically. The
  // bundle is the game's, so every season that can move a rating is present —
  // replaying a subset would hand a driver a rating that depends on which page
  // they were looked at from.
  const { ratings, seasonsByDriver } = replayGame(index, game);

  const nameById = {};
  for (const d of bundle.drivers || []) nameById[d.id] = { driver_name: d.name || "Unknown", user_id: d.user_id || null };
  // This board only ever shows one game, so each driver appears under the name
  // they're shown under in that game, with their overall name kept alongside.
  const names = driverNames(bundle, Object.keys(ratings), game);

  let rows = Object.entries(ratings)
    // Narrower scope: keep only drivers who raced an SR event in its seasons.
    .filter(([driverId]) => {
      if (!scopeSeasonIds) return true;
      const raced = seasonsByDriver[driverId];
      return !!raced && [...raced].some(sid => scopeSeasonIds.has(sid));
    })
    .map(([driverId, rec]) => ({
      driver_id: driverId,
      driver_name: names[driverId]?.display || nameById[driverId]?.driver_name || "Unknown",
      profile_name: names[driverId]?.overall || nameById[driverId]?.driver_name || "Unknown",
      game_alias: names[driverId]?.game ?? null,
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

  return { status: 200, body: { scope, game_id: game, count: rows.length, rows } };
}

export function skillRatingsFromBundle(bundle, params) {
  return buildSkillRatings(indexBundle(bundle), params);
}
