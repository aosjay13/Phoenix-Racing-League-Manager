import { getRequestLeagueId } from "@/lib/serverAuth";
import { revalidateStats } from "@/lib/statsCache";
import { rebuildStats } from "@/lib/statsRebuild";

// What happens to the derived stats after an admin changes something.
//
// In its own module because the pieces it joins import each other otherwise:
// the builders are wrapped by the cache, the rebuild drives the builders, so
// the cache cannot also reach for the rebuild without a cycle. This is the one
// place that knows about both.

// Recompute the league's stored answers, then drop the in-process cache so the
// next read picks the fresh ones up.
//
// Order matters: rebuild first. Revalidating first would open a window where a
// reader arrives, finds no cached entry, and pays for the calculation itself —
// which is the whole thing this exists to prevent.
export async function refreshStats(leagueId) {
  const summary = await rebuildStats(leagueId);
  revalidateStats(leagueId);
  return summary;
}

// Wrap a write handler so a SUCCESSFUL write refreshes the derived stats.
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
    if (!res || res.status < 400) await refreshStats(getRequestLeagueId(request));
    return res;
  };
}
