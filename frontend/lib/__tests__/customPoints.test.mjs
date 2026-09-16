// A points structure for ONE session of ONE event — the night that scores
// differently and shouldn't leave a template behind in the library.
//
// The invariants that matter:
//
//   1. a custom structure resolves through exactly the same lookup a saved
//      template does, so every screen that scores points scores it too and
//      none of them needs to know it exists;
//   2. it never reaches the shared template library — it lives on the race;
//   3. it dies with the last thing pointing at it, rather than piling up on
//      the race document every time an admin changes their mind;
//   4. a copied event gets structures of its OWN, so editing the copy can't
//      re-score the round it was copied from.
import assert from "node:assert/strict";
import {
  CUSTOM_POINTS_OPTION, customPointsInUse, customPointsName, customTemplatesById, customTemplatesOf,
  isCustomPointsId, newCustomPointsId, prunedCustomPoints, sanitizeCustomPoints,
} from "../customPoints.js";
import { templatesById } from "../rawIndex.js";
import { configForTemplate } from "../standings.js";
import { COPIED_RACE_FIELDS, copyRaceDoc, copyResultDocs, customPointsIdMap, mapTemplateId } from "../raceCopy.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Ids say where a points system comes from ───────────────────────────

const id = newCustomPointsId();
ok("a minted id is recognisably custom", isCustomPointsId(id));
ok("a saved template id is not", !isCustomPointsId("Zx19QpLm3aBcD4eF5gH6"));
ok("a builtin id is not", !isCustomPointsId("builtin-nascar"));
ok("the dropdown's custom option is never a stored id", !isCustomPointsId(CUSTOM_POINTS_OPTION));
ok("two structures minted back to back never collide", newCustomPointsId() !== newCustomPointsId());
check("a class's structure is named for the class as well as the session",
  customPointsName("Race", "Pro"), "Custom — Pro · Race");
check("an event-wide one is named for the session alone",
  customPointsName("Qualifying"), "Custom — Qualifying");

// ── 2. What arrives over the wire becomes a points structure ──────────────

check("a structure comes back in the shape a points template has",
  sanitizeCustomPoints({ race_points: { 1: 50, 2: "40" }, qual_points: { 1: 5 }, bonus_points: { best_lap: "2" } },
    { name: "Custom — Race" }),
  { name: "Custom — Race", race_points: { 1: 50, 2: 40 }, qual_points: { 1: 5 }, bonus_points: { best_lap: 2 } });
check("nothing sent is not a structure", sanitizeCustomPoints(null), null);
check("a body with no points in it is not a structure either", sanitizeCustomPoints({ name: "x" }), null);
check("a blank scale saves as an explicit zero rather than falling back to a default",
  sanitizeCustomPoints({ race_points: {}, qual_points: null, bonus_points: {} }).race_points, { 1: 0 });
check("…and so does the qualifying scale",
  sanitizeCustomPoints({ race_points: { 1: 10 } }).qual_points, { 1: 0 });
check("junk positions and junk values are dropped, not stored as NaN",
  sanitizeCustomPoints({ race_points: { 1: 25, 0: 9, x: 4, 3: "nope" } }).race_points, { 1: 25 });
check("bonus keys that aren't code identifiers never reach the document",
  sanitizeCustomPoints({ race_points: { 1: 1 }, bonus_points: { "a.b": 3, best_lap: 1 } }).bonus_points,
  { best_lap: 1 });

// ── 3. It scores through the same lookup a template does ──────────────────

const custom = sanitizeCustomPoints({ race_points: { 1: 12, 2: 6 }, qual_points: { 1: 1 }, bonus_points: {} },
  { name: "Custom — Race" });
const race = { id: "r1", season_id: "s1", session_points: { Race: id }, custom_points: { [id]: custom } };

check("a race's structures read as templates", customTemplatesOf(race).map(t => t.id), [id]);
check("…keeping their name for the dropdown", customTemplatesOf(race)[0].name, "Custom — Race");
check("a race with none has none", customTemplatesOf({ id: "r2" }), []);
check("junk under custom_points is ignored rather than rendered",
  customTemplatesOf({ custom_points: { "not-a-custom-id": { race_points: { 1: 5 } }, [id]: custom } }).map(t => t.id),
  [id]);

