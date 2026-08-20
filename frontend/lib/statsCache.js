import { revalidateTag, unstable_cache } from "next/cache";
import { readStored, writeStored } from "@/lib/statsStore";
import { cacheKeyFor } from "@/lib/statsKey";
import { getRequestLeagueId } from "@/lib/serverAuth";

// The read-path cache for the expensive league-wide reads: standings, stats,
// team stats, the schedule feed and skill ratings.
//
// ── Why the cache holds the OUTPUT of the scoring code ─────────────────────
//
// The obvious way to keep championship maths off the read path is to compute it
// when an admin saves a result and store the answer in an aggregate document.
// The trouble is that the scoring rules are not small — points templates, drop
// weeks, per-class championships, session flags, bonuses, team roll-ups — and a
// second implementation of them on the write path is a second thing that can be
// wrong. When the two disagree, the stored number wins and nobody finds out.
//
// So what is stored here is the output of the SAME code the app has always run.
// A cache entry cannot disagree with a live calculation, because it IS one,
// kept. Reads pay a lookup; the first read after a change pays the calculation
// once and every read after that is free until the next change.
//
// ── Freshness ─────────────────────────────────────────────────────────────
//
// Every write that can move a number calls revalidateStats(), which drops the
// tag and makes the next read recompute. The TTL below is a BACKSTOP, not the
// mechanism: it decides how long a missed invalidation can go unnoticed. Cached
// "indefinitely" would make a single missed call permanent, and stale standings
// that never heal are worse than a recalculation nobody was going to notice.
export { cacheKeyFor };

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
    // Three layers, cheapest first.
    //
    //   1. this request's process already has the answer  → nothing to do
    //   2. an admin's save already worked it out          → one document read
    //   3. nobody has                                     → compute it, and keep
    //                                                       it so nobody has to
    //                                                       again
    //
    // Layer 3 is the one that matters for safety rather than speed: it means the
    // stored collection is entirely disposable. Delete every precomputed
    // document and each screen answers exactly as it always did, just slowly,
    // once, before filing the answer again.
    const run = async () => {
      const stored = await readStored(name, leagueId, params);
      if (stored) return stored;
      const built = await compute(leagueId, params);
      // Only successful answers are kept. A 400 for a missing parameter or a 404
      // for a season that isn't there costs nothing to work out again, and
      // storing one risks pinning a transient refusal in place.
      if (built?.status === 200) await writeStored(name, leagueId, params, built);
      return built;
    };
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
