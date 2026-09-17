// Pure planning logic for copying one event — and everything it scored — into
// another season (POST /api/races/copy).
//
// The hard part isn't the race document; it's that a result points at an
// `entries` doc, and a roster entry belongs to ONE season. The same driver in
// next year's season is a different entry id, and in another series they might
// not be on the roster at all. Classes have the same problem: they're per-season
// records, so "Pro" in 2024 and "Pro" in 2025 are different ids for the same
// idea.
//
// So a copy is really three mappings — drivers, classes, and the race's own
// fields — and they all live here, dependency-free, so the rules can be tested
// without a database. The route (app/api/races/copy/route.js) does the reads,
// the writes and nothing else.

import { identityKeys } from "@/lib/rosterImport";
import { UNCLASSIFIED } from "@/lib/classFilter";
import { BANGER_RESULT_FIELDS } from "@/lib/bangerRacing";
import { toDateOnly } from "@/lib/raceDate";
import { RACE_STAT_FIELDS } from "@/lib/raceStats";
import { isCustomPointsId, newCustomPointsId } from "@/lib/customPoints";

// Race fields that describe the EVENT and so carry over to the copy: what it's
// called, where and how long it runs, its session structure and which points
// system scored each session.
//
// Deliberately not copied:
//   season_id, round_number   the copy's own — set by the caller
//   class_id                  a per-season class id; remapped by name instead
//   strength_of_field         the average Skill Rating of the field that
//                             started it, written by the stats engine from the
//                             SR timeline. The copy has its own field in its
//                             own season, so a carried-over number would be a
//                             fabrication; the next recalc writes the real one.
//   caution_flags,
//   lead_changes              a record of the race being RUN, not of how it is
//                             scheduled — so they travel with the results and
//                             only with them (see copyRaceDoc's
//                             `include_results`). A copy taken as a fresh round
//                             to enter results into must not open already
//                             claiming six cautions it never ran.
//   created_at/created_by,
//   league_id                 audit + partitioning, stamped fresh on write
export const COPIED_RACE_FIELDS = [
  "name", "track", "track_id", "track_logo_url", "date", "car",
  "per_class_results", "sessions",
  "length_type", "total_laps", "race_minutes", "total_rounds", "bracket_size",
  // The heat / consolation distances travel with the event for the same reason
  // its Race Length does — they describe how far this weekend's preliminaries
  // run. They're a results-entry aid rather than a scored figure, so a copy that
  // dropped them would just be a copy an admin has to re-type.
  "heat_laps", "consolation_laps",
  "heat_format", "heats", "consolations", "feature_name",
  "session_points", "session_stats", "session_points_enabled",
  // A session scoring on points typed for it alone (races.custom_points — see
  // lib/customPoints.js) carries them into the copy for the same reason its
  // template assignments carry: they describe how this weekend scores. Unlike a
  // template, though, the structure itself lives on the race, so the copy is
  // given its own ids — see customPointsIdMap below.
  "custom_points",
  // The heat/consolation default points templates travel with the event for the
  // same reason its per-session assignments do: they describe how this weekend
  // scores, and a copy that dropped them would score its heats differently to
  // the round it was copied from. Both reference points_templates docs, which
  // are league-wide rather than per season, so the ids stay valid in the copy.
  "heat_points_template_id", "consolation_points_template_id",
  // The calendar's session times travel with the event for the same reason its
  // date does — they describe when this round runs. They are read by the
  // Calendar and nowhere else (see lib/raceTimes.js), so a copy that dropped
  // them would just be a copy an admin has to re-type.
  "show_session_times", "session_timezone", "session_times",
];

const lower = v => String(v ?? "").trim().toLowerCase();

// Match the source season's classes to the target season's BY NAME, because
// that's the only thing the two seasons share — "Pro" is "Pro" whether it's
// this year's id or last year's, or another series' entirely. A class with no
// counterpart maps to nothing, and every result that ran in it copies over
// unclassified rather than being dropped or landing in a class it never raced.
//
// Returns { [sourceClassId]: targetClassId } holding only the classes that
// actually matched.
export function mapClassesByName(sourceClasses = [], targetClasses = []) {
  const byName = new Map();
  for (const c of targetClasses) {
    const key = lower(c.name);
    if (key && !byName.has(key)) byName.set(key, c.id);
  }
  const map = {};
  for (const c of sourceClasses) {
    const hit = byName.get(lower(c.name));
    if (hit) map[c.id] = hit;
  }
  return map;
}

// Translate one class id from the source season to the target's. Unmapped
// classes come back blank — "unclassified" — which is what every class-aware
// read already falls back to.
export function mapClassId(classId, classMap = {}) {
  const id = String(classId ?? "").trim();
  if (!id) return "";
  return classMap[id] || "";
}

