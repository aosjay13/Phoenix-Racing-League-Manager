import { NextResponse } from "next/server";
import { fetchRawBundle } from "@/lib/rawBundle";
import { getRequestLeagueId } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Raw documents for one scope, straight out of Firestore.
//
//   ?scope=season&season_id=…    one season — championship tables, its calendar
//   ?scope=race&race_id=…        the season around one event, resolved from it
//   ?scope=game&game_id=…        every season in a game — Skill Ratings, stats
//   ?scope=series&series_id=…    every season in a series
//   ?scope=league                the whole league — the all-time tables
//
// This handler does no arithmetic of any kind. It reads, it serializes, it
// returns; the championship maths that used to live behind /api/standings,
// /api/stats, /api/team-stats, /api/skill-ratings and /api/schedule now runs in
// the browser over this payload (see lib/rawBundle.js for the why, and
// lib/*Compute.js for the code that moved).
//
// ── Caching ───────────────────────────────────────────────────────────────
//
// The response is a pure function of (league, scope) — same inputs, same bytes,
// no per-user content — so it is marked cacheable and Vercel's CDN serves the
// repeats. That is the part that actually removes the function invocation:
// shifting the maths to the browser stops the server SCORING the league, and
// the edge cache stops it being asked at all. `stale-while-revalidate` means a
// visitor after an admin's save gets the previous bundle instantly while the
// fresh one is fetched behind them, rather than waiting on the read.
//
// League scoping travels in the query string, not the X-League-Id header,
// precisely so it is part of the cache key — a CDN keys on the URL, and a
// header-scoped response would serve one league's data to another.
const CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=600";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { status, body } = await fetchRawBundle(getRequestLeagueId(request), {
    scope: searchParams.get("scope") || "league",
    gameId: searchParams.get("game_id") || "",
    seriesId: searchParams.get("series_id") || "",
    seasonId: searchParams.get("season_id") || "",
    raceId: searchParams.get("race_id") || "",
    // Optional extra pools, e.g. `&include=time_trials` for the venue page's
    // hot-lap records. Part of the URL, so it is part of the cache key.
    include: searchParams.get("include") || "",
  });
  return NextResponse.json(body, {
    status,
    headers: status === 200 ? { "Cache-Control": CACHE_CONTROL } : undefined,
  });
}
