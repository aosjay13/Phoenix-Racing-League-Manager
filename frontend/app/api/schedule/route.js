import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { globalSchedule, seasonSchedule } from "@/lib/statsBuilders";

export const dynamic = "force-dynamic";

// The Schedule table. ?season_id=… is one season's calendar; without it, the
// master feed across every season (optionally narrowed to a game or series).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const leagueId = getRequestLeagueId(request);

  const { status, body } = seasonId
    ? await seasonSchedule(leagueId, {
      seasonId,
      classId: searchParams.get("class_id") || "",
      className: searchParams.get("class_name") || "",
    })
    : await globalSchedule(leagueId, {
      gameId: searchParams.get("game_id") || "",
      seriesId: searchParams.get("series_id") || "",
    });
  return NextResponse.json(body, { status });
}
