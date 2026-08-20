import { NextResponse } from "next/server";
import { getRequestLeagueId, withOwner } from "@/lib/serverAuth";
import { refreshStats } from "@/lib/statsRefresh";

export const dynamic = "force-dynamic";

// Rebuild this league's precomputed stats by hand.
//
// Saves keep these current on their own, so this is for the times that isn't
// enough: after restoring a backup, after a deploy that changes how scoring
// works (bump STATS_BUILD_VERSION and press this), or simply to prove the
// numbers on screen are what the source data says.
//
// It is never destructive. Every answer is rebuilt from the league's own
// records — the same calculation a visitor would have triggered — so the worst
// this can do is spend some CPU arriving at the numbers already on screen.
export const POST = withOwner(async (request) => {
  const started = Date.now();
  const summary = await refreshStats(getRequestLeagueId(request));
  return NextResponse.json({ ...summary, took_ms: Date.now() - started });
});