const lookup = templatesById({ races: [race], points_templates: [{ id: "tpl-1", name: "Sprint", race_points: { 1: 20 } }] });
ok("a session's own structure resolves in the one map every screen scores from", !!lookup[id]);
ok("…alongside the saved templates", !!lookup["tpl-1"]);
ok("…and the builtins", !!lookup["builtin-nascar"]);
check("scoring it is scoring a template — no special case",
  configForTemplate({ dropWeeks: 0, racePoints: { 1: 100 }, qualPoints: {}, bonuses: {} }, lookup[id]).racePoints,
  { 1: 12, 2: 6 });
check("a bundle with no races simply has no custom structures in it",
  Object.keys(customTemplatesById([])), []);

// The whole point of it: the library is untouched.
ok("a custom structure is not a points_templates document",
  !(race.custom_points[id].id) && lookup[id].custom === true);

// ── 4. It dies with the last thing pointing at it ─────────────────────────

check("a structure a session still names is in use",
  [...customPointsInUse(race, [])], [id]);
check("…so is one only a saved result still points at",
  [...customPointsInUse({ id: "r1" }, [id])], [id]);
check("a heat default naming one counts too",
  [...customPointsInUse({ heat_points_template_id: id }, [])], [id]);
check("a class's own session assignment counts too",
  [...customPointsInUse({ session_points_by_class: { pro: { Race: id } } }, [])], [id]);
check("template ids are not custom ids and are never pruned against",
  [...customPointsInUse({ session_points: { Race: "tpl-1" } }, ["tpl-1"])], []);

check("nothing changes while the structure is still in use", prunedCustomPoints(race, [id]), null);
check("a session moved off its structure takes the structure with it",
  prunedCustomPoints({ ...race, session_points: { Race: "tpl-1" } }, ["tpl-1"]), {});
check("…but not while another session of the event still scores on it",
  prunedCustomPoints({ ...race, session_points: { Race: "tpl-1" }, session_points_by_class: { pro: { Race: id } } }, []),
  null);
check("a race that never had one needs no write", prunedCustomPoints({ id: "r2" }, []), null);

// ── 5. A copy gets structures of its own ──────────────────────────────────

ok("a copied event carries its one-off structures", COPIED_RACE_FIELDS.includes("custom_points"));

const source = {
  ...race,
  session_points: { Race: id, Qualifying: "tpl-1" },
  session_points_by_class: { "src-pro": { Race: id } },
  heat_points_template_id: id,
};
const idMap = customPointsIdMap(source);
const copied = copyRaceDoc(source, {
  season_id: "s2", round_number: 3, classMap: { "src-pro": "tgt-pro" }, customPointsMap: idMap,
});

check("the copy stores the structure under an id of its own",
  Object.keys(copied.custom_points), [idMap[id]]);
ok("…which is not the source's", idMap[id] !== id);
check("…with the same numbers", copied.custom_points[idMap[id]].race_points, { 1: 12, 2: 6 });
check("the copy's session points at the copy's structure", copied.session_points.Race, idMap[id]);
check("a league-wide template id is left alone — it still means the same thing",
  copied.session_points.Qualifying, "tpl-1");
check("a class's assignment is remapped on both sides at once",
  copied.session_points_by_class, { "tgt-pro": { Race: idMap[id] } });
check("a heat default naming one follows it too", copied.heat_points_template_id, idMap[id]);

const { rows } = copyResultDocs(
  [{ entry_id: "e1", finish_pos: 1, points_template_id: id },
    { entry_id: "e1", finish_pos: 2, points_template_id: "tpl-1" }],
  { race_id: "r2", season_id: "s2", entryMap: { e1: "t1" }, customPointsMap: idMap });
check("a copied result scores off the copy's structure, never the original's",
  rows[0].points_template_id, idMap[id]);
check("a result on a saved template is untouched", rows[1].points_template_id, "tpl-1");
check("an event with no custom structures maps nothing", customPointsIdMap({ id: "r3" }), {});
check("an unmapped id passes straight through", mapTemplateId("tpl-9", idMap), "tpl-9");
check("copying an ordinary event adds no custom_points field",
  copyRaceDoc({ name: "Round 1" }, { season_id: "s2", round_number: 1 }).custom_points, undefined);

// A caller that forgets the map must still not hand two events one id — the
// copy mints its own rather than duplicating the source's.
const lone = copyRaceDoc(source, { season_id: "s2", round_number: 4, classMap: {} });
check("a copy made without an id map still gets exactly one structure",
  Object.keys(lone.custom_points).length, 1);
ok("…under an id of its own", !lone.custom_points[id]);
check("…that its own session names", lone.session_points.Race, Object.keys(lone.custom_points)[0]);

console.log(`all ${n} checks passed — a session can score on points of its own without leaving a template behind`);
