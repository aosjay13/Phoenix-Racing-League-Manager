import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { standingsFor } from "@/lib/statsBuilders";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const { status, body } = await standingsFor(getRequestLeagueId(request), {
    seasonId,
    classId: searchParams.get("class_id") || "",
    className: searchParams.get("class_name") || "",
  });
  return NextResponse.json(body, { status });
}
