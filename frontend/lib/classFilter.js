// Pure filtering rules for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// A class is a separately-scored group inside one season ("Pro"/"Amateur",
// "GT3"/"LMP2"). A roster entry carries the class it races in (`entries.class_id`)
// and every saved result records the class the driver ran in at the time
// (`results.class_id`), so re-classing a driver mid-season doesn't silently
// rewrite the class championships they already scored in.
//
// Deliberately dependency-free so both the API routes and client components can
// apply the same rules — lib/classServer.js adds the Firestore reads on top.

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

// Does this event belong on the given class's calendar? An event with no
// `class_id` is SHARED — every class runs it — which is every event in a season
// whose per_class_schedules toggle is off, and the default for new events even
// when it's on. An event pinned to a class appears only on that class's
// schedule. Viewing "All Classes" (falsy classId) shows the whole calendar.
export function raceInClass(race, classId) {
  if (!classId) return true;
  const pinned = race.class_id || null;
  return !pinned || pinned === classId;
}

// Filter a list of events down to one class's calendar.
export function filterRacesByClass(races, classId) {
  if (!classId) return races;
  return races.filter(r => raceInClass(r, classId));
}

// The drivers eligible to appear in an event's results. A shared event draws on
// the whole roster; an event pinned to a class draws on that class — plus any
// unclassified drivers, so someone who hasn't been assigned a class yet can
// still be entered rather than being silently unavailable.
export function entriesEligibleForRace(entries, race) {
  const pinned = race?.class_id || null;
  if (!pinned) return entries;
  return entries.filter(e => !e.class_id || e.class_id === pinned);
}
