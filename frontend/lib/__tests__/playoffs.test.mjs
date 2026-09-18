// Playoffs: the four questions, and the bracket that falls out of them.
//
// A playoff format is not one rule, it's an answer sheet — who is in it, what
// they start on, how it's raced, what a result is worth. These assertions pin
// down the parts a league would notice getting wrong, in the order they'd
// notice them:
//
//   1. A season without the tick is untouched. Nothing here may change how an
//      ordinary season is scored or who it crowns.
//   2. Where the regular season ends, including when nobody typed it.
//   3. The ladder: which races belong to which round.
//   4. Playoff points, the currency that survives a reset.
//   5. THE ONE THAT MATTERS: a win in a round advances a driver over somebody
//      ahead of them on points. That is the whole reason leagues run these,
//      and it's the rule a points-shaped implementation quietly drops.
//   6. A reset means reset — the finalists start level, and the title goes to
//      whoever beats the others from there.
//   7. The crowns: the playoff winner takes the championship, not the points
//      leader, and the regular season champion is a SECOND title.
import assert from "node:assert";
import {
  BLANK_PLAYOFF_CONFIG, applyFormatPreset, buildPlayoffs, defaultRoundsFor,
  describePlayoffFormat, normalizePlayoffConfig, playoffLabelForRace, playoffPointsFor,
  playoffSetupWarnings, playoffsOn, resolveRegularRounds, roundPlan, seasonPlayoffConfig,
  splitRaces,
} from "../playoffs.js";
import { seasonChampions, titlesByEntry } from "../champions.js";
import { resolveSeasonConfig } from "../standings.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── The fixture ────────────────────────────────────────────────────────────
//
// Eight rounds. Four of regular season, then a 4-driver playoff: a Round of 4
// over two races cutting to two, then a two-race Championship the finalists
// start level in.
//
// P1 100 · P2 90 · P3 80 · P4 70 · P5 60.
const pointsConfig = resolveSeasonConfig({
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70, 5: 60 }),
  qual_points: JSON.stringify({ 1: 10, 2: 5 }),
  bonus_points: {},
}, null);

// E9 is on the roster and has never turned a lap — the wildcard nobody's rule
// could ever find.
const entries = [...["e1", "e2", "e3", "e4", "e5"].map(id => ({ id, name: id.toUpperCase() })),
  { id: "e9", name: "Ghost" }];

const races = Array.from({ length: 8 }, (_, i) => ({
  id: `r${i + 1}`, name: `Round ${i + 1}`, round_number: i + 1, date: `2026-03-0${i + 1}`,
}));

// One race's finishing order, as results.
const finish = (raceId, order, session_type = "race") =>
  order.map((entry_id, i) => ({ race_id: raceId, entry_id, session: "Race", session_type, finish_pos: i + 1 }));

const results = [
  ...finish("r1", ["e1", "e2", "e3", "e4", "e5"]),
  ...finish("r2", ["e1", "e2", "e3", "e4", "e5"]),
  ...finish("r3", ["e2", "e1", "e3", "e4", "e5"]),
  ...finish("r4", ["e1", "e2", "e3", "e4", "e5"]),
  // Round of 4: E2 wins one, E3 wins the other — and E1 outscores both.
  ...finish("r5", ["e2", "e1", "e3", "e4"]),
  ...finish("r6", ["e3", "e4", "e1", "e2"]),
  // Championship: E3 takes both — while E2, beaten in both, still ends the year
  // with more raw points than anybody. That gap is the whole feature: a playoff
  // season's champion is not its points leader.
  ...finish("r7", ["e3", "e2"]),
  ...finish("r8", ["e3", "e2"]),
];

const playoffConfig = {
  format: "elimination",
  regular_rounds: 4,
  field_size: 4,
  qualify_mode: "points",
  seed_mode: "base_plus_bonus",
  seed_base: 100,
  rounds: [
    { name: "Round of 4", races: 2, advance: 2, reset_base: 100 },
    { name: "Championship 2", races: 2, advance: 1, reset_base: 200 },
  ],
  reset_between_rounds: true,
  advance_on_win: true,
  finale_mode: "points",
  finale_reset: true,
  playoff_points_enabled: true,
  playoff_points: { win: 5, stage_win: 1, pole: 0, round_win: 0, regular_champion: 10, positions: "" },
  carry_playoff_points: true,
  regular_season_champion: true,
  regular_season_counts_title: true,
};

