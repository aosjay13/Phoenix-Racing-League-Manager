import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { fetchScopeClasses, fetchSeasonClasses } from "@/lib/classServer";

const routes = makeCollectionRoutes(SPECS.classes);
export const POST = routes.POST;

// Classes for whatever scope the Class dropdown is sitting in:
//   ?season_id=…   → that season's own class docs (the editable list)
//   ?series_id=…   → every class run by the series' seasons
//   ?game_id=…     → every class run by the game's seasons
//   (nothing)      → every class in the active league
//
// A class doc belongs to ONE season, so the wider scopes collapse same-named
// classes ("GT3" in every season that runs it) into a single row carrying every
// matching id in `class_ids` — see resolveClassScope in lib/classServer.js,
// which widens the chosen id back out when the stats are aggregated.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (seasonId) return NextResponse.json(await fetchSeasonClasses(seasonId));

  const seriesId = searchParams.get("series_id");
  const gameId = searchParams.get("game_id");
  let query = db().collection("seasons");
  if (seriesId) query = query.where("series_id", "==", seriesId);
  else if (gameId) query = query.where("game_id", "==", gameId);
  query = scopeByLeague(query, getRequestLeagueId(request));

  const snap = await query.get();
  return NextResponse.json(await fetchScopeClasses(snap.docs.map(d => d.id)));
}
