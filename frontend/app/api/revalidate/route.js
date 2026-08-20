import { NextResponse } from "next/server";
import { STATS_TAG, leagueStatsTag, revalidateStats } from "@/lib/statsCache";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Drop the cached league reads by hand.
//
// Nothing in the app needs to call this: every write that can move a number
// already drops the cache itself, server-side, in the same request that made
// the change (see lib/statsCache.js and the callers of revalidateStats). Doing
// it there rather than asking the browser to follow up is deliberate — a
// follow-up call can be lost to a closed tab, a dropped connection or a
// navigation, and a lost one leaves the league reading stale standings.
//
// This route is the manual override for when that is not enough: a restore, a
// direct edit in the Firebase console, or an admin who simply wants to be sure.
//
// ADMIN-ONLY, and that is not paperwork. Purging is the expensive direction:
// every purge makes the next read recompute the championship from scratch, so
// an open endpoint here would be a button for running up the very compute bill
// this cache exists to bring down.
export const POST = withAdmin(async (request) => {
  const tag = new URL(request.url).searchParams.get("tag") || STATS_TAG;
  const leagueId = getRequestLeagueId(request);

  // Only this app's own tags. An arbitrary tag from the query string is a
  // stranger's cache to invalidate, not ours.
  const allowed = [STATS_TAG, leagueStatsTag(leagueId)];
  if (!allowed.includes(tag)) {
    return NextResponse.json(
      { error: `Unknown cache tag. Expected one of: ${allowed.join(", ")}` },
      { status: 400 },
    );
  }

  revalidateStats(leagueId);
  return NextResponse.json({ revalidated: allowed, at: new Date().toISOString() });
});
