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
  const profile = await buildTrackProfile({ trackId: track.id, trackName: track.name });
  return NextResponse.json({ track, ...profile });
}