const season = { id: "s1", name: "Season 1", status: "active", playoffs_enabled: true, playoff_config: playoffConfig };
const build = (over = {}) => buildPlayoffs({
  season: { ...season, ...over }, races, results, entries, pointsConfig,
});

// ── 1. A season without the tick is untouched ──────────────────────────────
ok("no tick, no playoff", !playoffsOn({ playoff_config: playoffConfig }));
check("and nothing is built for it", buildPlayoffs({
  season: { id: "s0" }, races, results, entries, pointsConfig,
}), null);
check("nor for a season that has never heard of playoffs", seasonPlayoffConfig({ id: "s0" }), null);

// ── 2. Where the regular season ends ───────────────────────────────────────
check("a cutoff that was typed is the cutoff", resolveRegularRounds({ regular_rounds: 4 }, races), 4);
// THE POINT: nobody should have to work out 26. A ladder asking for 4 races off
// an 8-round calendar leaves a 4-round regular season.
check("and one that wasn't is counted back from the end",
  resolveRegularRounds({ regular_rounds: 0, rounds: playoffConfig.rounds }, races), 4);
check("a Chase-shaped round (races: 0) can't be subtracted, so only the finale is playoff",
  resolveRegularRounds({ regular_rounds: 0, rounds: [{ name: "The Chase", races: 0, advance: 1 }] }, races), 7);

const split = splitRaces(races, playoffConfig);
check("the regular season is rounds 1-4", split.regular.map(r => r.id), ["r1", "r2", "r3", "r4"]);
check("the playoff is everything after", split.playoff.map(r => r.id), ["r5", "r6", "r7", "r8"]);
check("an unnumbered race is never swept into the playoff",
  splitRaces([...races, { id: "rX", round_number: null }], playoffConfig).playoff.map(r => r.id),
  ["r5", "r6", "r7", "r8"]);

// ── 3. The ladder ──────────────────────────────────────────────────────────
const plan = roundPlan(playoffConfig, split.playoff);
check("each round takes the next races off the calendar",
  plan.map(r => [r.name, r.race_ids]),
  [["Round of 4", ["r5", "r6"]], ["Championship 2", ["r7", "r8"]]]);
check("a round asking for 0 races takes everything left",
  roundPlan({ rounds: [{ name: "The Chase", races: 0, advance: 1 }] }, split.playoff)[0].race_ids,
  ["r5", "r6", "r7", "r8"]);
check("a race knows which round it belongs to", playoffLabelForRace("r6", plan),
  { round_name: "Round of 4", race_index: 2, race_count: 2, is_final: false, is_decider: false });
check("and the decider says so", playoffLabelForRace("r8", plan).is_decider, true);
check("an ordinary round belongs to none of it", playoffLabelForRace("r2", plan), null);

// ── 4. Playoff points ──────────────────────────────────────────────────────
const pp = { playoff_points_enabled: true, playoff_points: { win: 5, stage_win: 1, pole: 2, positions: "0, 0, 3" } };
check("a win pays the win value", playoffPointsFor({ session_type: "race", finish_pos: 1 }, pp), 5);
check("the positions table pays on top", playoffPointsFor({ session_type: "race", finish_pos: 3 }, pp), 3);
check("a pole is position 1 of qualifying", playoffPointsFor({ session_type: "qualifying", finish_pos: 1 }, pp), 2);
check("second on the grid is not", playoffPointsFor({ session_type: "qualifying", finish_pos: 2 }, pp), 0);
check("a heat win is this app's stage win", playoffPointsFor({ session_type: "heat", finish_pos: 1 }, pp), 1);
check("a session run for no championship points pays none",
  playoffPointsFor({ session_type: "race", finish_pos: 1, counts_points: false }, pp), 0);
check("and neither does a driver who never started",
  playoffPointsFor({ session_type: "race", finish_pos: 1, status: "dns" }, pp), 0);
