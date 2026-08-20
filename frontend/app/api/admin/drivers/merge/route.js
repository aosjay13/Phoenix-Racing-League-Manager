import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { syncEntryNamesForDriver, canonicalNameForDriver } from "@/lib/driverSync";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";
import { planProfileMerge } from "@/lib/driverMerge";
import { TRIAL_ENTRY_COLLECTION } from "@/lib/timeTrialsServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// Merge one pool driver INTO another — the fix for a duplicate profile, and the
// only thing that puts a split career back together.
//
//   POST { from_id, into_id }            do it
//   POST { from_id, into_id, dry_run }   say what it would do, and write nothing
//
// `into_id` is the PRIMARY: the profile that survives, and whose own details
// win wherever the two disagree. `from_id` is the duplicate, which stops
// existing.
//
// What moves, and why nothing is lost:
//
//   • Race history. Every roster entry belonging to the duplicate is
//     re-pointed at the primary. Results reference entries, not drivers, so
//     each race, point, win, podium and championship travels with them
//     untouched — none of it is copied, rewritten or recalculated.
//   • Time trial laps. A trial's entries carry the driver directly, so those
//     are re-pointed too; a hot lap in the record books keeps its holder.
//   • The profile. Aliases, per-game names, a linked player account, a display
//     name, notes and per-game Skill Ratings are reconciled field by field —
//     the primary's wins, the duplicate's fills the gaps (see lib/driverMerge).
//   • The names. Every name the duplicate raced under is kept on the primary
//     as a former name, so the next import that lists the old name finds this
//     driver instead of re-creating the duplicate that was just cleaned up
//     (see lib/driverMatch.js, which reads them).
//
// The dry run answers the same questions from the same code, so the preview an
// admin approves is the merge that then runs.
const handlePOST = withAdmin(async (request) => {
  const { from_id, into_id, dry_run = false } = await request.json();
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
  const duplicate = { id: from_id, ...fromDoc.data() };
  const primary = { id: into_id, ...intoDoc.data() };

  // What the duplicate holds: their roster entries (the race history), and
  // their time trial rows. Read before anything is written so a dry run and a
  // real run see exactly the same picture.
  const [entriesSnap, trialSnap] = await Promise.all([
    db().collection("entries").where("driver_id", "==", from_id).get(),
    db().collection(TRIAL_ENTRY_COLLECTION).where("driver_id", "==", from_id).get(),
  ]);

  // The seasons touched (hence the games, for the Skill Rating replay) and
  // every name this person actually raced under — a driver renamed once has
  // entries under a name neither profile still carries.
  const seasonIds = new Set();
  const racedNames = [];
  for (const d of entriesSnap.docs) {
    if (d.data().season_id) seasonIds.add(d.data().season_id);
    if (d.data().name) racedNames.push(d.data().name);
  }
  for (const d of trialSnap.docs) if (d.data().name) racedNames.push(d.data().name);

  const { updates, carried, merged_names } = planProfileMerge(primary, duplicate, { extraNames: racedNames });

  if (dry_run) {
    return NextResponse.json({
      ok: true, dry_run: true,
      primary: { id: primary.id, name: primary.name || "" },
      duplicate: { id: duplicate.id, name: duplicate.name || "" },
      entries: entriesSnap.size,
      trial_entries: trialSnap.size,
      carried,
      merged_names,
    });
  }

  // Re-point the duplicate's rows onto the primary. Firestore batches cap at
  // 500 writes, so a career of any length goes across in chunks.
  const refs = [...entriesSnap.docs, ...trialSnap.docs].map(d => d.ref);
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db().batch();
    for (const ref of refs.slice(i, i + 450)) batch.update(ref, { driver_id: into_id });
    await batch.commit();
  }

  // Keep the primary's own canonical name out of its own former-name list —
  // that name resolves through the profile already.
  const survivorName = (await canonicalNameForDriver(into_id, primary) || "").toLowerCase();
  updates.merged_names = merged_names.filter(n => n.toLowerCase() !== survivorName);
  try { await db().collection("drivers").doc(into_id).update(updates); }
  catch (err) { console.error("merge profile write failed", err); }

  // Name the moved entries after the survivor, then drop the duplicate doc.
  try { await syncEntryNamesForDriver(into_id, { ...primary, ...updates }); } catch (err) { console.error("merge name sync failed", err); }
  await db().collection("drivers").doc(from_id).delete();

  // Skill Ratings are a per-game chronological replay keyed off the driver_id
  // on results' entries — recompute every game the moved entries touched so the
  // survivor inherits those races. Best-effort; SR is derived and self-heals.
  try {
    const games = new Set();
    for (const sid of seasonIds) { const g = await gameIdForSeason(sid); if (g) games.add(g); }
    for (const g of games) await recalcGameSkillRatings(g);
  } catch (err) { console.error("merge SR recalc failed", err); }

  return NextResponse.json({
    ok: true,
    entries_moved: entriesSnap.size,
    trial_entries_moved: trialSnap.size,
    carried,
    merged_names: updates.merged_names,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
