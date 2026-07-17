import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

const routes = makeDocRoutes(SPECS.entries);
export const PATCH = routes.PATCH;

// Deleting an entry cascades to its saved results across every race/session
// of the season — an entry can be removed straight from a results grid (e.g.
// a driver added by mistake), and leaving their results behind would orphan
// them (still counted until some future race happens to reuse the same
// entry_id, or worse, silently skewing stats forever).
export const DELETE = withAdmin(async (request, { params }) => {
  const resultsSnap = await db().collection("results").where("entry_id", "==", params.id).get();
  const docs = resultsSnap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await db().collection("entries").doc(params.id).delete();
  return NextResponse.json({ ok: true, results_deleted: docs.length });
});