// Match the drivers on the source season's roster to the target's, using the
// same identity rules the roster import uses (global driver_id first, then
// linked account, then lowercased name) so someone entered under a series alias
// still resolves to the person already on the target roster.
//
// Returns:
//   map      { [sourceEntryId]: targetEntryId } for everyone already there
//   missing  the source entries with nobody to map to, in roster order — the
//            caller either creates them on the target roster or skips their
//            results, which is the copy dialog's "add missing drivers" choice
export function planEntryMap(sourceEntries = [], targetEntries = []) {
  const byKey = new Map();
  for (const t of targetEntries) {
    for (const k of identityKeys(t)) if (!byKey.has(k)) byKey.set(k, t.id);
  }

  const map = {};
  const missing = [];
  for (const s of sourceEntries) {
    const hit = identityKeys(s).map(k => byKey.get(k)).find(Boolean);
    if (hit) { map[s.id] = hit; continue; }
    // Nameless, identity-less entries can't be matched OR created — there'd be
    // nothing to put on the roster.
    if (!identityKeys(s).length) continue;
    missing.push(s);
  }
  return { map, missing };
}

// The roster entry a missing driver would be created as on the target season.
// Same carry-over rule as the bulk roster import: name, number and identity
// travel; team and class don't, because both are per-season ids that mean
// nothing here. `classIds` is the driver's classes already translated by
// mapClassesByName — a copy into a season that runs the same class names keeps
// the driver in their class, which is what makes the copied results score in
// the right championship.
export function newEntryForDriver(entry, classIds = []) {
  const ids = classIds.filter(Boolean);
  return {
    name: entry.name,
    ...(entry.number != null && entry.number !== "" ? { number: String(entry.number) } : {}),
    ...(entry.driver_id ? { driver_id: entry.driver_id } : {}),
    ...(entry.user_id ? { user_id: entry.user_id } : {}),
    team_id: "",
    class_id: ids[0] || "",
    class_ids: ids,
    copied_from_entry_id: entry.id ?? null,
  };
}

// Fresh ids for the one-off points structures this event carries, as
// { [sourceId]: [copyId] }.
//
// A custom structure lives on the race document rather than in the shared
// template library, so a copy that kept its ids would have two events holding
// two structures under one id — and editing either would silently re-score the
// other, since every points system in the app is resolved from a single map
// keyed by id (templatesById). Minting new ids is what keeps the copy's points
// the copy's own. Empty for the vast majority of events, which carry none.
export function customPointsIdMap(race = {}) {
  const map = race.custom_points;
  if (!map || typeof map !== "object") return {};
  return Object.fromEntries(
    Object.keys(map).filter(isCustomPointsId).map(id => [id, newCustomPointsId()]));
}

// Translate one points system id through that map: a custom id becomes the
// copy's own, and a template id (league-wide, so still valid in the target
// season) passes straight through.
export function mapTemplateId(id, idMap = {}) {
  return id && idMap[id] ? idMap[id] : id;
}

function remapSessionPoints(sessions, idMap) {
  return Object.fromEntries(
    Object.entries(sessions || {}).map(([name, id]) => [name, mapTemplateId(id, idMap)]));
}

// The copy's own race document: the source event's describing fields, plus the
// target season and whatever the admin retitled/redated/renumbered it to.
//
// `session_points_by_class` is the one field that has to be rewritten rather
// than copied — its KEYS are class ids (or the Unclassified sentinel), so left
// alone it would point every class's points system at classes belonging to
// another season. Scopes whose class didn't survive the mapping are dropped;
// those sessions fall back to `session_points`, then to the season's own
// points, exactly as an event that never named them does.
//
// `include_results` is the admin's "copy the results too" choice, and the race
// stats (caution flags, lead changes) follow it: they record what happened in
// the running of the race, so they belong to the copy exactly when its results
// do. A copy taken as an empty calendar entry gets neither.
export function copyRaceDoc(race, {
  season_id, round_number, name, date, class_id = "", classMap = {}, include_results = false,
  customPointsMap = null,
} = {}) {
  // A caller that copies the results too passes the id map in, so the results
  // and the race agree on it (see copyResultDocs). One that doesn't still gets
  // a self-consistent event rather than a second race sharing the original's
  // structure ids, which is the one thing that must never happen.
  const idMap = customPointsMap || customPointsIdMap(race);
  const doc = { season_id, round_number: Number(round_number) || 1 };
  for (const field of COPIED_RACE_FIELDS) {
    if (race[field] !== undefined) doc[field] = race[field];
  }
  if (include_results) {
    for (const field of RACE_STAT_FIELDS) {
      if (race[field] !== undefined) doc[field] = race[field];
    }
  }
  if (name != null && String(name).trim() !== "") doc.name = String(name).trim();
  // Both the carried-over date and a re-date go through toDateOnly, so the copy
  // holds a bare YYYY-MM-DD calendar date like every other race — a date with a
  // time in it is what makes an event display a day early out west (see
  // lib/raceDate.js). The route writes straight to Firestore, so this is the
  // only place that rule can be applied.
  if (date != null && String(date).trim() !== "") doc.date = toDateOnly(date);
  else if (doc.date !== undefined) doc.date = toDateOnly(doc.date);
  doc.class_id = class_id;

  const byClass = race.session_points_by_class;
  if (byClass && typeof byClass === "object") {
    const remapped = {};
    for (const [scope, sessions] of Object.entries(byClass)) {
      const target = scope === UNCLASSIFIED ? UNCLASSIFIED : classMap[scope];
      if (target) remapped[target] = remapSessionPoints(sessions, idMap);
    }
    if (Object.keys(remapped).length) doc.session_points_by_class = remapped;
    else delete doc.session_points_by_class;
  }

  // Everything that names a one-off structure follows it to its new id: the
  // structures themselves, and the assignments pointing at them.
  if (Object.keys(idMap).length) {
    doc.custom_points = Object.fromEntries(
      Object.entries(race.custom_points || {})
        .filter(([id]) => idMap[id])
        .map(([id, body]) => [idMap[id], body]));
    if (doc.session_points) doc.session_points = remapSessionPoints(doc.session_points, idMap);
    for (const field of ["heat_points_template_id", "consolation_points_template_id"]) {
      if (doc[field]) doc[field] = mapTemplateId(doc[field], idMap);
    }
  }
  return doc;
}

