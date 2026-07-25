// Pure filtering rules for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// A class is a separately-scored group inside one season ("Pro"/"Amateur",
// "GT3"/"LMP2"). A roster entry carries the class it races in (`entries.class_id`)
// and every saved result records the class the driver ran in at the time
// (`results.class_id`), so re-classing a driver mid-season doesn't silently
// rewrite the class championships they already scored in.
//
// A class doc belongs to exactly ONE season, so an id alone can't express "GT3"
// across a whole series or game. Wherever a scope spans more than one season the
// selected class is widened into the SET of same-named classes in those seasons
// (see classKey / classIdSet) — that's what makes an all-time "GT3 Most Wins"
// record possible. Every filter here therefore accepts either a single id or a
// set/array of them, and a falsy selector always means "All Classes".
//
// Deliberately dependency-free so both the API routes and client components can
// apply the same rules — lib/classServer.js adds the Firestore reads on top.

// The bucket a driver with no class falls into. Every season without classes —
// and every unclassified driver in a season that has them — races in this one
// default group, which is what keeps legacy results flowing into Series, Game
// and Overall stats exactly as they did before classes existed.
export const UNCLASSIFIED_LABEL = "Unclassified";

// Cross-season identity for a class: two seasons' "GT3" docs have different ids
// but are the same class as far as records and all-time stats are concerned.
export function classKey(name) {
  return String(name || "").trim().toLowerCase();
}

// Normalize any accepted class selector (id string, array of ids, Set of ids)
// into a Set, or null for "All Classes" / no filter.
export function classIdSet(classId) {
  if (!classId) return null;
  if (classId instanceof Set) return classId.size ? classId : null;
  if (Array.isArray(classId)) {
    const set = new Set(classId.filter(Boolean));
    return set.size ? set : null;
  }
  return new Set([classId]);
}

// Does a class id fall inside the given selector? A falsy selector matches
// everything ("All Classes").
export function matchesClass(id, classId) {
  const set = classIdSet(classId);
  return set ? set.has(id || "") : true;
}

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
  const set = classIdSet(classId);
  if (!set) return entries;
  return entries.filter(e => set.has(e.class_id || ""));
}

// Narrow a season's results to one class, judged by classOfResult so a result
// saved before the driver was classified still resolves through their entry.
export function filterResultsByClass(results, classId, entriesById = {}) {
  const set = classIdSet(classId);
  if (!set) return results;
  return results.filter(r => set.has(classOfResult(r, entriesById) || ""));
}

// Does this event belong on the given class's calendar? An event with no
// `class_id` is SHARED — every class runs it — which is every event in a season
// whose per_class_schedules toggle is off, and the default for new events even
// when it's on. An event pinned to a class appears only on that class's
// schedule. Viewing "All Classes" (falsy classId) shows the whole calendar.
export function raceInClass(race, classId) {
  const set = classIdSet(classId);
  if (!set) return true;
  const pinned = race.class_id || null;
  return !pinned || set.has(pinned);
}

// Filter a list of events down to one class's calendar.
export function filterRacesByClass(races, classId) {
  if (!classIdSet(classId)) return races;
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

// Classes in the order the admin arranged them (lowest sort_order first — the
// top class of the season), name as the tiebreak. Every list of classes the app
// renders or scores goes through here, so the order is identical in the
// dropdowns, the results-entry sections and the stats breakdowns.
export function sortClasses(classes = []) {
  return [...classes].sort((a, b) =>
    (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

// The ordered list of groups a field splits into, for anything that renders (or
// scores) one section per class: the season's classes in their admin-set order,
// then an "Unclassified" group for whatever falls outside them.
//
// A season with no classes yields exactly one group — the whole field, id "" —
// so callers never need a legacy special case. `hasUnclassified` drops the
// trailing group when nothing sits outside the defined classes.
export function classGroups(classes = [], hasUnclassified = true) {
  const groups = sortClasses(classes).map(c => ({ id: c.id, name: c.name, color: c.color ?? null, is_default: false }));
  if (!groups.length) return [{ id: "", name: UNCLASSIFIED_LABEL, color: null, is_default: true }];
  if (hasUnclassified) groups.push({ id: "", name: UNCLASSIFIED_LABEL, color: null, is_default: true });
  return groups;
}

// Collapse classes from many seasons into one list of distinct classes by name,
// keeping the first id seen as the representative the dropdowns submit and
// carrying every matching id in `class_ids`. Used wherever a scope spans seasons
// (a series, a game, the whole league) and the user still picks "GT3" once.
export function dedupeClassesByName(classes = []) {
  const byKey = new Map();
  for (const c of sortClasses(classes)) {
    const key = classKey(c.name);
    if (!key) continue;
    const seen = byKey.get(key);
    if (seen) seen.class_ids.push(c.id);
    else byKey.set(key, {
      id: c.id,
      // Trimmed: the representative row is whichever season's doc sorted first,
      // and stray whitespace in one season's name shouldn't reach the dropdown.
      name: String(c.name).trim(),
      color: c.color ?? null,
      sort_order: Number(c.sort_order || 0),
      class_ids: [c.id],
    });
  }
  return sortClasses([...byKey.values()]);
}
