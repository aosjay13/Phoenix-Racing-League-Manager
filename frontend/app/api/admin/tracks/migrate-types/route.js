import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { LEGACY_TRACK_TYPES } from "@/lib/trackTypes";

export const dynamic = "force-dynamic";

// One-time Track Type migration: the generic "Dirt" type was replaced by
// "Dirt Oval" and "Dirt Road Course", so every venue still saved as "Dirt"
// becomes "Dirt Oval" (see lib/trackTypes.js LEGACY_TRACK_TYPES).
//
// Safety properties, since this rewrites live venue records:
//   • It updates ONE field (`track_type`) with a field-level update, so every
//     other property — name, location, length, layouts, logo, notes, and the
//     track's id itself — is untouched. Race results reference tracks by id and
//     are unaffected, so no track records or history can be lost.
//   • It only touches docs whose type is EXACTLY a retired value; anything else
//     is left alone.
//   • It is idempotent: once migrated there is nothing left matching, so
//     re-running is a no-op that reports 0 updated.
//
// GET reports what a run would do without writing anything, which is what the
// Tracks page uses to decide whether to surface the migrate button at all.
export const GET = withAdmin(async () => {
  const snap = await db().collection("tracks").get();
  const pending = {};
  for (const doc of snap.docs) {
    const type = doc.data().track_type;
    if (type && LEGACY_TRACK_TYPES[type]) pending[type] = (pending[type] || 0) + 1;
  }
  const total = Object.values(pending).reduce((a, b) => a + b, 0);
  return NextResponse.json({ pending, total, mapping: LEGACY_TRACK_TYPES, tracks_scanned: snap.size });
});

export const POST = withAdmin(async () => {
  const snap = await db().collection("tracks").get();
  const doomed = snap.docs.filter(d => {
    const type = d.data().track_type;
    return !!type && !!LEGACY_TRACK_TYPES[type];
  });

  const updated = [];
  for (let i = 0; i < doomed.length; i += 450) {
    const batch = db().batch();
    for (const doc of doomed.slice(i, i + 450)) {
      const from = doc.data().track_type;
      const to = LEGACY_TRACK_TYPES[from];
      // Field-level update — preserves every other field on the track doc.
      batch.update(doc.ref, { track_type: to });
      updated.push({ id: doc.id, name: doc.data().name || "Track", from, to });
    }
    await batch.commit();
  }

  return NextResponse.json({
    ok: true,
    tracks_scanned: snap.size,
    updated: updated.length,
    changes: updated,
  });
});
