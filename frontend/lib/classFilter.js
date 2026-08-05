// Pure filtering rules for the Class tier (Game ▸ Series ▸ Season ▸ Class).
//
// A class is a separately-scored group inside one season ("Pro"/"Amateur",
// "GT3"/"LMP2"). A roster entry carries the classes it races in and every saved
// result records the class the driver ran in at the time (`results.class_id`),
// so re-classing a driver mid-season doesn't silently rewrite the class
// championships they already scored in.
//
// A driver can race in SEVERAL classes in one season — that's `entries.class_ids`,
// an array. `entries.class_id` is kept in sync as the first of them (their
// primary class) so everything written before multi-class existed still reads
// correctly; entryClassIds() below is the one way to ask "which classes is this
// entry in", and handles an entry that only ever had the single field.
//
// Deliberately dependency-free so both the API routes and client components can
// apply the same rules — lib/classServer.js adds the Firestore reads on top.

// Clean a class-id list: strings, trimmed, no blanks, no duplicates.
export function normalizeClassIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Every class this roster entry races in, newest model first and falling back
// to the single `class_id` for entries written before multi-class. An empty
// array means unclassified.
export function entryClassIds(entry) {
  const many = normalizeClassIds(entry?.class_ids);
  if (many.length) return many;
  const one = String(entry?.class_id ?? "").trim();
  return one ? [one] : [];
}

// ── One canonical class order ──────────────────────────────────────────────
//
// A driver's `class_ids` are stored in the order an admin happened to tick them,
// so left raw they render differently on every driver ("Pro · Am" here, "Am ·
// Pro" there) — and, worse, the FIRST of them is the driver's "primary" class,
// which is what an unstamped result falls back to. Arbitrary order therefore
// meant an arbitrary answer to "which class did this count in".
//
// So both are resolved through the season's own class order (`sort_order`, then
// name — the order the Class menu shows), which is the one order a league has
// deliberately set. Ids belonging to no known class keep their relative order at
// the end rather than being dropped, so nothing disappears from a stale list.
export function orderClassIds(ids = [], classes = []) {
  const rank = new Map(classes.map((c, i) => [c.id, i]));
  return [...normalizeClassIds(ids)].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity;
    const rb = rank.has(b) ? rank.get(b) : Infinity;
    return ra - rb;
  });
}

// An entries map with every entry's classes put into the season's order, so
// "primary class" (the first of them) is a stable, meaningful answer rather
// than whichever class happened to be ticked first. Routes normalize the roster
// through this once, before anything resolves a result's class.
export function orderEntryClasses(entriesById = {}, classes = []) {
  return Object.fromEntries(Object.entries(entriesById).map(([id, entry]) => {
    const class_ids = orderClassIds(entryClassIds(entry), classes);
    return [id, { ...entry, class_ids, class_id: class_ids[0] || "" }];
  }));
}

// Every class this entry races, in the season's display order.
export function entryClassIdsOrdered(entry, classes = []) {
  return orderClassIds(entryClassIds(entry), classes);
}

// Their names, in that same order — what a Class column renders.
export function classNamesFor(entry, classes = []) {
  const byId = new Map(classes.map(c => [c.id, c.name]));
  return entryClassIdsOrdered(entry, classes).map(id => byId.get(id)).filter(Boolean);
}

// The entry's primary class — the one thing a single-class field can show (a
// standings row's Class column, an unstamped result's class). Null when the
// driver is unclassified.
export function primaryClassId(entry) {
  return entryClassIds(entry)[0] || null;
}

// Is this entry in the given class selection (a Set from classIdSet)? An
// unclassified entry matches only a selection that includes `null`.
export function entryInClassSet(entry, set) {
  const ids = entryClassIds(entry);
  if (!ids.length) return set.has(null);
  return ids.some(id => set.has(id));
}

// The class a result counts toward: the class stamped on the result when it was
// saved, else the driver's primary roster class. Results written before classes
// existed have neither, and count only toward the overall championship. A
// driver who races several classes always has their results stamped by the
// per-class results editor, which is what keeps each one in the right table.
export function classOfResult(result, entriesById = {}) {
  const stamped = result.class_id;
  if (stamped) return stamped;
  return primaryClassId(entriesById[result.entry_id]);
}

// A class *selection* is one of:
//   falsy            → "All Classes": no filtering at all
//   "<class id>"     → one class doc, i.e. one season's class
//   [ids] / Set(ids) → the same class across several seasons
//
// The third form is what makes a class answerable above season level. A class
// doc belongs to exactly one season, so "GT3" in Season 3 and "GT3" in Season 4
// are different ids for the same category; a series- or game-wide view resolves
// the name to every matching id and filters on the set. Normalizing here means
// every filter below takes all three forms without caring which it got.
export function classIdSet(selection) {
  if (!selection) return null;
  if (typeof selection === "string") return new Set([selection]);
  const ids = selection instanceof Set ? [...selection] : Array.isArray(selection) ? selection : [];
  const clean = ids.filter(Boolean);
  return clean.length ? new Set(clean) : null;
}

// Narrow a season's entries to a class selection. "All Classes" leaves the list
// untouched. A driver entered in several classes belongs to each of them, so
// they appear in every one of those class championships.
export function filterEntriesByClass(entries, selection) {
  const set = classIdSet(selection);
  if (!set) return entries;
  return entries.filter(e => entryInClassSet(e, set));
}

