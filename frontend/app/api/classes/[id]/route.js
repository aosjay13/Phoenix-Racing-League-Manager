import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

const routes = makeDocRoutes(SPECS.classes);
export const PATCH = routes.PATCH;

// Deleting a class never deletes drivers or results — it just unassigns them.
// Every entry pointing at this class is cleared back to unclassified (and the
// same for any results that recorded it), so those drivers keep all their
// points and stats and simply stop appearing under a class championship.
export const DELETE = withAdmin(async (request, { params }) => {
  const [entriesSnap, resultsSnap] = await Promise.all([
    db().collection("entries").where("class_id", "==", params.id).get(),
    db().collection("results").where("class_id", "==", params.id).get(),
  ]);
  const docs = [...entriesSnap.docs, ...resultsSnap.docs];
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    docs.slice(i, i + 450).forEach(d => batch.update(d.ref, { class_id: "" }));
    await batch.commit();
  }
  await db().collection("classes").doc(params.id).delete();
  return NextResponse.json({ ok: true, entries_unassigned: entriesSnap.size, results_unassigned: resultsSnap.size });
});
