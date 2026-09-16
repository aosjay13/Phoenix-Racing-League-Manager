// A points structure that belongs to ONE session of ONE event.
//
// Every other points system in the app is a reusable thing with a name: a
// season's structure, a class's, a saved points template. That is the right
// shape for how a league normally scores, and the wrong shape for the night it
// doesn't — a rain-shortened feature paying half points, a one-off invitational,
// an enduro worth double. Saving a template for a scale that will be used once
// clutters the library for every season afterwards.
//
// So a session can carry a structure of its own instead. It's stored on the
// RACE, under `races.custom_points`, keyed by an id the session points at
// exactly as it would point at a template:
//
//   races.custom_points["custom-…"] = { name, race_points, qual_points, bonus_points }
//   races.session_points["Race"]     = "custom-…"
//
// Nothing downstream needs to know the difference. The id is stamped onto the
// session's results and resolved through the same `templatesById` lookup a
// saved template is (see lib/rawIndex.js), so the standings, the stats engine,
// the event page and the live Points column all score it without a special
// case. It simply never appears in the template library, because it was never
// a template — and it dies with the event it was written for.
//
// Dependency-free on purpose: the results editor, the assignment route and the
// race-copy planner all share these rules.

// Custom ids are prefixed the way the builtin templates are ("builtin-…"), so
// an id says which pool it comes from without a lookup. Firestore auto-ids are
// 20 alphanumeric characters, so no saved template can collide with one.
export const CUSTOM_POINTS_PREFIX = "custom-";

// The <select> value that means "open the editor on a structure of this
// session's own". It is a signal from the dropdown, never a stored id — the id
// is minted server-side when the structure is actually saved.
export const CUSTOM_POINTS_OPTION = "__custom__";

export function isCustomPointsId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_POINTS_PREFIX);
}

// A fresh id for a structure about to be written. Random rather than derived
// from the session name, so renaming a session doesn't orphan its points and
// two events never share an id — which is what lets one flat `templatesById`
// map hold every race's custom structures at once.
export function newCustomPointsId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${CUSTOM_POINTS_PREFIX}${Date.now().toString(36)}${rand}`;
}

// What a custom structure is called wherever a template name would be shown.
// It names the session it was written for, since "Custom" on its own tells an
// admin nothing on an event running eight of them.
export function customPointsName(session = "", classLabel = "") {
  const where = [classLabel, session].filter(Boolean).join(" · ");
  return where ? `Custom — ${where}` : "Custom points";
}

// Firestore map keys can't be empty and shouldn't carry path punctuation, and
// these come straight off a JSON body. Bonus keys are code identifiers
// everywhere they're written (see BONUS_TYPES / BANGER_BONUS_TYPES).
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// { "1": 40, "2": "35" } → { 1: 40, 2: 35 }. Anything unusable resolves to the
// explicit all-zeros table a blank scale saves as (see listToTableOrZero), so a
// custom structure never falls back to a scale nobody chose.
function numberTable(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { 1: 0 };
  const out = {};
  for (const [pos, points] of Object.entries(value)) {
    const p = Number(pos);
    const n = Number(points);
    if (!Number.isFinite(p) || p < 1 || !Number.isFinite(n)) continue;
    out[Math.trunc(p)] = n;
  }
  return Object.keys(out).length ? out : { 1: 0 };
}

function numberMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, points] of Object.entries(value)) {
    const n = Number(points);
    if (!SAFE_KEY.test(key) || !Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
}

// One custom structure, in exactly the shape a points_templates doc has — which
// is what lets configForTemplate score it with no special case. Returns null
// for a body that holds no structure at all, so a caller can tell "no custom
// points were sent" from "a blank scale was sent", which means score 0.
export function sanitizeCustomPoints(body, { name = "" } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const has = ["race_points", "qual_points", "bonus_points"].some(k => body[k] != null);
  if (!has) return null;
  return {
    name: String(name || body.name || "").trim() || "Custom points",
    race_points: numberTable(body.race_points),
    qual_points: numberTable(body.qual_points),
    bonus_points: numberMap(body.bonus_points),
  };
}

// One race's custom structures as template-shaped objects, ready to drop into a
// templates lookup or a dropdown.
export function customTemplatesOf(race) {
  const map = race?.custom_points;
  if (!map || typeof map !== "object") return [];
  return Object.entries(map)
    .filter(([id, body]) => isCustomPointsId(id) && body && typeof body === "object")
    .map(([id, body]) => ({ ...body, id, name: body.name || "Custom points", custom: true }));
}

// The same, keyed by id, across a whole bundle's races — the twin of
// templatesById's saved-template half.
export function customTemplatesById(races = []) {
  const out = {};
  for (const race of races) {
    for (const template of customTemplatesOf(race)) out[template.id] = template;
  }
  return out;
}

// Which custom ids on this race are still pointed at by something: a session
// assignment (event-wide or per class), a heat/consolation default, or a saved
// result. `resultTemplateIds` is what the race's results point at AFTER the
// write being made, which the caller has in hand.
export function customPointsInUse(race = {}, resultTemplateIds = []) {
  const ids = new Set();
  const add = id => { if (isCustomPointsId(id)) ids.add(id); };
  for (const id of Object.values(race.session_points || {})) add(id);
  for (const sessions of Object.values(race.session_points_by_class || {})) {
    for (const id of Object.values(sessions || {})) add(id);
  }
  add(race.heat_points_template_id);
  add(race.consolation_points_template_id);
  for (const id of resultTemplateIds) add(id);
  return ids;
}

// The race's custom_points map with the structures nothing points at any more
// dropped — what keeps switching a session from custom to a template and back
// from growing the race document forever. Returns null when nothing would
// change, so a caller can skip the write.
export function prunedCustomPoints(race = {}, resultTemplateIds = []) {
  const map = race.custom_points;
  if (!map || typeof map !== "object") return null;
  const keep = customPointsInUse(race, resultTemplateIds);
  const next = Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
  return Object.keys(next).length === Object.keys(map).length ? null : next;
}
