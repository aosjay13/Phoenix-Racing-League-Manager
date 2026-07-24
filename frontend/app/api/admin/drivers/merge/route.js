import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { syncEntryNamesForDriver } from "@/lib/driverSync";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";

export const dynamic = "force-dynamic";

// Merge one pool driver INTO another. Re-points every roster entry from the
// losing (duplicate) driver onto the surviving one, renames those entries to
// the survivor's name, then deletes the loser's pool doc. Race results
// reference entries (not drivers) and are never touched, so all history and
// stats move across intact — this is the safe way to clean up a duplicate
// created by a mistyped name, with ZERO data loss.
export const POST = withAdmin(async (request) => {
  const { from_id, into_id } = await request.json();
  if (!from_id || !into_id) return NextResponse.json({ error: "from_id and into_id required" }, { status: 400 });
  if (from_id === into_id) return NextResponse.json({ error: "Pick two different drivers" }, { status: 400 });

  const [fromDoc, intoDoc] = await Promise.all([
    db().collection("drivers").doc(from_id).get(),
    db().collection("drivers").doc(into_id).get(),
  ]);
  if (!fromDoc.exists || !intoDoc.exists) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
  if ((fromDoc.data().league_id || null) !== (intoDoc.data().league_id || null)) {
    return NextResponse.json({ error: "Those drivers are in different leagues" }, { status: 400 });
  }

  // Re-point the loser's entries onto the survivor, remembering which seasons
  // (hence games) were affected so Skill Ratings can be replayed.
  const entriesSnap = await db().collection("entries").where("driver_id", "==", from_id).get();
  const seasonIds = new Set();
  for (let i = 0; i < entriesSnap.docs.length; i += 450) {
    const batch = db().batch();
    for (const d of entriesSnap.docs.slice(i, i + 450)) {
      batch.update(d.ref, { driver_id: into_id });
      if (d.data().season_id) seasonIds.add(d.data().season_id);
    }
    await batch.commit();
  }

  // Name the moved entries after the survivor, then drop the duplicate doc.
  try { await syncEntryNamesForDriver(into_id, intoDoc.data()); } catch (err) { console.error("merge name sync failed", err); }
  await db().collection("drivers").doc(from_id).delete();

  // Skill Ratings are a per-game chronological replay keyed off the driver_id
  // on results' entries — recompute every game the moved entries touched so the
  // survivor inherits those races. Best-effort; SR is derived and self-heals.
  try {
    const games = new Set();
    for (const sid of seasonIds) { const g = await gameIdForSeason(sid); if (g) games.add(g); }
    for (const g of games) await recalcGameSkillRatings(g);
  } catch (err) { console.error("merge SR recalc failed", err); }

  return NextResponse.json({ ok: true, entries_moved: entriesSnap.size });
});
