import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { buildTrackProfile } from "@/lib/trackStatsServer";

const routes = makeDocRoutes(SPECS.tracks);
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;

export const dynamic = "force-dynamic";

// Public profile + historical stats for one venue: every race held here
// (linked by track_id, plus legacy free-text races that only named it),
// aggregated into a per-driver leaderboard and a list of past winners.
export async function GET(request, { params }) {
  const doc = await db().collection("tracks").doc(params.id).get();
  if (!doc.exists) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  const track = { id: doc.id, ...doc.data() };
  // Scope the stats to the selected Game/Series/Season (top-of-page dropdowns).
  const { searchParams } = new URL(request.url);
  const scope = {
    gameId: searchParams.get("game_id") || null,
    seriesId: searchParams.get("series_id") || null,
    seasonId: searchParams.get("season_id") || null,
  };
  const profile = await buildTrackProfile({ trackId: track.id, trackName: track.name, scope });
  return NextResponse.json({ track, ...profile });
}