check("switched off, nothing is paid at all",
  playoffPointsFor({ session_type: "race", finish_pos: 1 }, { ...pp, playoff_points_enabled: false }), 0);

// ── 5. The field, and the win that beats the points ────────────────────────
const built = build();

check("the regular season champion leads the regular season, not the year",
  built.regular_champion.entry_id, "e1");
check("…on regular-season points alone", built.regular_champion.points, 390);
check("the field is the top four", built.seeds.map(s => s.entry_id), ["e1", "e2", "e3", "e4"]);
check("E5 missed it", built.outsiders.map(s => s.entry_id), ["e5"]);
// E1 won three regular-season races (15) and took the regular season title (10).
check("banked playoff points seed the field", built.seeds.map(s => s.playoff_points), [25, 5, 0, 0]);
check("so the reset isn't flat", built.seeds.map(s => s.points), [125, 105, 100, 100]);

const roundOne = built.rounds[0];
check("everyone in the field races the first round", roundOne.rows.length, 4);
check("E1 leads it on points",
  [...roundOne.rows].sort((a, b) => b.points - a.points)[0].entry_id, "e1");

// THE ONE THAT MATTERS. E1 scored more than anybody in the Round of 4 — and
// goes home, because the two drivers who WON a race in it took both slots.
// Every other rule in this file is arithmetic; this one is the format.
check("the race winners advance", roundOne.advanced.sort(), ["e2", "e3"]);
check("the points leader is eliminated anyway", roundOne.eliminated.sort(), ["e1", "e4"]);
check("and the table says so", roundOne.rows.find(r => r.entry_id === "e1").status, "eliminated");

// Switch that rule off and it is a points round again, which is what a Chase is.
const noWinRule = build({ playoff_config: { ...playoffConfig, advance_on_win: false } });
check("without it, the points decide the round", noWinRule.rounds[0].advanced.sort(), ["e1", "e3"]);

// Switched off, the switch is off. Nothing under Playoff Points pays — and that
// includes the regular season champion's bonus, which is the one that got away:
// it reads off a champion rather than off a result, so it sat outside the gate
// every other payout goes through and quietly seeded the regular season champion
// 15 clear of the field on a season that pays no playoff points at all.
const noPP = build({
  playoff_config: { ...playoffConfig, playoff_points_enabled: false },
});
check("with playoff points off, nobody has banked any",
  noPP.seeds.map(s => s.playoff_points), [0, 0, 0, 0]);
check("the regular season champion included",
  noPP.seeds.find(s => s.entry_id === "e1").playoff_points, 0);
// THE POINT: every seed is the reset base and nothing else. E1 was starting on
// 125 — 100 for the reset, 15 for the regular season title, 10 for three wins.
check("so the whole field starts the playoff level on the reset base",
  noPP.seeds.map(s => s.points), [100, 100, 100, 100]);
// And the champion is still crowned — the bonus is off, not the title.
check("the regular season champion is still crowned, just not paid",
  noPP.regular_champion.entry_id, "e1");
// A value left sitting in the box from before it was switched off pays nothing.
const stashed = build({
  playoff_config: {
    ...playoffConfig, playoff_points_enabled: false,
    playoff_points: { ...playoffConfig.playoff_points, regular_champion: 50, win: 25 },
  },
});
check("a value left in the box from before it was switched off pays nothing",
  stashed.seeds.map(s => s.points), [100, 100, 100, 100]);

// ── 5b. Wildcards: the driver a person puts in ─────────────────────────────
//
// E5 finished every regular-season round last and is nowhere near the cut. A
// wildcard is not an argument about whether they deserve it — somebody decided,
// and the bracket does as it's told.
const wild = build({
  playoff_config: { ...playoffConfig, wildcards: [{ entry_id: "e5", name: "E5" }] },
});
check("a wildcard is in the field however far off the pace they were",
  wild.seeds.map(s => s.entry_id).sort(), ["e1", "e2", "e3", "e5"]);
check("and the field is still the size it was — the pick took a slot",
  wild.seeds.length, 4);
// THE POINT: E4 was 4th on merit and is out, because a place was given away.
check("so the last driver in on points drops out", wild.outsiders.map(s => s.entry_id), ["e4"]);
check("the table says how they got in",
  wild.seeds.find(s => s.entry_id === "e5").qualified_by, "wildcard");
