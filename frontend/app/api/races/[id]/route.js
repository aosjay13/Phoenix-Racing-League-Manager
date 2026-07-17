import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

const routes = makeDocRoutes(SPECS.races);
export const PATCH = routes.PATCH;

// Deleting a race cascades to its saved results — stats/standings query
// results by season_id, so orphaned results would otherwise keep counting
// after the race is gone.
export const DELETE = withAdmin(async (request, { params }) => {
  const resultsSnap = await db().collection("results").where("race_id", "==", params.id).get();
  const docs = resultsSnap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await db().collection("races").doc(params.id).delete();
  return NextResponse.json({ ok: true, results_deleted: docs.length });
});