// Result fields that make up "what happened in the race" — everything the copy
// is actually for. Identity (race_id, season_id, entry_id, class_id) and audit
// fields are rebuilt by copyResultDocs; these come across untouched.
export const COPIED_RESULT_FIELDS = [
  "session", "session_type", "finish_pos", "start_pos",
  "qual_time", "race_time", "interval", "fastest_lap_time",
  "laps", "laps_led", "incidents",
  "fastest_lap", "halfway_leader", "hard_charger", "most_laps_led",
  "provisional", "manual_points", "points_adjustment", "bonus_points", "penalty_points",
  "status", "points_template_id",
  // Demo Derby / Banger Racing stats (takedowns, survival bonus, most lethal),
  // written on every result whatever kind of series it came from — taken from
  // lib/bangerRacing.js so a new derby stat travels with the copy for free.
  ...BANGER_RESULT_FIELDS,
];

// Rebuild the source event's results against the new race, season, roster and
// classes. A result whose driver isn't on the target roster (and wasn't created)
// is reported in `skipped` rather than silently dropped, so the dialog can say
// who didn't come across.
//
// Skill Rating fields are deliberately not in COPIED_RESULT_FIELDS: sr_delta
// and the ratings around it are derived by replaying a game's whole timeline,
// so the copy earns its own on the next recalc.
//
// `customPointsMap` is the source event's one-off structures mapped to the ids
// the copy stores them under (customPointsIdMap): a result stamped with one has
// to follow it, or it would score off the structure still sitting on the ORIGINAL
// race. A result on a league-wide template is untouched — those ids stay valid.
export function copyResultDocs(results = [], {
  race_id, season_id, entryMap = {}, classMap = {}, customPointsMap = {},
} = {}) {
  const rows = [];
  const skipped = [];
  for (const r of results) {
    const entry_id = entryMap[r.entry_id];
    if (!entry_id) { skipped.push(r); continue; }
    const doc = { race_id, season_id, entry_id, class_id: mapClassId(r.class_id, classMap) };
    for (const field of COPIED_RESULT_FIELDS) {
      if (r[field] !== undefined) doc[field] = r[field];
    }
    if (doc.points_template_id) doc.points_template_id = mapTemplateId(doc.points_template_id, customPointsMap);
    rows.push(doc);
  }
  return { rows, skipped };
}

// The round number a copy lands on: one past the highest round already in the
// target season, so it joins the end of that calendar instead of colliding with
// a round that's already there.
export function nextRoundNumber(targetRaces = []) {
  return targetRaces.reduce((m, r) => Math.max(m, Number(r.round_number) || 0), 0) + 1;
}

// The round numbers a COPIED SCHEDULE takes.
//
// Into an empty season the copies keep their own numbering, because that is
// what a schedule is: "Race 1" of the calendar you copied is "Race 1" of the
// copy, and a league running one schedule in two classes wants the two to read
// alike. A source round with no number of its own falls back to its place in
// the order, so a half-numbered calendar still comes out 1..N.
//
// Into a season that ALREADY has rounds they continue from the last one
// instead. Two rounds sharing a number would order that calendar by chance —
// this app sorts a schedule by round number — and silently renumbering what was
// already there would be worse. Nothing existing is touched either way.
//
// `sourceRaces` are in the order they will be written.
export function scheduleRoundNumbers(sourceRaces = [], targetRaces = []) {
  const keepOwn = (targetRaces || []).length === 0;
  const startAt = nextRoundNumber(targetRaces);
  return (sourceRaces || []).map((race, i) => (keepOwn
    ? (Number(race?.round_number) || i + 1)
    : startAt + i));
}
