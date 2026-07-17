import { db } from "@/lib/firebase";
import { normalizedBuiltinTemplates, NONE_TEMPLATE } from "@/lib/pointsTemplates";

// Every points system a session (or result) can reference by id, keyed by id:
// saved points_templates docs, the builtin templates, and the "none"
// (score-0) pseudo-template — so any points_template_id stored on a result
// resolves to an actual points system server-side.
export async function fetchTemplatesById() {
  const snap = await db().collection("points_templates").get();
  return {
    ...Object.fromEntries(normalizedBuiltinTemplates().map(t => [t.id, t])),
    [NONE_TEMPLATE.id]: NONE_TEMPLATE,
    ...Object.fromEntries(snap.docs.map(d => [d.id, d.data()])),
  };
}
