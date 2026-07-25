// Server-side helpers for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// The filtering rules themselves live in lib/classFilter.js, which is
// dependency-free so client components apply exactly the same logic. This module
// adds the Firestore reads and re-exports the rules so API routes have one
// import.

import { db } from "@/lib/firebase";
import { classKey, dedupeClassesByName, sortClasses } from "@/lib/classFilter";

export {
  UNCLASSIFIED_LABEL,
  classGroups,
  classIdSet,
  classKey,
  classOfResult,
  dedupeClassesByName,
  entriesEligibleForRace,
  filterEntriesByClass,
  filterRacesByClass,
  filterResultsByClass,
  matchesClass,
  raceInClass,
  sortClasses,
} from "@/lib/classFilter";

// Every class in a season, ordered the way the dropdowns show them.
export async function fetchSeasonClasses(seasonId) {
  if (!seasonId) return [];
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return sortClasses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

// Every class across a set of seasons, in dropdown order. Firestore `in`
// queries cap at 30 values, so the season ids are read in chunks.
export async function fetchClassesForSeasons(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(
    chunks.map(chunk => db().collection("classes").where("season_id", "in", chunk).get())
  );
  const out = [];
  for (const snap of snaps) for (const d of snap.docs) out.push({ id: d.id, ...d.data() });
  return sortClasses(out);
}

// Widen ONE selected class id into every class that means the same thing across
// the given seasons.
//
// A class doc lives in a single season, so filtering a multi-season scope (a
// series, a game, the whole league) by a bare id would silently return just that
// one season's slice. Matching on the class NAME instead — "GT3" is GT3 in every
// season that runs it — is what lets Records and Stats answer "most GT3 wins,
// all time".
//
// Returns null when nothing is selected (All Classes), otherwise
// { ids: Set<string>, name, key }. An id that no longer resolves to a class doc
// still yields a selector holding just itself, so a stale saved selection
// filters to nothing rather than silently widening back to the whole field.
//
// Pass `preloaded` when the caller already holds the scope's classes, to skip
// re-reading them.
export async function resolveClassScope(classId, seasonIds = [], preloaded = null) {
  if (!classId) return null;
  const [selected, all] = await Promise.all([
    db().collection("classes").doc(classId).get(),
    preloaded ?? fetchClassesForSeasons(seasonIds),
  ]);
  const name = selected.exists ? selected.data().name : null;
  const key = classKey(name);
  const ids = new Set([classId]);
  if (key) for (const c of all) if (classKey(c.name) === key) ids.add(c.id);
  return { ids, name: name ?? null, key };
}

// The classes a scope's Class dropdown offers: one row per distinct class NAME
// across the given seasons, so a series that runs GT3 and LMP2 every year lists
// each once rather than once per season.
export async function fetchScopeClasses(seasonIds = []) {
  return dedupeClassesByName(await fetchClassesForSeasons(seasonIds));
}
