// Every session scores itself. The one invariant that matters:
//
//   a driver's championship total == the sum of the Points column on every
//   session they ran
//
// Each case below asserts the total AND that it equals the per-session sum, so
// the standings can always be checked by adding up what is on screen.
import assert from "node:assert";
import {
  calculateStandings, decorateRaceBonuses, decorateSessionFlags,
  resolveSeasonConfig, makeScorer, pointsFor, explainPoints,
} from "../standings.js";

// race P1 100 / P2 90 / P3 80 · qualifying P1 10 / P2 5
const season = {
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80 }),
  qual_points: JSON.stringify({ 1: 10, 2: 5 }),
  bonus_points: {},
};
const config = resolveSeasonConfig(season, null);
const entries = [{ id: "e1", name: "Ana" }, { id: "e2", name: "Bo" }];

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// Score a season, and prove the total is the sum of what each grid displays.
function score(results, racesById, { templatesById = {}, classes = [], cfg = config } = {}) {
  const decorated = decorateRaceBonuses(decorateSessionFlags(results, racesById));
  const out = calculateStandings(decorated, entries, [], cfg, templatesById, classes);
  const totals = Object.fromEntries(out.rows.map(r => [r.entry_id, r.adjusted_points]));

  // The Points column every grid renders, driver by driver.
  const scorer = makeScorer(decorated, { config: cfg, classes, entriesById: Object.fromEntries(entries.map(e => [e.id, e])), templatesById });
  const onScreen = {};
  for (const r of decorated) {
    if (r.counts_points === false) continue;
    onScreen[r.entry_id] = (onScreen[r.entry_id] || 0) + scorer.points(r);
  }
  if (!cfg.dropWeeks) {
    for (const id of Object.keys(totals)) {
      assert.strictEqual(totals[id], onScreen[id] ?? 0,
        `the standings must equal the sum of every grid's Points column for ${id}: total ${totals[id]}, grids ${onScreen[id]}`);
    }
  }
  return totals;
}

const q = (entry, pos, extra = {}) => ({ race_id: "r1", entry_id: entry, session: "Qualifying", session_type: "qualifying", finish_pos: pos, ...extra });
const race = (entry, session, pos, extra = {}) => ({ race_id: "r1", entry_id: entry, session, session_type: "race", finish_pos: pos, ...extra });

// ── 1. The ordinary weekend: qualifying is a line of its own ──────────────
// Ana: pole 10 + win 100 = 110. Bo: P2 qual 5 + P2 race 90 = 95.
check("one race", score([q("e1", 1), q("e2", 2), race("e1", "Race", 1), race("e2", "Race", 2)],
  { r1: { sessions: ["Race"] } }), { e1: 110, e2: 95 });

// ── 2. Qualifying alone already scores — before the race is even entered ──
// This is what "qualifying isn't being added" looked like: enter Qualifying,
// check the standings, see nothing, because the points had nowhere to be folded.
check("qualifying entered, race not yet", score([q("e1", 1), q("e2", 2)], { r1: { sessions: ["Race"] } }),
  { e1: 10, e2: 5 });

// ── 3. A doubleheader pays qualifying ONCE — there is one Qualifying ──────
// Ana: 10 + 100 + 90 = 200. Bo: 5 + 90 + 100 = 195.
check("doubleheader", score([
  q("e1", 1), q("e2", 2),
  race("e1", "Race 1", 1), race("e2", "Race 1", 2),
  race("e1", "Race 2", 2), race("e2", "Race 2", 1),
], { r1: { sessions: ["Race 1", "Race 2"] } }), { e1: 200, e2: 195 });

// ── 4. Three races, still one Qualifying ─────────────────────────────────
check("three races", score([
  q("e1", 1), race("e1", "Race 1", 1), race("e1", "Race 2", 1), race("e1", "Sprint", 1),
], { r1: { sessions: ["Race 1", "Race 2", "Sprint"] } }), { e1: 310 });

// ── 5. Heat format, default toggles: heats/consolations score nothing ─────
check("heat default", score([
  q("e1", 1),
  { race_id: "r1", entry_id: "e1", session: "Heat 1", session_type: "heat", finish_pos: 1 },
  { race_id: "r1", entry_id: "e1", session: "A-Main Feature", session_type: "feature", finish_pos: 1 },
], { r1: { heat_format: true, heats: ["Heat 1"], consolations: [], feature_name: "A-Main Feature" } }), { e1: 110 });

// ── 6. Heats switched on: every scoring session adds, nothing is folded ───
check("heats on", score([
  q("e1", 1),
  { race_id: "r1", entry_id: "e1", session: "Heat 1", session_type: "heat", finish_pos: 2 },
  { race_id: "r1", entry_id: "e1", session: "A-Main Feature", session_type: "feature", finish_pos: 1 },
], { r1: { heat_format: true, heats: ["Heat 1"], consolations: [], feature_name: "A-Main Feature", session_points_enabled: { "Heat 1": true } } }), { e1: 200 });

// ── 7. Qualifying's points toggle turns the award off ─────────────────────
// A grid-setting-only qualifying session: still shown, still feeds Poles and
// Average Start, pays nothing.
check("qualifying points off", score([q("e1", 1), race("e1", "Race", 1)],
  { r1: { sessions: ["Race"], session_points_enabled: { Qualifying: false } } }), { e1: 100 });

// ── 8. A DNS in qualifying scores nothing ────────────────────────────────
check("qualifying DNS", score([q("e1", 1, { status: "dns" }), race("e1", "Race", 1)],
  { r1: { sessions: ["Race"] } }), { e1: 100 });