check("everyone else got in the ordinary way",
  wild.seeds.filter(s => s.qualified_by !== "wildcard").map(s => s.entry_id), ["e1", "e2", "e3"]);
// Seeded on their own points like anybody else: E5 scored least, so E5 is 4th.
check("a wildcard lines up on their own points, not at the back by default",
  wild.seeds.find(s => s.entry_id === "e5").seed, 4);

// Added on top instead, and nobody loses their place.
const extra = build({
  playoff_config: { ...playoffConfig, wildcards: [{ entry_id: "e5", name: "E5" }], wildcard_mode: "extra" },
});
check("a wildcard added on top makes the field bigger", extra.seeds.length, 5);
check("and costs nobody their place", extra.outsiders, []);

// Behind the whole field, whatever the points say.
const behind = build({
  playoff_config: {
    ...playoffConfig,
    field_size: 3,
    wildcards: [{ entry_id: "e1", name: "E1" }],
    wildcard_mode: "extra",
    wildcard_seed: "last",
  },
});
check("seeded last, a wildcard lines up behind every driver who qualified",
  behind.seeds.map(s => s.entry_id), ["e2", "e3", "e4", "e1"]);
check("even the one who led the regular season",
  behind.seeds.find(s => s.entry_id === "e1").seed, 4);

// A pick who never turned a lap is still a pick. This is the case a rule-shaped
// implementation drops: there is no standings row to seed them off, and the
// wrong answer is to quietly leave them out.
const ghost = build({
  playoff_config: {
    ...playoffConfig,
    wildcards: [{ entry_id: "e9", name: "Nobody" }],
    wildcard_mode: "extra",
  },
});
const ghostSeed = ghost.seeds.find(s => s.entry_id === "e9");
ok("a wildcard with no results at all is still in the field", !!ghostSeed);
check("named from the roster rather than left blank", ghostSeed.driver_name, "Ghost");
check("on no regular-season points", ghostSeed.regular_points, 0);
check("and seeded last, since there is nothing behind them", ghostSeed.seed, ghost.seeds.length);

// The minimum-starts rule is a rule, so a wildcard overrides it too.
const strict = build({
  playoff_config: {
    ...playoffConfig, min_starts: 99,
    wildcards: [{ entry_id: "e5", name: "E5" }],
  },
});
check("min-starts empties the field of everyone who qualified on merit",
  strict.seeds.filter(s => s.qualified_by !== "wildcard"), []);
check("but the wildcard is still in", strict.seeds.map(s => s.entry_id), ["e5"]);

// Picked twice is picked once, and a pick with no driver behind it is no pick.
check("a duplicate pick is one wildcard",
  normalizePlayoffConfig({ wildcards: [{ entry_id: "e5" }, { entry_id: "e5", name: "E5" }] }).wildcards.length, 1);
check("a blank pick is dropped",
  normalizePlayoffConfig({ wildcards: [{ entry_id: "" }, "  "] }).wildcards, []);
check("a bare id reads as a pick",
  normalizePlayoffConfig({ wildcards: ["e5"] }).wildcards, [{ entry_id: "e5", name: "" }]);

// And the crowns follow the bracket, wildcard or not — a wildcard can win it.
const wildCrowns = seasonChampions(
  { ...season, status: "completed", playoff_config: { ...playoffConfig, wildcards: [{ entry_id: "e5", name: "E5" }] } },
  results, entries, pointsConfig, {}, [], races,
);
check("a season with a wildcard still crowns whoever came out of the bracket",
  wildCrowns.find(c => c.kind === "overall").entry_id, "e3");

// ── 6. A reset means reset ─────────────────────────────────────────────────
const finalRound = built.rounds[1];
check("only the survivors are in the final round", finalRound.rows.map(r => r.entry_id).sort(), ["e2", "e3"]);
check("and they start it dead level", [...new Set(finalRound.rows.map(r => r.started_on))], [200]);
check("E3 wins both and takes the title", built.champion.entry_id, "e3");
check("on the points it scored in the round", built.champion.points, 400);
// E2 out-scored E3 over the season and is still not the champion. Without a
// playoff this same set of results crowns E2 — see the last case in section 7.

