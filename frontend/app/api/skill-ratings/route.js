import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { skillRatingsFor } from "@/lib/statsBuilders";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { status, body } = await skillRatingsFor(getRequestLeagueId(request), {
    scope: searchParams.get("scope") || "league",
    gameId: searchParams.get("game_id") || "",
    seriesId: searchParams.get("series_id") || "",
    seasonId: searchParams.get("season_id") || "",
  });
  return NextResponse.json(body, { status });
}
