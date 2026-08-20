import { db } from "@/lib/firebase";
import { builderFor } from "@/lib/statsBuilders";
import { STATS_COLLECTION, writeStored } from "@/lib/statsStore";

// Recompute the league's stored answers after a write, so the calculation lands
// on the admin who caused it rather than on the next visitor.
//
// ── Which scopes get rebuilt, and why it is exactly the right set ──────────
//
// Only scopes that ALREADY HAVE a stored document. That sounds like a shortcut
// and is in fact the precise answer: a document exists for a scope if and only
// if somebody has opened that view at least once. Views nobody looks at never
// acquire a document, so they are never rebuilt and cost nothing — and if
// somebody does open one later, the read path computes it live and files it,
// which is where its document comes from in the first place.
//
// So the work is bounded by what the league actually looks at rather than by
// the combinatorial space of game x series x season x class, which is what
// would make rebuilding-everything unaffordable.
//
// ── Nothing here touches league data ──────────────────────────────────────
//
// Reads of results/entries/races/seasons to do the maths, writes ONLY to the
// derived collection. A failure leaves the league's data exactly as the save
// left it.
export const REBUILD_BUDGET = 60;

// Never throws into the caller. By the time this runs the admin's save is
// committed, and a derived copy failing to refresh must not report that save as
// having failed — the rule lib/skillRatingServer.js and postMessage() follow.
export async function rebuildStats(leagueId) {
  const summary = { rebuilt: 0, unchanged: 0, dropped: 0, failed: 0 };
  try {
    const snap = await db().collection(STATS_COLLECTION)
      .where("league_id", "==", leagueId || null)
      .get();

    // Oldest first, so if a league somehow exceeds the budget the things that
    // have been stale longest are the ones that get refreshed.
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.built_at ?? "").localeCompare(String(b.built_at ?? "")));

    for (const [i, doc] of docs.entries()) {
      // Past the budget, DROP rather than leave behind. A dropped document is
      // not lost data — it is a discarded copy, and the read path recomputes it
      // from the league's own records the next time anyone asks. Leaving a
      // stale one in place would be the only genuinely harmful option here,
      // because that one would be served as though it were current.
      if (i >= REBUILD_BUDGET) {
        try {
          await db().collection(STATS_COLLECTION).doc(doc.id).delete();
          summary.dropped++;
        } catch { summary.failed++; }
        continue;
      }

      const build = builderFor(doc.name);
      if (!build) {
        // A builder that no longer exists (renamed, removed). Drop the orphan so
        // nothing serves an answer no code can still produce.
        try {
          await db().collection(STATS_COLLECTION).doc(doc.id).delete();
          summary.dropped++;
        } catch { summary.failed++; }
        continue;
      }

      try {
        const built = await build(leagueId, doc.params || {});
        if (built?.status !== 200) { summary.failed++; continue; }
        const res = await writeStored(doc.name, leagueId, doc.params || {}, built);
        if (res.written) summary.rebuilt++; else summary.unchanged++;
      } catch (err) {
        console.error(`Rebuilding ${doc.name} failed`, err);
        summary.failed++;
      }
    }
  } catch (err) {
    console.error("Rebuilding the league's stats failed", err);
  }
  return summary;
}