// Raced on best finish instead, the last race alone decides it.
const bestFinish = build({
  playoff_config: {
    ...playoffConfig,
    finale_mode: "best_finish",
    rounds: [
      { name: "Round of 4", races: 2, advance: 2, reset_base: 100 },
      { name: "Championship 2", races: 2, advance: 1, reset_base: 200 },
    ],
  },
});
check("the best finisher in the deciding race is champion", bestFinish.champion.entry_id, "e3");
check("and the round says how it was settled", bestFinish.rounds[1].decided_on, "best_finish");

// Nothing is decided while a round is still being raced.
const midSeason = buildPlayoffs({
  season, races, entries, pointsConfig,
  results: results.filter(r => !["r7", "r8"].includes(r.race_id)),
});
check("a playoff still running has no champion", midSeason.champion, null);
check("but the round that's been raced has been settled", midSeason.rounds[0].complete, true);
check("so the next one is already seeded and waiting",
  midSeason.rounds[1].rows.map(r => r.entry_id).sort(), ["e2", "e3"]);
check("with its finalists level and nothing scored",
  [...new Set(midSeason.rounds[1].rows.map(r => r.points))], [200]);
check("and the active round named", midSeason.active_round.name, "Championship 2");

// A round still being raced settles nothing, and the ladder past it stays empty
// rather than guessing at a field.
const midRound = buildPlayoffs({
  season, races, entries, pointsConfig,
  results: results.filter(r => !["r6", "r7", "r8"].includes(r.race_id)),
});
check("an unfinished round advances nobody", midRound.rounds[0].advanced, []);
check("and nobody is knocked out of it yet", midRound.rounds[0].eliminated, []);
check("the round after it is on the ladder but empty", midRound.rounds[1].rows, []);
check("and it is the round being raced", midRound.active_round.name, "Round of 4");

// ── 7. The crowns ──────────────────────────────────────────────────────────
const done = { ...season, status: "completed" };
const crowns = seasonChampions(done, results, entries, pointsConfig, {}, [], races);
check("the playoff winner is the champion, not the points leader",
  crowns.find(c => c.kind === "overall").entry_id, "e3");
check("and the regular season champion is a crown of their own",
  crowns.find(c => c.kind === "regular_season").entry_id, "e1");
check("two crowns, two drivers", crowns.length, 2);

const titles = titlesByEntry(crowns);
check("each of them scores a title", [titles.get("e1").titles, titles.get("e3").titles], [1, 1]);
check("and the regular season one is named as what it is",
  titles.get("e1").labels, ["Regular Season Champion"]);
// The profile lists one line per crown off these, so a regular season title has
// to survive as a crown and not only as a number — a count of 1 with an empty
// list is how a championship goes missing from somebody's record.
check("the crown itself travels with the count",
  titles.get("e1").crowns.map(c => c.kind), ["regular_season"]);
check("as does the playoff one", titles.get("e3").crowns.map(c => c.kind), ["overall"]);

// A format that doesn't crown a regular season champion simply doesn't.
const noRegular = seasonChampions(
  { ...done, playoff_config: { ...playoffConfig, regular_season_champion: false } },
  results, entries, pointsConfig, {}, [], races,
);
check("no regular season champion when the series doesn't crown one",
  noRegular.map(c => c.kind), ["overall"]);

// Crowned but not counted: an honour on the standings that isn't a title.
const honourOnly = seasonChampions(
  { ...done, playoff_config: { ...playoffConfig, regular_season_counts_title: false } },
  results, entries, pointsConfig, {}, [], races,
);
check("an uncounted regular season championship adds no title",
  honourOnly.map(c => c.kind), ["overall"]);
check("though the standings still show it",
  build({ status: "completed", playoff_config: { ...playoffConfig, regular_season_counts_title: false } })
    .regular_champion.entry_id, "e1");

// A season with the tick on but no playoff ever raced still crowns somebody.
const neverRaced = seasonChampions(
  done, results.filter(r => ["r1", "r2", "r3", "r4"].includes(r.race_id)),
  entries, pointsConfig, {}, [], races,
);
check("a playoff that never ran falls back to the points leader",
  neverRaced.find(c => c.kind === "overall").entry_id, "e1");

