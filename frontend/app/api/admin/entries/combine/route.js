import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withAdmin } from "@/lib/serverAuth";
import { entryClassIds } from "@/lib/classServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// Combine one driver's duplicate roster entries in a season into a single
// multi-class entry.
//
// Before an entry could carry several classes, the only way to race a driver in
// Pro AND Am was to add them to the roster once per class — three entries with
// the same name, which is what made the roster look like it had lost track of
// them. This folds those back into one: the survivor keeps its name, number and
// team, gains every class the duplicates were in, and inherits their results.
//
// Results are MOVED, never deleted: each one keeps the class_id stamped on it
// when it was saved, so every class championship still scores exactly the races
// it always did. Only the emptied duplicate entries are removed.
const handlePOST = withAdmin(async (request, ctx, admin, role, leagueId) => {
  const { entry_ids } = await request.json();
  const ids = [...new Set((Array.isArray(entry_ids) ? entry_ids : []).filter(Boolean))];
  if (ids.length < 2) return NextResponse.json({ error: "Pick at least two entries to combine" }, { status: 400 });

  const docs = await Promise.all(ids.map(id => db().collection("entries").doc(id).get()));
  const entries = docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
  if (entries.length < 2) return NextResponse.json({ error: "Those entries no longer exist" }, { status: 404 });
  // Entries are named by id, so this is where staff-of-THIS-league is checked
  // against the rows being written. An id from another league reads as gone.
  if (entries.some(e => !docInLeague(e, leagueId))) {
    return NextResponse.json({ error: "Those entries no longer exist" }, { status: 404 });
  }

  // Only ever combine entries that are the same driver in the same season —
  // anything else would be merging two different people's results together.
  const seasonIds = new Set(entries.map(e => e.season_id || ""));
  if (seasonIds.size !== 1) return NextResponse.json({ error: "Entries must be in the same season" }, { status: 400 });
  const driverIds = new Set(entries.map(e => e.driver_id || ""));
  if (driverIds.size !== 1 || !entries[0].driver_id) {
    return NextResponse.json({ error: "Entries must all belong to the same driver profile" }, { status: 400 });
  }

  // The survivor is the entry with a car number if there is one (that's the
  // roster identity people recognise), else the first.
  const survivor = entries.find(e => e.number != null && e.number !== "") || entries[0];
  const losers = entries.filter(e => e.id !== survivor.id);

  // Every class across the set, survivor's first so its primary class is kept.
  const class_ids = [];
  for (const e of [survivor, ...losers]) {
    for (const cid of entryClassIds(e)) if (!class_ids.includes(cid)) class_ids.push(cid);
  }

  // Move the losers' results onto the survivor. A result carries its own
  // class_id, so a race scored in Pro stays a Pro race after the move; only
  // results saved with no class at all are stamped with the class of the entry
  // they came from, so they don't silently fall into the survivor's primary
  // class instead.
  let results_moved = 0;
  for (const loser of losers) {
    const snap = await db().collection("results").where("entry_id", "==", loser.id).get();
    const fallbackClass = entryClassIds(loser)[0] || "";
    for (let i = 0; i < snap.docs.length; i += 450) {
      const batch = db().batch();
      for (const d of snap.docs.slice(i, i + 450)) {
        const update = { entry_id: survivor.id };
        if (!d.data().class_id && fallbackClass) update.class_id = fallbackClass;
        batch.update(d.ref, update);
      }
      await batch.commit();
      results_moved += snap.docs.slice(i, i + 450).length;
    }
  }

  await db().collection("entries").doc(survivor.id).update({ class_ids, class_id: class_ids[0] || "" });
  for (const loser of losers) await db().collection("entries").doc(loser.id).delete();

  return NextResponse.json({
    ok: true,
    entry_id: survivor.id,
    class_ids,
    entries_removed: losers.length,
    results_moved,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
