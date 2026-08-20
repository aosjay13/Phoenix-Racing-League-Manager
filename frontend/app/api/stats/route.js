import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { statsFor } from "@/lib/statsBuilders";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { status, body } = await statsFor(getRequestLeagueId(request), {
    scope: searchParams.get("scope") || "league",
    classId: searchParams.get("class_id") || "",
    // A class NAME is the cross-season identity: above one season, "GT3" is a
    // separate doc per season, so the name is resolved to each season's own ids.
    className: searchParams.get("class_name") || "",
    gameId: searchParams.get("game_id") || "",
    seriesId: searchParams.get("series_id") || "",
    seasonId: searchParams.get("season_id") || "",
  });
  return NextResponse.json(body, { status });
}
