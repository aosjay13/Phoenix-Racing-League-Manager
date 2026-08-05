// Series lookups for the scoring chain.
//
// A series carries the league's DEFAULT points structure — the top of
// series → season → class → session template (see resolveSeasonConfig) — so
// every route that scores results needs its season's series doc alongside the
// season. These are the reads for that, batched, since the stats routes walk
// many seasons at once.

import { db } from "@/lib/firebase";

// series id -> doc, for a set of ids. Unknown/blank ids are skipped.
export async function fetchSeriesByIds(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const docs = await Promise.all(unique.map(id => db().collection("series").doc(id).get()));
  return Object.fromEntries(docs.filter(d => d.exists).map(d => [d.id, { id: d.id, ...d.data() }]));
}

// The series one season belongs to, or null — the common single-season case.
export async function fetchSeriesForSeason(season) {
  const id = season?.series_id;
  if (!id) return null;
  const doc = await db().collection("series").doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}
