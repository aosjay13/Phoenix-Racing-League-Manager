import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { decorateSessionFlags } from "@/lib/standings";
import { summarizeRace } from "@/lib/raceSummaryServer";

export const dynamic = "force-dynamic";

// Schedule listing enriched with the SimRacerHub-style summary each row needs
// (pole, winner, field size, distance). Two modes:
//
//   ?season_id=…                     → one season's events (the season view)
//   (no season_id) [?game_id / ?series_id]
//                                    → a master feed ACROSS seasons, so the
//                                      schedule page shows recent + upcoming
//                                      racing immediately at "All Games" /
//                                      "All Series", without drilling in. Rows
//                                      carry their game/series/season context.
//
// Kept separate from the generic /api/races feed so the heavier results/entries
// joins only run for the schedule table that consumes them.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");

  if (seasonId) return oneSeason(seasonId);
  return globalFeed(searchParams.get("game_id"), searchParams.get("series_id"), getRequestLeagueId(request));
}

async function oneSeason(seasonId) {
  const [seasonDoc, racesSnap, entriesSnap, resultsSnap] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("races").where("season_id", "==", seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
  ]);

  const seasonCar = seasonDoc.exists ? (seasonDoc.data().car || null) : null;
  const races = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const racesById = Object.fromEntries(races.map(r => [r.id, r]));
  const results = decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById);

  const rows = races.map(r => ({ ...r, summary: summarizeRace(r, results, entriesById, seasonCar) }));
  return NextResponse.json(rows);
}

// Master feed across every season (optionally scoped to a game or a series).
// Reads the collections whole — same shape as the league-wide Skill Ratings /
// stats endpoints — then joins races to their season/series/game for context.
async function globalFeed(gameId, seriesId, leagueId) {
  // Only the seasons read needs the league filter: races join through their
  // season, so an out-of-league race resolves to no in-scope season and is
  // dropped below. Games/series here are just name-lookup maps.
  const [gamesSnap, seriesSnap, seasonsSnap, racesSnap, entriesSnap, resultsSnap] = await Promise.all([
    db().collection("games").get(),
    db().collection("series").get(),
    scopeByLeague(db().collection("seasons"), leagueId).get(),
    db().collection("races").get(),
    db().collection("entries").get(),
    db().collection("results").get(),
  ]);

  const gameName = Object.fromEntries(gamesSnap.docs.map(d => [d.id, d.data().name || "Game"]));
  const series = Object.fromEntries(seriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const seasons = Object.fromEntries(seasonsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  // Which seasons are in scope, given the optional game/series filters.
  const seasonInScope = s => {
    if (!s) return false;
    if (seriesId) return s.series_id === seriesId;
    if (gameId) return s.game_id === gameId;
    return true;
  };

  const races = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const racesById = Object.fromEntries(races.map(r => [r.id, r]));
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const results = decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById);

  const rows = [];
  for (const r of races) {
    const season = seasons[r.season_id];
    if (!seasonInScope(season)) continue;
    const ser = season.series_id ? series[season.series_id] : null;
    rows.push({
      ...r,
      summary: summarizeRace(r, results, entriesById, season.car || null),
      season_id: season.id,
      season_name: season.name || "Season",
      series_id: ser?.id || null,
      series_name: ser?.name || null,
      game_id: season.game_id || null,
      game_name: season.game_id ? (gameName[season.game_id] || null) : null,
    });
  }
  return NextResponse.json(rows);
}
