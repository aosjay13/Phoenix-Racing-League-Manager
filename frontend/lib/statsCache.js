import { revalidateTag, unstable_cache } from "next/cache";
import { getRequestLeagueId } from "@/lib/serverAuth";

// The write-side half of read caching: the tag every write that can move a
// number drops, and the wrapper that makes a route drop it.
//
// ── What changed, and why this is still here ───────────────────────────────
//
// This module used to front five expensive read routes — standings, stats,
// team-stats, skill-ratings and the schedule feed — each of which scored the
// league on the read path. Those routes are gone. The maths runs in the
// browser now, over raw documents (see lib/rawBundle.js), and the read path's
// cache is the CDN: /api/raw is a pure function of (league, scope) and says so
// in a Cache-Control header, so repeats are served at the edge without waking a
// function at all.
//
// So `cachedPayload` below currently has no callers. It is kept, along with the
// invalidation wiring on every write route, because the CONTRACT is the valuable
// part and it is expensive to re-establish:
//
//   every route that writes something a cached read is built from
//   must drop the cache.
//
// lib/__tests__/statsCache.test.mjs enforces that structurally, over every route
// file in the tree, so a new write route cannot quietly skip it. A cache that is
// fast and wrong is worse than no cache — miss one write path and a league sits
// looking at numbers that quietly disagree with its own results — and the moment
// anything server-side is cached again, it inherits a rule that is already
// wired up and already tested rather than one somebody has to remember.
//
// ── If you cache a server read again ──────────────────────────────────────
//
// Wrap it in cachedPayload and it is invalidated correctly from day one. Note
// the size limit that pushed the raw bundle to the CDN instead: Vercel's data
// cache refuses items over a couple of megabytes, and a league-scope bundle is
// comfortably past that.
//
// The TTL below is a BACKSTOP, not the mechanism. It decides how long a missed
// invalidation can go unnoticed; cached "indefinitely" would make a single
// missed call permanent, and stale numbers that never heal are worse than a
// recalculation nobody was going to notice.
export const STATS_TAG = "stats-data";

// Six hours. Long enough that a league racing weekly effectively never pays for
// it, short enough that a bug in the invalidation wiring shows up the same day.
export const STATS_TTL_SECONDS = 6 * 60 * 60;

// The collections whose contents feed the cached reads. A route that writes any
// of these has to invalidate — lib/__tests__/statsCache.test.mjs holds every
// route to that, so a new one cannot quietly skip it.
export const STATS_COLLECTIONS = Object.freeze([
  "results", "entries", "races", "seasons", "classes",
  "series", "games", "drivers", "teams", "team_seasons", "points_templates",
]);

// A league's own slice of the cache. Entries carry this alongside the global
// tag so a future change can purge one league without touching the others.
export function leagueStatsTag(leagueId) {
  return `${STATS_TAG}:${leagueId || "unscoped"}`;
}

// The cache key for one read. Sorted, so two callers that build the same query
// with their keys in a different order share an entry rather than each paying
// for their own; JSON-encoded as pairs, so no combination of values can be
// spelled two ways or collide with another (a param holding "a|b" is not the
// same key as two params "a" and "b").
export function cacheKeyFor(name, leagueId, params = {}) {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return [name, leagueId || "", JSON.stringify(pairs)];
}

// unstable_cache needs Next's incremental cache, which exists inside a running
// server and nowhere else — the unit suites and the CPU profiler import route
// handlers directly, and a test run must not be the reason a route throws.
// Only THIS failure falls through to computing directly; anything else is a
// real error and is left to propagate.
function cacheUnavailable(err) {
  return /incrementalCache missing|static generation store/i.test(String(err?.message ?? ""));
}

// Wrap a computation so it is cached per (name, league, params).
//
// `compute` is handed (leagueId, params) and must return a plain, serializable
// payload — no Request, no NextResponse, nothing that closes over the incoming
// request. That is the whole contract: given the same league and the same
// params it must return the same thing, or caching it would be a bug.
export function cachedPayload(name, compute) {
  return async (leagueId, params = {}) => {
    const run = () => compute(leagueId, params);
    try {
      return await unstable_cache(run, cacheKeyFor(name, leagueId, params), {
        tags: [STATS_TAG, leagueStatsTag(leagueId)],
        revalidate: STATS_TTL_SECONDS,
      })();
    } catch (err) {
      if (cacheUnavailable(err)) return run();
      throw err;
    }
  };
}

// Drop the cached reads after a write that can move a number.
//
// Deliberately purges the GLOBAL tag as well as the league's own. Narrower
// would be cheaper, but "which leagues could this write have affected?" is a
// question with a subtle answer — an account, a driver profile or a game can be
// shared — and getting it wrong leaves a league looking at numbers that are
// quietly wrong. Recomputing another league's standings costs a few hundred
// milliseconds; showing stale ones costs trust.
//
// NEVER throws into the caller. By the time this runs the admin's change is
// already saved, and failing to drop a cache entry must not report that save as
// having failed — the same rule postMessage() and the entityApi afterUpdate
// hook already follow. The TTL above is what catches whatever this misses.
export function revalidateStats(leagueId = null) {
  for (const tag of [STATS_TAG, ...(leagueId ? [leagueStatsTag(leagueId)] : [])]) {
    try {
      revalidateTag(tag);
    } catch (err) {
      if (!cacheUnavailable(err)) console.error(`Dropping the ${tag} cache failed`, err);
    }
  }
}

// Wrap a write handler so a SUCCESSFUL write drops the cached reads.
//
// Wrapping rather than calling revalidateStats() by hand somewhere inside each
// handler, for two reasons. It fires on the way out, so it sees the status and
// a refused write — a 403 from the wrong league, a 404 for a race that is gone,
// a 400 for a bad body — costs nothing, where a hand-placed call has to be put
// after every early return to get that right. And it cannot be put in the wrong
// place, because there is only one place it can go.
//
// The generic collection routes do NOT use this: they know which collection
// they are writing, so they can skip the purge for the ones no cached read is
// built from (see statsChanged in lib/entityApi.js). The handlers here each
// write a specific, known-relevant thing, so they always purge.
export function withStatsRefresh(handler) {
  return async (request, ctx) => {
    const res = await handler(request, ctx);
    if (!res || res.status < 400) revalidateStats(getRequestLeagueId(request));
    return res;
  };
}
