import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { syncEntryNamesForDriver } from "@/lib/driverSync";
import { withStatsRefresh } from "@/lib/statsRefresh";

export const dynamic = "force-dynamic";

// One-time (re-runnable) backfill: walk every pool driver in the active league
// and push their current canonical name onto all of their roster entries. This
// heals historical desync where an entry's stored name lagged behind a Driver
// Profile rename. Idempotent and additive — it only rewrites the denormalized
// entry.name string and never touches results, stats, or profiles. Returns how
// many drivers/entries were updated so the result is verifiable.
const handlePOST = withAdmin(async (request) => {
  const driversSnap = await scopeByLeague(db().collection("drivers"), getRequestLeagueId(request)).get();
  let entriesSynced = 0;
  let driversTouched = 0;
  for (const d of driversSnap.docs) {
    let n = 0;
    try { n = await syncEntryNamesForDriver(d.id, d.data()); } catch (err) { console.error("sync-names failed for", d.id, err); }
    if (n > 0) { entriesSynced += n; driversTouched += 1; }
  }
  return NextResponse.json({ ok: true, drivers: driversSnap.size, drivers_touched: driversTouched, entries_synced: entriesSynced });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
