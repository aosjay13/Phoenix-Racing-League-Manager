import { NextResponse } from "next/server";
import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";

const routes = makeCollectionRoutes(SPECS.classes);
export const POST = routes.POST;

export const dynamic = "force-dynamic";

// The classes available in a scope, mirroring the Game / Series / Season
// dropdowns:
//
//   ?season_id=…   → that season's classes (the shape every writer expects:
//                    real doc ids, since creating and editing work on one
//                    season's docs)
//   ?series_id=…   → every class across that series' seasons
//   ?game_id=…     → …across that game's seasons
//   (none)         → …across the whole league
//
// Above season level the same category exists as a separate doc per season, so
// rows are collapsed by NAME: "GT3" in Season 3 and "GT3" in Season 4 become
// one row carrying both ids in `ids`. That's what lets the Class menu stay
// populated — and a class stay answerable — when no single season is selected.
// `id` is a representative doc id, so single-season callers keep working.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const seriesId = searchParams.get("series_id");
  const gameId = searchParams.get("game_id");
  const leagueId = getRequestLeagueId(request);

  if (seasonId) {
    const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
    return NextResponse.json(sortClasses(snap.docs.map(d => ({ id: d.id, ...d.data(), ids: [d.id] }))));
  }

  // Classes hang off seasons, so the wider scopes resolve through them.
  let seasonsQuery = db().collection("seasons");
  if (seriesId) seasonsQuery = seasonsQuery.where("series_id", "==", seriesId);
  else if (gameId) seasonsQuery = seasonsQuery.where("game_id", "==", gameId);
  else seasonsQuery = scopeByLeague(seasonsQuery, leagueId);
  const seasonIds = new Set((await seasonsQuery.get()).docs.map(d => d.id));
  if (!seasonIds.size) return NextResponse.json([]);

  // One read of the classes collection, filtered in memory: Firestore caps an
  // `in` query at 30 values, and a league's class list is small. No league
  // filter here on purpose — `seasonIds` already came from a league-scoped (or
  // explicitly game/series-scoped) query, so filtering by it is both sufficient
  // and safe for any class doc written before league_id was stamped.
  const snap = await db().collection("classes").get();
  const inScope = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => seasonIds.has(c.season_id));

  const byName = new Map();
  for (const c of inScope) {
    const name = String(c.name || "").trim();
    if (!name) continue;
    const row = byName.get(name);
    if (!row) {
      byName.set(name, { ...c, name, ids: [c.id] });
      continue;
    }
    row.ids.push(c.id);
    // Keep the lowest sort_order seen so menu order is stable whichever season
    // the name was first met in, and keep any car/colour a season bothered to
    // set even if the first one didn't.
    if (Number(c.sort_order || 0) < Number(row.sort_order || 0)) row.sort_order = c.sort_order;
    if (!row.car && c.car) row.car = c.car;
    if (!row.color && c.color) row.color = c.color;
  }
  return NextResponse.json(sortClasses([...byName.values()]));
}

function sortClasses(rows) {
  return rows.sort((a, b) =>
    (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}