// And an ordinary season is crowned exactly as it always was: one crown, to
// whoever led the points over all eight rounds. That is E2 — who the playoff
// above did NOT crown. Same results, same scoring, different champion, which is
// the difference the whole feature exists to make.
check("no playoff, no change",
  seasonChampions({ id: "s2", status: "completed" }, results, entries, pointsConfig, {}, [], races)
    .map(c => [c.kind, c.entry_id]),
  [["overall", "e2"]]);

// ── 8. The menu's own answers ──────────────────────────────────────────────
const blank = normalizePlayoffConfig(null);
check("a missing config is the default format", blank.format, BLANK_PLAYOFF_CONFIG.format);
check("and comes with a ladder rather than no rounds at all", blank.rounds.length > 0, true);
check("a config stored as JSON reads the same",
  normalizePlayoffConfig(JSON.stringify({ field_size: 12 })).field_size, 12);
check("strings off the menu's number boxes are numbers by the time they're rules",
  normalizePlayoffConfig({ field_size: "12", seed_base: "2000" }).field_size, 12);
check("and nonsense is the default, never NaN",
  normalizePlayoffConfig({ field_size: "abc", seed_base: "oops" }).seed_base, BLANK_PLAYOFF_CONFIG.seed_base);
check("an explicit false survives", normalizePlayoffConfig({ advance_on_win: false }).advance_on_win, false);

check("the default 16-driver ladder is the one leagues expect",
  defaultRoundsFor({ field_size: 16, seed_base: 2000 }).map(r => r.advance), [12, 8, 4, 1]);
check("and its last round is the one that decides it",
  defaultRoundsFor({ field_size: 16 }).at(-1).name, "Championship 4");

const chase = applyFormatPreset(BLANK_PLAYOFF_CONFIG, "chase_2004");
check("the Chase is ten drivers", chase.field_size, 10);
check("in one round", chase.rounds.length, 1);
check("seeded in steps", [chase.seed_mode, chase.seed_base, chase.seed_gap], ["carry_gap", 5050, 5]);
const elim = applyFormatPreset(chase, "elimination");
check("switching to eliminations rebuilds the ladder", elim.rounds.map(r => r.advance), [12, 8, 4, 1]);
check("Custom keeps everything and only renames the format",
  applyFormatPreset(elim, "custom").rounds.length, elim.rounds.length);

ok("the summary line describes the format",
  describePlayoffFormat(playoffConfig).includes("4 drivers"));

// ── 9. Warnings, which never refuse a save ─────────────────────────────────
check("a sound format warns about nothing", playoffSetupWarnings(playoffConfig, races), []);
ok("a ladder longer than the calendar is called out",
  playoffSetupWarnings({ ...playoffConfig, rounds: [{ name: "R", races: 9, advance: 1 }] }, races)
    .some(w => w.includes("only")));
ok("a last round that advances two says nothing decides the title",
  playoffSetupWarnings({ ...playoffConfig, rounds: [{ name: "R", races: 4, advance: 2 }] }, races)
    .some(w => w.includes("nothing decides the title")));
ok("a cutoff past the end of the calendar leaves nothing to race",
  playoffSetupWarnings({ ...playoffConfig, regular_rounds: 8 }, races)
    .some(w => w.includes("Nothing to race")));
ok("a field made entirely of wildcards says the racing decides nothing",
  playoffSetupWarnings({ ...playoffConfig, field_size: 2, wildcards: [{ entry_id: "a" }, { entry_id: "b" }] }, races)
    .some(w => w.includes("Every place in the field is a wildcard")));
ok("a pick who has left the roster is called out by name",
  playoffSetupWarnings({ ...playoffConfig, wildcards: [{ entry_id: "gone", name: "Old Mate" }] }, races, entries)
    .some(w => w.includes("Old Mate")));
check("and no roster to check against raises nothing",
  playoffSetupWarnings({ ...playoffConfig, wildcards: [{ entry_id: "gone", name: "Old Mate" }] }, races), []);

console.log(`playoffs: ${n} assertions passed`);
