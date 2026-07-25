// Server-side helpers for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// The filtering rules themselves live in lib/classFilter.js, which is
// dependency-free so client components apply exactly the same logic. This module
// adds the Firestore reads and re-exports the rules so API routes have one
// import.

import { db } from "@/lib/firebase";

export {
  classOfResult,
  filterEntriesByClass,
  filterResultsByClass,
  raceInClass,
  filterRacesByClass,
  entriesEligibleForRace,
} from "@/lib/classFilter";

// Every class in a season, ordered the way the dropdowns show them.
export async function fetchSeasonClasses(seasonId) {
  if (!seasonId) return [];
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
}