// Narrow results to a class selection, judged by classOfResult so a result
// saved before the driver was classified still resolves through their entry.
// Results inside a class selection.
//
// A result that RECORDS its class answers for itself — that's every result the
// grid saves, and it stays exact even if the driver is re-classed later.
//
// A result with no class recorded (saved before classes existed, or before its
// driver was put in one) falls back to the driver's PRIMARY class: the first of
// their classes in the season's own order — see orderEntryClasses, which is
// what makes "first" mean something rather than being whichever class an admin
// ticked first.
//
// One result, one class. Counting an unstamped result toward every class its
// driver races looks like it rescues a multi-class driver, but it puts the SAME
// result in two championships at once — the same race showing up in Banger
// Racing and in Demo Derby. A race was run in one class; where the record
// doesn't say which, the driver's primary class is the one answer that keeps
// each result in exactly one table. To place them exactly, set the Class column
// on the results grid and re-save: that stamps each result for good.
export function filterResultsByClass(results, selection, entriesById = {}) {
  const set = classIdSet(selection);
  if (!set) return results;
  return results.filter(r => set.has(classOfResult(r, entriesById)));
}

export function raceInClass(race, selection) {
  const set = classIdSet(selection);
  if (!set) return true;
  const pinned = race.class_id || null;
  return !pinned || set.has(pinned);
}

// Filter a list of events down to a class's calendar.
export function filterRacesByClass(races, selection) {
  const set = classIdSet(selection);
  if (!set) return races;
  return races.filter(r => raceInClass(r, set));
}

// The ids, within one season's class list, that a cross-season selection picks
// out. `selection` is either a class NAME (the cross-season identity — see
// classIdSet) or a single class id; either way the answer is the ids that exist
// in THIS season, which is what the filters above want.
export function classIdsInSeason(seasonClasses = [], { className = "", classId = "" } = {}) {
  if (className) return seasonClasses.filter(c => c.name === className).map(c => c.id);
  if (classId) return seasonClasses.some(c => c.id === classId) ? [classId] : [];
  return [];
}

// The drivers eligible to appear in an event's results. A shared event draws on
// the whole roster; an event pinned to a class draws on that class — plus any
// unclassified drivers, so someone who hasn't been assigned a class yet can
// still be entered rather than being silently unavailable.
export function entriesEligibleForRace(entries, race) {
  const pinned = race?.class_id || null;
  if (!pinned) return entries;
  return entries.filter(e => {
    const ids = entryClassIds(e);
    return !ids.length || ids.includes(pinned);
  });
}

// ── Cars ───────────────────────────────────────────────────────────────────
//
// Which car is on track is a three-level fallback, most specific first:
//
//   race.car   — this one event runs something different
//   class.car  — this class's machinery for the whole season (GT3 vs LMP2)
//   season.car — the season default, and the only level that existed before
//                classes could carry a car
//
// Every level is free text and any of them may be blank, so a single-class
// season behaves exactly as it always has.
function trimmed(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

// The car a race runs for a given class. `raceClass` is optional — omit it (or
// pass the class the viewer has selected) and the season default is the
// fallback.
export function carForRace(race, season, raceClass = null) {
  return trimmed(race?.car) || trimmed(raceClass?.car) || trimmed(season?.car);
}

// The car a class races for the season, before any per-event override.
export function carForClass(season, raceClass) {
  return trimmed(raceClass?.car) || trimmed(season?.car);
}

// The one car on track at an event, or null when the classes running it are in
// different machinery and no single answer is honest. Handles the three shapes
// a caller cares about: no classes at all (the season/race car), a round pinned
// to one class (that class's car), and several classes that happen to agree.
export function soleCarForRace(race, season, classes = []) {
  const running = classes.filter(c => raceInClass(race, c.id));
  if (running.length > 1 && new Set(running.map(c => carForRace(race, season, c))).size > 1) return null;
  return carForRace(race, season, running[0] ?? null);
}

// The distinct cars on track at one event, as [{ class_id, class_name, car }],
// for the whole-season view where no single class is selected. Only the classes
// that actually run this round are listed (a round pinned to one class is just
// that class), and the list is dropped entirely unless the classes genuinely
// differ — otherwise every row would repeat the season's one car per class.
export function carsByClassForRace(race, season, classes = []) {
  const running = classes.filter(c => raceInClass(race, c.id));
  if (!running.length) return [];
  const rows = running.map(c => ({ class_id: c.id, class_name: c.name, car: carForRace(race, season, c) }));
  const distinct = new Set(rows.map(r => r.car));
  if (distinct.size < 2) return [];
  return rows;
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
  return entries.filter(e => {
    const ids = entryClassIds(e);
    // A driver in several classes lines up in each of their grids; the
    // Unclassified scope is only for drivers with no class at all.
    return want ? ids.includes(want) : !ids.length;
  });
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
// Returns [{ value, label, car }] ready for a dropdown — `car` is the class's
// OWN car, blank when it just inherits the season's, so the picker only calls
// out machinery that actually differs between classes.
export function sessionClassScopes(classes = [], entries = [], results = []) {
  const scopes = classes.map(c => ({ value: c.id, label: c.name, car: trimmed(c.car) || "" }));
  const stray = entries.some(e => !entryClassIds(e).length) || results.some(r => !(r.class_id || ""));
  if (stray || !scopes.length) scopes.push({ value: UNCLASSIFIED, label: "Unclassified", car: "" });
  return scopes;
}
