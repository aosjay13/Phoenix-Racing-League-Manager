import { db } from "@/lib/firebase";

// Loads every saved points_templates doc, keyed by id, for resolving a
// result's `points_template_id` into an actual points system server-side.
export async function fetchTemplatesById() {
  const snap = await db().collection("points_templates").get();
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
}