// ── 9. The session list naming Qualifying is now irrelevant to scoring ────
// It was the source of a whole class of bugs while the award had to be hidden
// inside a race. Nothing reads it for points any more.
check("sessions names Qualifying", score([q("e1", 1), race("e1", "Race", 1)],
  { r1: { sessions: ["Qualifying", "Race"] } }), { e1: 110 });

// ── 10. Legacy rows with no session name ─────────────────────────────────
check("legacy rows", score([
  { race_id: "r1", entry_id: "e1", session_type: "qualifying", finish_pos: 1 },
  { race_id: "r1", entry_id: "e1", session_type: "race", finish_pos: 1 },
], { r1: { sessions: ["Race"] } }), { e1: 110 });

// ── 11. Split event: each class's Qualifying scores in its own class ──────
{
  const cq = (entry, cls, pos) => ({ ...q(entry, pos), class_id: cls });
  const cr = (entry, cls, session, pos) => ({ ...race(entry, session, pos), class_id: cls });
  // 4 wins (400) + pro pole (10) + am P2 (5) = 415.
  check("split classes", score([
    cq("e1", "pro", 1), cq("e1", "am", 2),
    cr("e1", "pro", "Race 1", 1), cr("e1", "am", "Race 1", 1),
    cr("e1", "pro", "Race 2", 1), cr("e1", "am", "Race 2", 1),
  ], { r1: { sessions: ["Race 1", "Race 2"] } }), { e1: 415 });
}

// ── 12. Undecorated results score identically ────────────────────────────
// Nothing about scoring depends on the race docs any more.
{
  const raw = decorateRaceBonuses([q("e1", 1), race("e1", "Race", 1)]);
  const out = calculateStandings(raw, entries, [], config, {}, []);
  check("undecorated", { e1: out.rows[0].adjusted_points }, { e1: 110 });
}

// ── 13. A points template on the race does not govern Qualifying ─────────
// Qualifying scores off ITS OWN structure. A template assigned to Qualifying is
// what changes the qualifying scale; one assigned to the race changes the race.
{
  const blankQual = { race_points: JSON.stringify({ 1: 100 }), qual_points: JSON.stringify({ 1: 0 }), bonus_points: {} };
  const cfg = resolveSeasonConfig(blankQual, null);
  const templates = {
    imsa: { id: "imsa", race_points: { 1: 100 }, qual_points: { 1: 10 }, bonus_points: {} },
  };
  const races = { r1: { sessions: ["Race"] } };
  check("template on the race only",
    score([q("e1", 1), race("e1", "Race", 1, { points_template_id: "imsa" })], races, { templatesById: templates, cfg }),
    { e1: 100 });
  check("template on Qualifying pays the pole",
    score([q("e1", 1, { points_template_id: "imsa" }), race("e1", "Race", 1, { points_template_id: "imsa" })], races,
      { templatesById: templates, cfg }),
    { e1: 110 });
}

// ── 14. Racing bonuses can never leak into a qualifying row ──────────────
{
  const bonusCfg = resolveSeasonConfig({
    race_points: JSON.stringify({ 1: 100 }), qual_points: JSON.stringify({ 1: 10 }),
    bonus_points: { best_lap: 5, most_laps_led: 5, lead_a_lap: 5, halfway_point: 5, hard_charger: 5 },
  }, null);
  const ticked = { fastest_lap: true, most_laps_led: true, laps_led: 12, halfway_leader: true, hard_charger: true };
  check("qualifying ignores racing bonuses",
    pointsFor({ ...q("e1", 1), ...ticked }, bonusCfg), 10);
  check("a race pays them", pointsFor({ ...race("e1", "Race", 1), ...ticked }, bonusCfg), 125);
}

// ── 15. Per-result adjustments still apply to a qualifying row ───────────
check("qualifying adjustment", pointsFor({ ...q("e1", 1), points_adjustment: -4, bonus_points: 2 }, config), 8);

// ── 16. The itemised breakdown matches the number, on both kinds of row ──
{
  const sum = parts => parts.reduce((a, p) => a + Number(p.value || 0), 0);
  const pole = q("e1", 1);
  check("pole breakdown labelled", explainPoints(pole, config)[0].label, "Pole position");
  check("pole breakdown sums", sum(explainPoints(pole, config)), pointsFor(pole, config));
  const third = q("e1", 2);
  check("grid slot breakdown labelled", explainPoints(third, config)[0].label, "Qualified P2");
  check("grid slot breakdown sums", sum(explainPoints(third, config)), pointsFor(third, config));
  const win = race("e1", "Race", 1);
  check("race breakdown sums", sum(explainPoints(win, config)), pointsFor(win, config));
}


// ── 17. Drop weeks drop a whole ROUND, sessions added together ───────────
// Not the single lowest session — that would always throw away a qualifying
// run (a small number by design) and keep the bad race it went with.
{
  const dropCfg = { ...config, dropWeeks: 1 };
  const ev = (id, entry, qualPos, racePos) => ([
    { race_id: id, entry_id: entry, session: "Qualifying", session_type: "qualifying", finish_pos: qualPos },
    { race_id: id, entry_id: entry, session: "Race", session_type: "race", finish_pos: racePos },
  ]);
  const results = decorateRaceBonuses([...ev("r1", "e1", 1, 1), ...ev("r2", "e1", 2, 3)]);
  const out = calculateStandings(results, entries, [], dropCfg, {}, []);
  const row = out.rows[0];
  // Round 1 = 10 + 100 = 110. Round 2 = 5 + 80 = 85. Drop the worse ROUND (85).
  check("drop weeks: earned", row.points, 195);
  check("drop weeks: dropped a whole round", row.dropped_points, 85);
  check("drop weeks: total", row.adjusted_points, 110);
}

console.log(`all ${n} checks passed — totals equal the sum of every grid's Points column`);
