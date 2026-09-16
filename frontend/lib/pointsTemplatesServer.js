import { db } from "@/lib/firebase";
import { normalizedBuiltinTemplates, NONE_TEMPLATE } from "@/lib/pointsTemplates";
import { customTemplatesById } from "@/lib/customPoints";

// Every points system a session (or result) can reference by id, keyed by id:
// saved points_templates docs, the builtin templates, the "none" (score-0)
// pseudo-template, and the one-off structures sessions carry on their own race
// document (`races.custom_points` — see lib/customPoints.js) — so any
// points_template_id stored on a result resolves to an actual points system
// server-side.
//
// `races` are the race documents in scope, which the caller already holds; the
// custom half resolves from them rather than from a read of its own, exactly as
// the client-side twin (templatesById in lib/rawIndex.js) resolves it from the
// bundle.
export async function fetchTemplatesById(races = []) {
  const snap = await db().collection("points_templates").get();
  return {
    ...Object.fromEntries(normalizedBuiltinTemplates().map(t => [t.id, t])),
    [NONE_TEMPLATE.id]: NONE_TEMPLATE,
    ...Object.fromEntries(snap.docs.map(d => [d.id, d.data()])),
    ...customTemplatesById(races),
  };
}
