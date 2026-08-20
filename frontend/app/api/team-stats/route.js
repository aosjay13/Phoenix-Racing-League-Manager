import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { teamStatsFor } from "@/lib/statsBuilders";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wanted = (searchParams.get("team") || searchParams.get("team_id") || searchParams.get("name") || "").trim();
  if (!wanted) return NextResponse.json({ error: "team required" }, { status: 400 });

  const { status, body } = await teamStatsFor(getRequestLeagueId(request), { team: wanted });
  return NextResponse.json(body, { status });
}
