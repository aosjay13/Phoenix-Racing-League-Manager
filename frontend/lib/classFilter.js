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

// ── Per-class sessions ─────────────────────────────────────────────────────
//
// A "session class scope" is the class a set of results is being entered for
// WITHIN one event, which is a different question to which class's calendar the
// event sits on (races.class_id, above). When several classes race the same
// event, each class gets its own Qualifying and its own Race — its own pole,
// its own P1, its own field — instead of one combined grid where only the
// outright leader is a winner.
//
// A scope is one of:
//   null / undefined  → not class-scoped: the whole session, exactly as the app
//                       behaved before per-class sessions existed.
//   UNCLASSIFIED      → the drivers with no class assigned.
//   "<class id>"      → that class alone.
export const UNCLASSIFIED = "__none";

// Is this scope value a real, class-scoped selection (rather than "the whole
// session")? Written as its own helper because "" and UNCLASSIFIED both mean
// something specific and neither is falsy in the same way.
export function isClassScoped(scope) {
  return scope === UNCLASSIFIED || !!scope;
}

// The class_id a result saved under this scope should carry. UNCLASSIFIED
// stores a blank class, matching a driver with no class on the roster.
export function classIdForScope(scope) {
  return scope === UNCLASSIFIED ? "" : (scope || "");
}

// Does a saved result belong to this session-class scope? Judged by
// classOfResult, so a result written before the season had classes still
// resolves through its driver's roster entry.
export function resultInSessionClass(result, scope, entriesById = {}) {
  if (!isClassScoped(scope)) return true;
  return (classOfResult(result, entriesById) || "") === classIdForScope(scope);
}

// Narrow roster entries to a session-class scope. Unlike entriesEligibleForRace
// this does NOT let unclassified drivers spill into a class's grid — a per-class
// session is the class's own field, and unclassified drivers have their own
// scope.
export function entriesInSessionClass(entries, scope) {
  if (!isClassScoped(scope)) return entries;
  const want = classIdForScope(scope);
  return entries.filter(e => (e.class_id || "") === want);
}

// Does this event run its sessions split by class? Resolved per event, falling
// back to the season default — so a season can opt in wholesale while an
// individual event still combines its classes (or vice versa). An event pinned
// to a single class is a single-class event already, so splitting is moot and
// this stays off.
export function racePerClassResults(race, season) {
  if (race?.class_id) return false;
  if (race && race.per_class_results != null) return !!race.per_class_results;
  return !!season?.per_class_results;
}

// The scopes an event's results are entered under, in display order: one per
// class, plus Unclassified when the season has drivers with no class (or a
// result already saved without one) so those drivers are never stranded.
// Returns [{ value, label }] ready for a dropdown.
export function sessionClassScopes(classes = [], entries = [], results = []) {
  const scopes = classes.map(c => ({ value: c.id, label: c.name }));
  const stray = entries.some(e => !e.class_id) || results.some(r => !(r.class_id || ""));
  if (stray || !scopes.length) scopes.push({ value: UNCLASSIFIED, label: "Unclassified" });
  return scopes;
}
