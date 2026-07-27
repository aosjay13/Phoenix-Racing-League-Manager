import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { decorateSessionFlags } from "@/lib/standings";
import { summarizeRace } from "@/lib/raceSummaryServer";
import { fetchSeasonClasses, filterRacesByClass, carForClass, carsByClassForRace } from "@/lib/classServer";

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

  if (seasonId) return oneSeason(seasonId, searchParams.get("class_id") || "");
  return globalFeed(searchParams.get("game_id"), searchParams.get("series_id"), getRequestLeagueId(request));
}

// One season's calendar. `classId` narrows it to that class's schedule: the
// events pinned to the class plus every shared (unpinned) event. "All Classes"
// returns the whole calendar. Each row carries `class_name` so a mixed schedule
// shows at a glance which events are class-specific.
async function oneSeason(seasonId, classId = "") {
  const [seasonDoc, racesSnap, entriesSnap, resultsSnap, classes] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("races").where("season_id", "==", seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
    fetchSeasonClasses(seasonId),
  ]);

  const season = seasonDoc.exists ? { id: seasonDoc.id, ...seasonDoc.data() } : null;
  const allRaces = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const races = filterRacesByClass(allRaces, classId);
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  // Summaries resolve results by race, so the map must cover every race the
  // results reference — build it from the unfiltered list.
  const racesById = Object.fromEntries(allRaces.map(r => [r.id, r]));
  const results = decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById);
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));

  const viewClass = classId ? classes.find(c => c.id === classId) ?? null : null;
  // Inside a class, each row's summary is that class's own race: its pole, its
  // winner, its field, and its car. Events split by class have several winners,
  // so an unscoped summary would show whoever happened to be P1 in another
  // class. At "All Classes" a round where the classes run different machinery
  // carries `class_cars` instead, so the calendar still shows which car goes
  // with which class rather than collapsing to one of them.
  // The class whose car a row falls back on: the one being viewed, else the one
  // the round is pinned to (a Pro-only round shows Pro's car at "All Classes"),
  // else none — leaving the season default.
  const carClassFor = r => viewClass ?? (r.class_id ? classes.find(c => c.id === r.class_id) ?? null : null);
  const rows = races.map(r => ({
    ...r,
    class_name: r.class_id ? (classNameById[r.class_id] ?? null) : null,
    class_cars: viewClass ? [] : carsByClassForRace(r, season, classes),
    summary: summarizeRace(r, results, entriesById, carForClass(season, carClassFor(r)), classId),
  }));
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
