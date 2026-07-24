// Server-side helpers for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// A class is a separately-scored group inside one season ("Pro"/"Amateur",
// "GT3"/"LMP2"). A roster entry carries the class it races in (`entries.class_id`)
// and every saved result records the class the driver ran in at the time
// (`results.class_id`), so re-classing a driver mid-season doesn't silently
// rewrite the class championships they already scored in.

import { db } from "@/lib/firebase";

// The class a result counts toward: the class stamped on the result when it was
// saved, else the driver's current roster class. Results written before classes
// existed have neither, and count only toward the overall championship.
export function classOfResult(result, entriesById = {}) {
  const stamped = result.class_id;
  if (stamped) return stamped;
  return entriesById[result.entry_id]?.class_id || null;
}

// Narrow a season's entries to one class. A falsy classId means "All Classes"
// and leaves the list untouched.
export function filterEntriesByClass(entries, classId) {
  if (!classId) return entries;
  return entries.filter(e => (e.class_id || null) === classId);
}

// Narrow a season's results to one class, judged by classOfResult so a result
// saved before the driver was classified still resolves through their entry.
export function filterResultsByClass(results, classId, entriesById = {}) {
  if (!classId) return results;
  return results.filter(r => classOfResult(r, entriesById) === classId);
}

// Every class in a season, ordered the way the dropdowns show them.
export async function fetchSeasonClasses(seasonId) {
  if (!seasonId) return [];
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
}
