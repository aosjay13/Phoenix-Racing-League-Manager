// ── Playoffs ───────────────────────────────────────────────────────────────
//
// A season can end with a playoff: at some round the regular season stops, a
// regular season champion may be crowned, and the last rounds are raced for the
// title under a completely different set of rules.
//
// There is no single "playoff format" to implement, because leagues don't run
// one. They run whatever was voted on in the off-season, and that changes every
// year. So this file does NOT hard-code a format — it defines the four
// questions every playoff format is an answer to, and lets a season answer them
// however it likes:
//
//   1. WHO IS IN IT?      — how many drivers, and how they qualify (points, a
//                           win, everybody, or a WILDCARD the statistician
//                           simply names).
//   2. WHAT DO THEY START ON? — the seeding rule. Wiped to zero, reset to a
//                           base, a base plus the playoff points they banked,
//                           or their regular-season points carried straight
//                           over.
//   3. HOW IS IT RACED?   — the rounds. Each round is "this many races, this
//                           many drivers come out the other side", so ONE round
//                           of ten races that advances one driver is a Chase,
//                           and four rounds that cut 16 → 12 → 8 → 4 → champion
//                           are NASCAR's elimination playoffs. Both are the
//                           same three numbers typed differently.
//   4. WHAT IS A RESULT WORTH? — the ordinary points structure still scores the
//                           races (playoffs change who the points decide, not
//                           what a P4 pays). On top of it, PLAYOFF POINTS can
//                           be paid for wins, poles, heat/stage wins and top
//                           finishes, and they are what survives a reset.
//
// Every real format falls out of those four answers, which is why the presets
// below are just pre-filled configs and not code paths:
//
//   Chase (2004)          10 drivers · one 10-race round · seeded 5050 down in
//                         5-point steps
//   Chase (2007–2013)     12 drivers · one 10-race round · 5000 + 10 a win
//   Playoffs (2016–2025)  16 drivers · four rounds cutting to 12/8/4 · 2000 +
//                         playoff points, reset each round, the Championship
//                         race run level with the title to the best finisher
//   Points Reset          top X only, everyone level, one round to the end
//   Carry Over            top X only, points as they stand, one round
//   Winner Takes All      the last race decides it outright
//   Custom                anything the league voted for
//
// A season stores its answers as ONE object (`seasons.playoff_config`) next to
// the `playoffs_enabled` tick, rather than twenty-five loose season fields —
// the settings are meaningless apart from each other, they're written and read
// as a unit, and a format nobody has invented yet should not need a schema
// migration. normalizePlayoffConfig() below is the single place that decides
// what a missing, blank or hand-edited answer means, so every reader — the
// menu, the standings, the schedule badges and the champion tally — resolves a
// season the same way.

import { listToTable } from "@/lib/pointsTemplates";
import {
  calculateStandings, compareByTieBreakers, compareStandings,
  isDidNotStart, isPreliminarySession, isQualifying,
} from "@/lib/standings";

// Same rule as lib/standings.js: a figure that isn't a number reads as nothing,
// never as NaN. A playoff config can arrive from a restored backup or a
// hand-edited document, and one NaN in a seed would spread through a whole
// bracket with nothing on screen able to say which setting caused it.
const num = (raw, fallback = 0) => {
  const n = Number(raw === "" || raw == null ? fallback : raw);
  return Number.isFinite(n) ? n : fallback;
};
const int = (raw, fallback = 0) => Math.trunc(num(raw, fallback));
const bool = (raw, fallback = false) => (raw == null || raw === "" ? fallback : !!raw);
const text = (raw, fallback = "") => (raw == null ? fallback : String(raw));

// ── The answers, as pickable lists ─────────────────────────────────────────

// Who gets in. Every mode below fills the field to `field_size`; they differ in
// what gets you there first.
export const QUALIFY_MODES = [
  ["wins_then_points", "Wins first, then points",
    "Every regular-season race winner is in, highest in the points first. Any slots left over go to the leading drivers who didn't win. NASCAR's rule."],
  ["points", "Points only",
    "The top drivers in the regular-season standings, whether or not they won a race."],
  ["wins_only", "Race winners only",
    "Only drivers who won a regular-season race make it — the field can come out smaller than the size set below, and that's the point."],
  ["all", "Everybody",
    "The whole field carries on into the playoff. Use it with a points reset to run a genuine 'everyone starts level' run-in."],
];

// ── Wildcards ──────────────────────────────────────────────────────────────
//
// A wildcard is a driver the statistician puts in the playoff BY NAME. No rule
// decides it — not points, not wins, not starts — which is exactly the point:
// leagues hand out a place for a reason a formula has never heard of. A driver
// who missed three rounds with a dead PC and was quick in every other one. The
// champion of a feeder series. Somebody the league voted in.
//
// So a wildcard overrides everything: the qualifying rule, the field's points
// cutline and the minimum-starts rule alike. A pick who has not turned a lap all
// season is still in, seeded from nothing — because somebody decided they should
// be, and that decision is the whole feature.
//
// Two answers go with it, and both are real formats:

// Do the wildcards come out of the field, or on top of it?
export const WILDCARD_MODES = [
  ["within_field", "They take slots in the field",
    "A 16-driver field with 2 wildcards is still 16 drivers: the wildcards take the last two places and the qualifying rule fills the other fourteen. NASCAR's 2011–2013 wildcard."],
  ["extra", "They're added on top",
    "A 16-driver field with 2 wildcards races 18. The qualifying rule still fills all 16 places, and the wildcards join them."],
];

// And where do they line up?
export const WILDCARD_SEEDS = [
  ["points", "Seeded on their points, like everyone else",
    "A wildcard sitting 9th in the regular season is seeded 9th. Their place in the field was a gift; their place in the queue was earned."],
  ["last", "Seeded behind the whole field",
    "Every driver who qualified on merit lines up ahead of every wildcard, whatever the points say."],
];

// What the field starts the playoff on. There are only two answers, because
// there are only two things that can happen to a driver's total: it is replaced,
// or it isn't.
//
// This list used to have four, and the extra two were traps. Each was THIS first
// answer with one of its numbers thrown away — "Start over on zero" ignored the
// Reset base, and "Reset in seeded steps" was the only one that read the gap —
// so a league could type a number into a box sitting right there in the menu and
// watch it do nothing, with the menu still showing what they typed. Both still
// normalize onto the reset answer (see normalizeSeedMode), and because a season
// saved under either kept its base and its gap, every one of them reads exactly
// as it did.
//
// A reset is three numbers now, and all three always count:
//
//     seed N starts on   (Reset base) − (Points between seeds × seats below 1st)
//                        + the playoff points they banked, when those carry
//
// Everything real falls out of that. Flat reset to 2000: base 2000, gap 0.
// Clean sheet: base 0, gap 0. The 2004 Chase: base 5050, gap 5. One point a
// seat: base whatever, gap 1.
export const SEED_MODES = [
  ["base_plus_bonus", "Reset the field to a number you set",
    "Every driver drops to the Reset base — 2000 for NASCAR's playoffs, 0 for a clean sheet — then loses the gap below for each seat they are off the top, and adds the playoff points they banked."],
  ["carry_over", "Carry the regular season over",
    "Nobody's points move. The playoff simply narrows who can still win the title."],
];

// Does this answer put the field on numbers of its own? Carrying the regular
// season over is the only one that doesn't, so it is the only one the Reset base
// and the seed gap mean nothing to — and where the menu says so rather than
// leaving two live boxes that do nothing.
export function seedModeUsesBase(mode) {
  return normalizeSeedMode(mode) !== "carry_over";
}

// What seed N starts the playoff on, before the playoff points they banked.
// `seedIndex` is 0 for the top seed. Null when the format carries the regular
// season over, where a seed has no number of its own — their total is their
// total.
//
// This is the seeding arithmetic, and it lives here so that the menu's live
// preview of the field and the bracket the season is actually scored on are the
// same code. A preview computed separately is a preview that can agree with the
// menu and disagree with the results, which is worse than no preview at all.
export function seedBasePointsFor(config, seedIndex = 0) {
  const cfg = normalizePlayoffConfig(config);
  if (cfg.seed_mode === "carry_over") return null;
  return num(cfg.seed_base) - num(cfg.seed_gap) * Math.max(0, int(seedIndex, 0));
}

// How the title is settled in the last round.
export const FINALE_MODES = [
  ["points", "Points over the final round",
    "The finalists race the last round and whoever leads the playoff table at the end of it is champion."],
  ["best_finish", "Best finisher in the final race",
    "The finalists all start the final race level and the highest of them across the line takes the title, whatever anybody else does. NASCAR's Championship race."],
];

// ── The presets ────────────────────────────────────────────────────────────
//
// A preset is nothing but a filled-in config: picking one writes these answers
// into the menu, where every one of them can then be changed. "Custom" writes
// nothing at all, which is what makes an unlisted format possible.

export const PLAYOFF_FORMATS = [
  {
    key: "elimination",
    name: "Elimination Playoffs",
    tagline: "NASCAR Cup, 2016–2025",
    icon: "🪓",
    blurb: "Rounds that cut the field: 16 drivers, three races a round, four drivers left for a winner-take-all finale. A win in a round locks you into the next one.",
    defaults: {
      field_size: 16, qualify_mode: "wins_then_points",
      seed_mode: "base_plus_bonus", seed_base: 2000, seed_gap: 0,
      reset_between_rounds: true, advance_on_win: true,
      finale_mode: "best_finish", finale_reset: true,
      playoff_points_enabled: true,
      playoff_points: { win: 5, stage_win: 1, pole: 0, round_win: 0, regular_champion: 15, positions: "" },
      regular_season_champion: true,
    },
  },
  {
    key: "chase_2004",
    name: "The Chase",
    tagline: "NASCAR Cup, 2004–2006",
    icon: "🏁",
    blurb: "The top ten are reset to 5050 and separated by five points a seed, then race the last ten rounds for it. No eliminations — the points decide.",
    defaults: {
      field_size: 10, qualify_mode: "points",
      seed_mode: "base_plus_bonus", seed_base: 5050, seed_gap: 5,
      reset_between_rounds: false, advance_on_win: false,
      finale_mode: "points", finale_reset: false,
      playoff_points_enabled: false,
      playoff_points: { win: 0, stage_win: 0, pole: 0, round_win: 0, regular_champion: 0, positions: "" },
      regular_season_champion: false,
    },
  },
  {
    key: "chase_2007",
    name: "The Chase, with wins",
    tagline: "NASCAR Cup, 2007–2013",
    icon: "🎖",
    blurb: "Twelve drivers reset to 5000, plus ten points for every regular-season win they took. One long round to the end.",
    defaults: {
      field_size: 12, qualify_mode: "points",
      seed_mode: "base_plus_bonus", seed_base: 5000, seed_gap: 0,
      reset_between_rounds: false, advance_on_win: false,
      finale_mode: "points", finale_reset: false,
      playoff_points_enabled: true,
      playoff_points: { win: 10, stage_win: 0, pole: 0, round_win: 0, regular_champion: 0, positions: "" },
      regular_season_champion: false,
    },
  },
  {
    key: "reset",
    name: "Points Reset",
    tagline: "Everyone level, top X eligible",
    icon: "♻️",
    blurb: "The championship starts again from zero for the drivers who made the cut. Whatever they built in the regular season is a ticket, not a lead.",
    defaults: {
      field_size: 10, qualify_mode: "points",
      seed_mode: "base_plus_bonus", seed_base: 0, seed_gap: 0,
      reset_between_rounds: false, advance_on_win: false,
      finale_mode: "points", finale_reset: false,
      playoff_points_enabled: false,
      playoff_points: { win: 0, stage_win: 0, pole: 0, round_win: 0, regular_champion: 0, positions: "" },
      regular_season_champion: true,
    },
  },
  {
    key: "carry",
    name: "Carry Over",
    tagline: "Top X keep their points",
    icon: "➡️",
    blurb: "Nobody's total moves. The playoff only decides who is still allowed to win it — the leader keeps the lead they earned.",
    defaults: {
      field_size: 8, qualify_mode: "points",
      seed_mode: "carry_over", seed_base: 0, seed_gap: 0,
      reset_between_rounds: false, advance_on_win: false,
      finale_mode: "points", finale_reset: false,
      playoff_points_enabled: false,
      playoff_points: { win: 0, stage_win: 0, pole: 0, round_win: 0, regular_champion: 0, positions: "" },
      regular_season_champion: true,
    },
  },
  {
    key: "winner_takes_all",
    name: "Winner Takes All",
    tagline: "One race for the title",
    icon: "💥",
    blurb: "A short ladder into a single deciding race: the finalists start level and the best of them on the day is champion.",
    defaults: {
      field_size: 4, qualify_mode: "points",
      seed_mode: "base_plus_bonus", seed_base: 0, seed_gap: 0,
      reset_between_rounds: true, advance_on_win: true,
      finale_mode: "best_finish", finale_reset: true,
      playoff_points_enabled: false,
      playoff_points: { win: 0, stage_win: 0, pole: 0, round_win: 0, regular_champion: 0, positions: "" },
      regular_season_champion: true,
    },
  },
  {
    key: "custom",
    name: "Custom Format",
    tagline: "Build it yourself",
    icon: "🛠",
    blurb: "Start from what's already in the menu and change anything: the rounds, the field, the reset, the playoff points. Nothing here is fixed.",
    defaults: null,
  },
];

export function playoffFormat(key) {
  return PLAYOFF_FORMATS.find(f => f.key === key) || PLAYOFF_FORMATS[PLAYOFF_FORMATS.length - 1];
}

// ── The round ladder ───────────────────────────────────────────────────────
//
// One round is three numbers: how many races it runs, how many drivers survive
// it, and what the survivors are reset to when it ends. Everything else about a
// format is these rows repeated (or not repeated — a Chase is one row).

// The ladders the well-known formats actually use, so picking a field size
// gives the shape a league expects rather than an arithmetic guess. Anything
// not listed halves toward the finale, which is at least a legal bracket.
const KNOWN_LADDERS = {
  16: [12, 8, 4],
  12: [8, 4],
  10: [8, 4],
  8: [4],
  6: [4],
  4: [],
};

// "How many drivers are left after each round", for a field of this size.
function cutsFor(fieldSize, finaleSize) {
  const size = int(fieldSize, 0);
  const finale = Math.max(1, int(finaleSize, 4));
  if (size <= finale) return [];
  if (KNOWN_LADDERS[size] && finale === 4) return KNOWN_LADDERS[size].filter(n => n >= finale);
  const cuts = [];
  let left = size;
  while (left > finale) {
    const next = Math.max(finale, Math.floor(left / 2));
    cuts.push(next);
    left = next;
  }
  return cuts;
}

// A default ladder for a field size — the rows the round builder opens with,
// and what the "Rebuild rounds" button regenerates. Every number in them is
// editable afterwards; this only has to be a sensible starting point.
export function defaultRoundsFor({
  field_size = 16, finale_size = 4, races_per_round = 3, finale_races = 1, seed_base = 2000, round_step = 1000,
} = {}) {
  const cuts = cutsFor(field_size, finale_size);
  const rounds = [];
  let left = int(field_size, 0);
  // The FIRST round is raced on the seeding — a round's reset applies when the
  // survivors come INTO it, and nobody comes into round one. So round one's
  // number is the seed base, and each round after it steps up from there:
  // 2000 seeded, Round of 12 to 3000, Round of 8 to 4000, Championship to 5000,
  // which is the ladder NASCAR actually runs. Stepping from round one instead
  // shifted the whole thing up by a round.
  cuts.forEach((advance, i) => {
    rounds.push({
      name: `Round of ${left}`,
      races: Math.max(1, int(races_per_round, 3)),
      advance,
      reset_base: num(seed_base, 0) + num(round_step, 0) * i,
    });
    left = advance;
  });
  rounds.push({
    name: left <= 1 ? "Final Round" : `Championship ${left}`,
    races: Math.max(1, int(finale_races, 1)),
    advance: 1,
    reset_base: num(seed_base, 0) + num(round_step, 0) * cuts.length,
  });
  return rounds;
}

// One round row, cleaned up. A round that advances nobody is meaningless, and a
// round that advances more drivers than it started with is a typo — neither is
// refused (an admin mid-edit is allowed an unfinished number), they're simply
// read as the nearest thing that can be raced.
//
// `races: 0` is NOT a typo and is never clamped: it means "every round that's
// left", which is how one row describes a Chase — ten races, or twelve, or
// however many the calendar turns out to hold.
function normalizeRound(raw = {}, i = 0) {
  return {
    name: text(raw.name, "").trim() || `Round ${i + 1}`,
    races: Math.max(0, int(raw.races, 0)),
    advance: Math.max(1, int(raw.advance, 1)),
    reset_base: num(raw.reset_base, 0),
  };
}

// One wildcard pick. Stored as the roster entry it names PLUS the name it had
// when it was picked: the id is what the bracket seeds off, and the name is what
// the menu can still print when the roster hasn't loaded yet, or when the entry
// has since been deleted — a pick that silently becomes a blank row is worse
// than one that says whose it was.
//
// A bare string reads as an id, so a config hand-written as ["abc123"] works.
function normalizeWildcard(raw) {
  if (typeof raw === "string") return { entry_id: raw.trim(), name: "" };
  return { entry_id: text(raw?.entry_id, "").trim(), name: text(raw?.name, "").trim() };
}

export const BLANK_PLAYOFF_CONFIG = {
  format: "elimination",
  // Where the regular season stops. The round number of the LAST regular-season
  // race — so 26 means rounds 1–26 are the regular season and everything after
  // is the playoff. 0 means "work it out from the ladder" (see
  // resolveRegularRounds): a 36-round schedule with a 10-race ladder has a
  // 26-round regular season without anybody typing 26.
  regular_rounds: 0,
  // Who is in it.
  field_size: 16,
  qualify_mode: "wins_then_points",
  min_starts: 0,
  // Drivers put in by hand, whatever the rule above says — see WILDCARD_MODES.
  wildcards: [],
  wildcard_mode: "within_field",
  wildcard_seed: "points",
  // What they start on.
  seed_mode: "base_plus_bonus",
  seed_base: 2000,
  seed_gap: 0,
  // How it's raced.
  rounds: [],
  reset_between_rounds: true,
  advance_on_win: true,
  finale_mode: "best_finish",
  finale_reset: true,
  // Playoff points: the currency that survives a reset.
  playoff_points_enabled: true,
  playoff_points: {
    win: 5,
    stage_win: 1,
    pole: 0,
    round_win: 0,
    regular_champion: 15,
    // A comma list, exactly like a points scale: "10, 9, 8, 7" pays the top four
    // finishers 10/9/8/7 playoff points on top of anything above.
    positions: "",
  },
  // Playoff points earned in the regular season are added to the seed, and
  // carried through each round's reset. Switched off, they pay once and are
  // gone at the first reset.
  carry_playoff_points: true,
  // The regular season champion.
  regular_season_champion: true,
  regular_season_title: "Regular Season Champion",
  regular_season_counts_title: true,
  // What the playoff winner is called, on the standings and in the record books.
  champion_title: "Champion",
  // Drivers who missed the cut (or were knocked out) keep racing and keep
  // scoring ordinary points — they just can't win the title. Off, the playoff
  // table hides them entirely.
  show_non_playoff: true,
  // A free note shown at the top of the playoff panel: the rule the league
  // voted on, in the league's own words.
  notes: "",
};

// The two answers that were this one with a number ignored — see SEED_MODES.
const LEGACY_SEED_MODES = { reset_zero: "base_plus_bonus", carry_gap: "base_plus_bonus" };

function normalizeSeedMode(mode) {
  return LEGACY_SEED_MODES[mode] || mode;
}

function dedupeWildcards(list) {
  const seen = new Set();
  const out = [];
  for (const w of list) {
    if (!w.entry_id || seen.has(w.entry_id)) continue;
    seen.add(w.entry_id);
    out.push(w);
  }
  return out;
}

// A stored (or in-progress) config → the one every reader works from. Missing
// answers take the blank config's, a missing ladder is generated from the field
// size, and every number is a number.
export function normalizePlayoffConfig(raw) {
  let src = raw || {};
  if (typeof src === "string") {
    try { src = JSON.parse(src); } catch { src = {}; }
  }
  const base = BLANK_PLAYOFF_CONFIG;
  const pp = { ...base.playoff_points, ...(src.playoff_points || {}) };
  const field_size = Math.max(1, int(src.field_size, base.field_size));
  const seed_base = num(src.seed_base, base.seed_base);
  const rounds = Array.isArray(src.rounds) && src.rounds.length
    ? src.rounds.map(normalizeRound)
    : defaultRoundsFor({ field_size, seed_base });
  return {
    format: text(src.format, base.format) || base.format,
    regular_rounds: Math.max(0, int(src.regular_rounds, base.regular_rounds)),
    field_size,
    qualify_mode: text(src.qualify_mode, base.qualify_mode) || base.qualify_mode,
    min_starts: Math.max(0, int(src.min_starts, base.min_starts)),
    // Picked twice is picked once; a pick with no entry behind it is no pick.
    wildcards: dedupeWildcards((Array.isArray(src.wildcards) ? src.wildcards : []).map(normalizeWildcard)),
    wildcard_mode: text(src.wildcard_mode, base.wildcard_mode) || base.wildcard_mode,
    wildcard_seed: text(src.wildcard_seed, base.wildcard_seed) || base.wildcard_seed,
    // "Start over on zero" was this mode with the base ignored — see SEED_MODES.
    // A season saved under it carries seed_base 0, so it reads identically.
    seed_mode: normalizeSeedMode(text(src.seed_mode, base.seed_mode) || base.seed_mode),
    seed_base,
    seed_gap: num(src.seed_gap, base.seed_gap),
    rounds,
    reset_between_rounds: bool(src.reset_between_rounds, base.reset_between_rounds),
    advance_on_win: bool(src.advance_on_win, base.advance_on_win),
    finale_mode: text(src.finale_mode, base.finale_mode) || base.finale_mode,
    finale_reset: bool(src.finale_reset, base.finale_reset),
    playoff_points_enabled: bool(src.playoff_points_enabled, base.playoff_points_enabled),
    playoff_points: {
      win: num(pp.win, 0),
      stage_win: num(pp.stage_win, 0),
      pole: num(pp.pole, 0),
      round_win: num(pp.round_win, 0),
      regular_champion: num(pp.regular_champion, 0),
      positions: text(pp.positions, ""),
    },
    carry_playoff_points: bool(src.carry_playoff_points, base.carry_playoff_points),
    regular_season_champion: bool(src.regular_season_champion, base.regular_season_champion),
    regular_season_title: text(src.regular_season_title, base.regular_season_title).trim() || base.regular_season_title,
    regular_season_counts_title: bool(src.regular_season_counts_title, base.regular_season_counts_title),
    champion_title: text(src.champion_title, base.champion_title).trim() || base.champion_title,
    show_non_playoff: bool(src.show_non_playoff, base.show_non_playoff),
    notes: text(src.notes, ""),
  };
}

// Does this season run a playoff? The tick is the whole answer — a season
// carrying a config it never switched on races exactly as it always did, which
// is what makes the menu safe to open and close while thinking about it.
export function playoffsOn(season) {
  return !!(season && season.playoffs_enabled);
}

// The season's playoff rules, or null when it doesn't run one.
export function seasonPlayoffConfig(season) {
  if (!playoffsOn(season)) return null;
  return normalizePlayoffConfig(season.playoff_config);
}

// Applying a preset: the preset's answers over what's already there, with a
// fresh ladder unless the preset is "Custom" (which changes nothing but the
// name, so a league can start from any format and edit it).
export function applyFormatPreset(config, key) {
  const current = normalizePlayoffConfig(config);
  const preset = playoffFormat(key);
  if (!preset.defaults) return { ...current, format: key };
  const merged = normalizePlayoffConfig({
    ...current,
    ...preset.defaults,
    playoff_points: { ...current.playoff_points, ...(preset.defaults.playoff_points || {}) },
    format: key,
    // The ladder is regenerated from the preset's own field size, since a
    // 16-driver elimination ladder under a 4-driver Chase is not a format.
    rounds: null,
  });
  return {
    ...merged,
    rounds: roundsForPreset(preset, merged),
  };
}

// The ladder a preset wants. The elimination formats race a real ladder; the
// one-round formats (a Chase, a reset, a carry-over) race one long round that
// runs to the end of the season, which is why `races` there is 0 — "whatever is
// left". See roundPlan().
function roundsForPreset(preset, config) {
  if (preset.key === "elimination") {
    return defaultRoundsFor({ field_size: config.field_size, seed_base: config.seed_base });
  }
  if (preset.key === "winner_takes_all") {
    return defaultRoundsFor({
      field_size: config.field_size, finale_size: Math.min(config.field_size, 2),
      races_per_round: 1, finale_races: 1, seed_base: config.seed_base, round_step: 0,
    });
  }
  return [{
    name: preset.key === "reset" ? "The Run-In" : preset.key === "carry" ? "The Run-In" : "The Chase",
    races: 0,
    advance: 1,
    reset_base: config.seed_base,
  }];
}

// ── Splitting a schedule ───────────────────────────────────────────────────

// How many rounds the regular season runs. Set by hand, or worked out by
// subtracting the ladder from the calendar — which is what a league means when
// it says "the playoffs are the last ten races".
export function resolveRegularRounds(config, races = []) {
  const cfg = normalizePlayoffConfig(config);
  if (cfg.regular_rounds > 0) return cfg.regular_rounds;
  const rounds = roundNumbers(races);
  if (!rounds.length) return 0;
  const planned = cfg.rounds.reduce((a, r) => a + Math.max(0, int(r.races, 0)), 0);
  const last = rounds[rounds.length - 1];
  // A ladder of "whatever is left" (races: 0) can't be subtracted, so the
  // regular season is everything but the final round.
  if (!planned) return Math.max(0, last - 1);
  return Math.max(0, last - planned);
}

function roundNumbers(races = []) {
  return [...new Set(races.map(r => int(r.round_number, 0)).filter(n => n > 0))].sort((a, b) => a - b);
}

// Every race in round order. Races with no round number sit at the end, in the
// order they arrived — they're a calendar an admin hasn't finished numbering,
// and they must not silently become playoff rounds.
function orderedRaces(races = []) {
  return [...races].sort((a, b) => (int(a.round_number, 0) || Infinity) - (int(b.round_number, 0) || Infinity));
}

// { regular, playoff } — the calendar cut at the end of the regular season.
export function splitRaces(races = [], config) {
  const cutoff = resolveRegularRounds(config, races);
  const ordered = orderedRaces(races);
  if (!cutoff) return { regular: ordered, playoff: [] };
  return {
    regular: ordered.filter(r => int(r.round_number, 0) > 0 && int(r.round_number, 0) <= cutoff),
    playoff: ordered.filter(r => int(r.round_number, 0) > cutoff),
  };
}

// The ladder with real races hung off it: each round gets the next `races` of
// the playoff calendar, and a round asking for 0 races takes everything that's
// left (a Chase is one round of "the rest of the season"). A round the calendar
// can't fill yet comes back with fewer races than it asked for, which is
// exactly what a season half-scheduled looks like.
export function roundPlan(config, playoffRaces = []) {
  const cfg = normalizePlayoffConfig(config);
  const queue = orderedRaces(playoffRaces);
  let at = 0;
  return cfg.rounds.map((round, i) => {
    const want = int(round.races, 0);
    const take = want > 0 ? queue.slice(at, at + want) : queue.slice(at);
    at += take.length;
    return {
      ...round,
      index: i,
      is_final: i === cfg.rounds.length - 1,
      races: take,
      race_ids: take.map(r => r.id),
      planned_races: want,
    };
  });
}

// "Round of 12 · race 2 of 3" for one race, or null when it isn't a playoff
// race. Used by the schedule to badge the calendar.
export function playoffLabelForRace(raceId, plan = []) {
  for (const round of plan) {
    const at = round.race_ids.indexOf(raceId);
    if (at >= 0) {
      return {
        round_name: round.name,
        race_index: at + 1,
        race_count: round.races.length,
        is_final: round.is_final,
        is_decider: round.is_final && at === round.races.length - 1,
      };
    }
  }
  return null;
}

// ── Playoff points ─────────────────────────────────────────────────────────
//
// Playoff points are a second currency, paid alongside the ordinary points and
// banked rather than spent: they seed the field and they survive every reset,
// which is what makes a strong regular season still worth something to a driver
// who has just been dropped back to 2000.
//
// They're read off results the app already records, so nothing new is entered:
// a main-event win, a pole (position 1 of a Qualifying session), a heat win —
// the app's stage race — and a table paying the top finishers.
export function playoffPointsFor(result, config) {
  const cfg = normalizePlayoffConfig(config);
  if (!cfg.playoff_points_enabled || !result) return 0;
  // A session run for no championship points pays no playoff points either, and
  // a driver who never took the green flag earns nothing.
  if (result.counts_points === false || isDidNotStart(result)) return 0;
  const pos = int(result.finish_pos, 0);
  if (pos <= 0) return 0;
  const pp = cfg.playoff_points;
  if (isQualifying(result)) return pos === 1 ? num(pp.pole) : 0;
  if (isPreliminarySession(result.session_type)) return pos === 1 ? num(pp.stage_win) : 0;
  const table = listToTable(pp.positions) || {};
  return (pos === 1 ? num(pp.win) : 0) + num(table[pos], 0);
}

// The one-off bonus for leading the points when the regular season ends.
//
// It is a PLAYOFF POINT like any other, so it is paid only when the season pays
// playoff points at all. It reads off a champion rather than off a result, which
// is the only reason it isn't already inside playoffPointsFor — and was exactly
// how it came to be paid by a season with playoff points switched off, seeding
// the regular season champion 15 clear of everybody for no stated reason. The
// switch is the switch: off means nothing below it pays.
function regularChampionBonus(config) {
  const cfg = normalizePlayoffConfig(config);
  return cfg.playoff_points_enabled ? num(cfg.playoff_points.regular_champion) : 0;
}

// Every driver's banked playoff points across a set of results, keyed by entry.
export function playoffPointsByEntry(results = [], config) {
  const totals = new Map();
  for (const r of results) {
    const earned = playoffPointsFor(r, config);
    if (!earned) continue;
    totals.set(r.entry_id, (totals.get(r.entry_id) || 0) + earned);
  }
  return totals;
}

// ── Building the playoff ───────────────────────────────────────────────────

const resultsForRaces = (results, raceIds) => {
  const wanted = new Set(raceIds);
  return results.filter(r => wanted.has(r.race_id));
};

// Has this race actually been run? A round is only settled — drivers advanced,
// drivers knocked out — once every race in it has a main-event result on the
// board. Before that the table is a live picture, not a verdict.
const raceHasRun = (raceId, results) =>
  results.some(r => r.race_id === raceId && !isQualifying(r) && !isPreliminarySession(r.session_type));

// A standings row for a wildcard who has none — somebody picked who never
// scored, or never even started. They are in the playoff because a person said
// so, so the absence of a season behind them cannot be what keeps them out; it
// just means they are seeded off nothing.
function bareRow(wildcard, rosterById) {
  const entry = rosterById.get(wildcard.entry_id) || {};
  return {
    entry_id: wildcard.entry_id,
    entry_ids: [wildcard.entry_id],
    driver_name: entry.name || wildcard.name || "Unknown",
    driver_id: entry.driver_id ?? null,
    user_id: entry.user_id ?? null,
    team: entry.team ?? null,
    adjusted_points: 0, points: 0,
    wins: 0, podiums: 0, top5: 0, top10: 0, poles: 0, best_laps: 0, laps_led: 0,
    starts: 0, finish_sum: 0, qualifying_sessions: 0, start_sum: 0,
    avg_finish: null, avg_start: null, best_finish: null,
  };
}

// The seeded field: who made it, in what order, and on what points.
function seedField(regularRows, config, bankedPoints, regularChampionEntry, rosterById = new Map()) {
  const cfg = normalizePlayoffConfig(config);
  const rowsById = new Map(regularRows.map(r => [r.entry_id, r]));

  // The hand-picked drivers come out first and are never run past a rule: a
  // wildcard is in, full stop. Their standings row is used where they have one,
  // so a pick who has been racing all year is still seeded on what they did.
  const wildcards = cfg.wildcards.map(w => rowsById.get(w.entry_id) || bareRow(w, rosterById));
  const wildcardSet = new Set(wildcards.map(r => r.entry_id));

  // Everyone else goes through the qualifying rule, for whatever slots the
  // wildcards left — none of them, when the wildcards are added on top instead.
  const eligible = regularRows.filter(row =>
    !wildcardSet.has(row.entry_id) && int(row.starts, 0) >= cfg.min_starts);
  const slots = cfg.wildcard_mode === "extra"
    ? cfg.field_size
    : Math.max(0, cfg.field_size - wildcards.length);

  let qualified;
  if (cfg.qualify_mode === "all") {
    qualified = eligible;
  } else if (cfg.qualify_mode === "wins_only") {
    qualified = eligible.filter(r => int(r.wins, 0) > 0).slice(0, slots);
  } else if (cfg.qualify_mode === "wins_then_points") {
    const winners = eligible.filter(r => int(r.wins, 0) > 0).slice(0, slots);
    const taken = new Set(winners.map(r => r.entry_id));
    const rest = eligible.filter(r => !taken.has(r.entry_id));
    qualified = [...winners, ...rest].slice(0, slots);
  } else {
    qualified = eligible.slice(0, slots);
  }

  // Seeded in championship order — the qualifying rule decides who is in, never
  // what order they line up in. (A winner sitting 14th in the points is in the
  // playoff, seeded 14th.) Wildcards line up on their own points too, unless
  // the format puts every one of them behind the drivers who qualified.
  const byOrder = list =>
    [...list].sort((a, b) => compareStandings(a, b, { pointsKey: "adjusted_points", nameKey: "driver_name" }));
  const ordered = cfg.wildcard_seed === "last"
    ? [...byOrder(qualified), ...byOrder(wildcards)]
    : byOrder([...qualified, ...wildcards]);

  return ordered.map((row, i) => {
    const banked = num(bankedPoints.get(row.entry_id), 0)
      + (regularChampionEntry === row.entry_id ? regularChampionBonus(cfg) : 0);
    const carried = cfg.carry_playoff_points ? banked : 0;
    // Carried over, a driver keeps their own total; reset, they take the number
    // their seat is worth. Either way the banked playoff points go on top.
    const seeded = seedBasePointsFor(cfg, i);
    const points = (seeded == null ? num(row.adjusted_points) : seeded) + carried;
    return {
      seed: i + 1,
      entry_id: row.entry_id,
      entry_ids: row.entry_ids ?? [row.entry_id],
      driver_name: row.driver_name,
      driver_id: row.driver_id ?? null,
      user_id: row.user_id ?? null,
      team: row.team ?? null,
      regular_points: num(row.adjusted_points),
      wins: int(row.wins, 0),
      playoff_points: banked,
      qualified_by: wildcardSet.has(row.entry_id) ? "wildcard"
        : int(row.wins, 0) > 0 && cfg.qualify_mode !== "points" ? "win"
          : "points",
      points,
    };
  });
}

// A round's table: everyone still alive, on the points they carried in plus
// whatever they scored in the round's races.
function roundTable({ field, carriedPoints, roundRows, bankedByEntry, deciderFinish = null }) {
  const byEntry = new Map(roundRows.map(r => [r.entry_id, r]));
  return field.map(driver => {
    const scored = byEntry.get(driver.entry_id);
    const roundPoints = num(scored?.points, 0);
    const banked = num(bankedByEntry.get(driver.entry_id), 0);
    return {
      ...driver,
      round_points: roundPoints,
      round_wins: int(scored?.wins, 0),
      round_starts: int(scored?.starts, 0),
      // Every tie-breaker the app already uses, carried onto the playoff row so
      // a level round breaks exactly the way a level championship does.
      wins: int(scored?.wins, 0),
      podiums: int(scored?.podiums, 0),
      top5: int(scored?.top5, 0),
      top10: int(scored?.top10, 0),
      poles: int(scored?.poles, 0),
      best_laps: int(scored?.best_laps, 0),
      laps_led: int(scored?.laps_led, 0),
      starts: int(scored?.starts, 0),
      finish_sum: num(scored?.finish_sum, 0),
      qualifying_sessions: int(scored?.qualifying_sessions, 0),
      start_sum: num(scored?.start_sum, 0),
      avg_finish: scored?.avg_finish ?? null,
      avg_start: scored?.avg_start ?? null,
      best_finish: scored?.best_finish ?? null,
      playoff_points: banked,
      started_on: num(carriedPoints.get(driver.entry_id), 0),
      points: num(carriedPoints.get(driver.entry_id), 0) + roundPoints,
      // Where they finished the one race that decides it — only set for a
      // final round raced on best finish, and read off THAT race rather than
      // the driver's best of the round.
      decider_finish: deciderFinish ? (deciderFinish.get(driver.entry_id) ?? null) : null,
    };
  });
}

// Who comes out of a round. Winners first when a win advances, then the points.
function advanceFrom(rows, round, config) {
  const cfg = normalizePlayoffConfig(config);
  const byPoints = [...rows].sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "driver_name" }));
  const slots = Math.min(Math.max(1, int(round.advance, 1)), byPoints.length);
  if (!cfg.advance_on_win) return byPoints.slice(0, slots).map(r => r.entry_id);
  const winners = byPoints.filter(r => int(r.round_wins, 0) > 0).map(r => r.entry_id);
  const order = [...winners, ...byPoints.map(r => r.entry_id).filter(id => !winners.includes(id))];
  return order.slice(0, slots);
}

// Where each driver finished one particular race, from its main-event results.
// A driver with no result in it has no finish at all, which is not the same as
// a bad one — see decideOnBestFinish.
function finishPositionsIn(raceId, results) {
  const out = new Map();
  for (const r of results) {
    if (r.race_id !== raceId) continue;
    if (isQualifying(r) || isPreliminarySession(r.session_type)) continue;
    if (isDidNotStart(r)) continue;
    const pos = int(r.finish_pos, 0);
    if (pos <= 0) continue;
    const seen = out.get(r.entry_id);
    if (seen == null || pos < seen) out.set(r.entry_id, pos);
  }
  return out;
}

// The final round raced on best finish: the finalists' own order in the last
// race of the round, everybody who didn't finish it behind everybody who did.
function decideOnBestFinish(rows) {
  return [...rows].sort((a, b) => {
    const af = a.decider_finish == null ? Infinity : a.decider_finish;
    const bf = b.decider_finish == null ? Infinity : b.decider_finish;
    if (af !== bf) return af - bf;
    if (num(a.points) !== num(b.points)) return num(b.points) - num(a.points);
    return compareByTieBreakers(a, b);
  });
}

// ── The whole picture ──────────────────────────────────────────────────────
//
// `races` are the season's race documents (each with an `id` and a
// `round_number`), `results` the season's decorated results, `entries` its
// roster, `pointsConfig` the resolved scoring structure calculateStandings
// wants. Returns null when the season doesn't run a playoff.
//
// Scoped exactly like everything else: hand it one class's results and it
// builds that class's playoff, which is how a multi-class season runs a playoff
// per class without a second setting.
export function buildPlayoffs({
  season, races = [], results = [], entries = [], pointsConfig, templatesById = {}, classes = [],
} = {}) {
  const cfg = seasonPlayoffConfig(season);
  if (!cfg) return null;

  const { regular, playoff } = splitRaces(races, cfg);
  const regularIds = regular.map(r => r.id);
  const regularResults = resultsForRaces(results, regularIds);
  const plan = roundPlan(cfg, playoff);

  // The regular season, scored exactly as the season always was: its own points
  // structure, its own drop weeks, its own tie-breakers.
  const regularStandings = calculateStandings(regularResults, entries, [], pointsConfig, templatesById, classes);
  const regularRows = regularStandings.rows;
  const regularComplete = regularIds.length > 0 && regularIds.every(id => raceHasRun(id, results));
  const regularChampion = regularComplete && cfg.regular_season_champion && regularRows.length
    ? regularRows[0]
    : null;

  // Playoff points banked so far — the regular season's, plus anything earned
  // in playoff races already run. The seed uses the regular-season half; the
  // resets use the running total.
  const regularBank = playoffPointsByEntry(regularResults, cfg);
  // The roster, for the wildcards: a hand-picked driver with no results has no
  // standings row to take a name from, and "Unknown" on a bracket is a bug
  // report waiting to happen.
  const rosterById = new Map(entries.map(e => [e.id, e]));
  const seeds = seedField(regularRows, cfg, regularBank, regularChampion?.entry_id ?? null, rosterById);
  const seeded = new Set(seeds.map(s => s.entry_id));

  // Rounds are walked in order, each starting from what the last one left.
  const roundsOut = [];
  let field = seeds;
  let carried = new Map(seeds.map(s => [s.entry_id, s.points]));
  const bank = new Map(regularBank);
  if (regularChampion) {
    bank.set(regularChampion.entry_id,
      num(bank.get(regularChampion.entry_id), 0) + regularChampionBonus(cfg));
  }
  let champion = null;
  const eliminated = [];

  // Once a round is unsettled nothing past it can be raced, but the rounds
  // after it are still part of the ladder and still belong on screen — as the
  // empty rows of a bracket nobody has reached yet.
  let settled = true;
  for (const round of plan) {
    if (!settled) {
      roundsOut.push({
        name: round.name,
        index: round.index,
        is_final: round.is_final,
        planned_races: round.planned_races,
        races: round.races.map(r => ({
          id: r.id, name: r.name ?? "", round_number: int(r.round_number, 0), date: r.date ?? null,
          run: raceHasRun(r.id, results),
        })),
        advance: round.is_final ? 1 : Math.max(1, int(round.advance, 1)),
        reset_base: num(round.reset_base, 0),
        started: false,
        complete: false,
        decided_on: round.is_final && cfg.finale_mode === "best_finish" ? "best_finish" : "points",
        rows: [],
        advanced: [],
        eliminated: [],
      });
      continue;
    }
    const ids = round.race_ids;
    const roundResults = resultsForRaces(results, ids);
    // Drop weeks belong to the regular season; a three-race round that throws
    // its worst race away is not a round. Adjustments are left out too — they
    // were already applied to the regular-season total the seed came from, and
    // re-adding them every round would pay a penalty four times.
    const roundRows = calculateStandings(
      roundResults, entries, [], { ...pointsConfig, dropWeeks: 0 }, templatesById, classes,
    ).rows;

    // Playoff points earned inside the round are banked as they're scored.
    for (const [entryId, earned] of playoffPointsByEntry(roundResults, cfg)) {
      bank.set(entryId, num(bank.get(entryId), 0) + earned);
    }

    const complete = ids.length > 0 && ids.every(id => raceHasRun(id, results));
    const started = ids.some(id => raceHasRun(id, results));
    const bestFinishFinal = round.is_final && cfg.finale_mode === "best_finish";
    // The deciding race is the last one of the final round — the one everybody
    // is watching, not the round's aggregate.
    const deciderId = bestFinishFinal ? ids[ids.length - 1] ?? null : null;

    const rows = roundTable({
      field, carriedPoints: carried, roundRows, bankedByEntry: bank,
      deciderFinish: deciderId ? finishPositionsIn(deciderId, results) : null,
    });

    const ordered = bestFinishFinal
      ? decideOnBestFinish(rows)
      : [...rows].sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "driver_name" }));

    const advanced = complete && !round.is_final ? advanceFrom(rows, round, cfg) : [];
    const knockedOut = complete && !round.is_final
      ? rows.map(r => r.entry_id).filter(id => !advanced.includes(id))
      : [];
    if (complete && round.is_final && ordered.length) champion = ordered[0];

    roundsOut.push({
      name: round.name,
      index: round.index,
      is_final: round.is_final,
      planned_races: round.planned_races,
      races: round.races.map(r => ({
        id: r.id, name: r.name ?? "", round_number: int(r.round_number, 0), date: r.date ?? null,
        run: raceHasRun(r.id, results),
      })),
      advance: round.is_final ? 1 : Math.max(1, int(round.advance, 1)),
      reset_base: num(round.reset_base, 0),
      started,
      complete,
      decided_on: bestFinishFinal ? "best_finish" : "points",
      rows: ordered.map((r, i) => ({
        ...r,
        rank: i + 1,
        status: champion && champion.entry_id === r.entry_id ? "champion"
          : advanced.includes(r.entry_id) ? "advanced"
            : knockedOut.includes(r.entry_id) ? "eliminated"
              : complete && round.is_final ? "runner_up" : "racing",
      })),
      advanced,
      eliminated: knockedOut,
    });

    for (const id of knockedOut) eliminated.push(id);
    // Nothing past an unfinished round — or past the final one — is settled.
    if (!complete || round.is_final) { settled = false; continue; }

    // Carry into the next round: a reset drops everyone to the next round's
    // base (plus their banked playoff points, when those carry), otherwise the
    // points simply stay where they are. A final round raced level resets
    // everybody to the same number with no playoff points at all — that's what
    // "the finalists start level" means.
    const nextRound = plan[round.index + 1];
    const survivors = field.filter(d => advanced.includes(d.entry_id));
    const nextCarried = new Map();
    for (const d of survivors) {
      const rowPoints = rows.find(r => r.entry_id === d.entry_id)?.points ?? 0;
      if (nextRound?.is_final && cfg.finale_reset) {
        nextCarried.set(d.entry_id, num(nextRound.reset_base, 0));
      } else if (cfg.reset_between_rounds && nextRound) {
        nextCarried.set(d.entry_id,
          num(nextRound.reset_base, 0) + (cfg.carry_playoff_points ? num(bank.get(d.entry_id), 0) : 0));
      } else {
        nextCarried.set(d.entry_id, num(rowPoints, 0));
      }
    }
    field = survivors;
    carried = nextCarried;
  }

  // The live table: the round being raced right now, or — before a single
  // playoff race has run — the seeding projection, so a league can see the
  // cutline all through the regular season.
  const activeIndex = roundsOut.findIndex(r => !r.complete);
  const active = activeIndex >= 0 ? roundsOut[activeIndex] : roundsOut[roundsOut.length - 1] ?? null;

  // Everyone who isn't in the playoff, still scored and still listed — they're
  // racing for wins, for next year's seeding and for everything but the title.
  const outsiders = cfg.show_non_playoff
    ? regularRows.filter(r => !seeded.has(r.entry_id)).map((r, i) => ({
      rank: seeds.length + i + 1,
      entry_id: r.entry_id,
      driver_name: r.driver_name,
      driver_id: r.driver_id ?? null,
      user_id: r.user_id ?? null,
      team: r.team ?? null,
      regular_points: num(r.adjusted_points),
      wins: int(r.wins, 0),
      playoff_points: num(regularBank.get(r.entry_id), 0),
    }))
    : [];

  return {
    config: cfg,
    format: cfg.format,
    format_name: playoffFormat(cfg.format).name,
    summary: describePlayoffFormat(cfg),
    regular_rounds: resolveRegularRounds(cfg, races),
    regular_race_ids: regularIds,
    playoff_race_ids: playoff.map(r => r.id),
    // Has the playoff got a calendar to race on at all? A season with the tick
    // on and no rounds past the cutoff is set up but not scheduled, which is a
    // thing to say out loud rather than an empty bracket.
    scheduled: playoff.length > 0,
    started: roundsOut.some(r => r.started),
    regular_complete: regularComplete,
    regular_standings: regularRows,
    regular_champion: regularChampion
      ? {
        entry_id: regularChampion.entry_id,
        driver_name: regularChampion.driver_name,
        driver_id: regularChampion.driver_id ?? null,
        user_id: regularChampion.user_id ?? null,
        points: num(regularChampion.adjusted_points),
        title: cfg.regular_season_title,
      }
      : null,
    seeds,
    rounds: roundsOut,
    active_round: active,
    active_round_index: activeIndex >= 0 ? activeIndex : roundsOut.length - 1,
    champion: champion
      ? {
        entry_id: champion.entry_id,
        driver_name: champion.driver_name,
        driver_id: champion.driver_id ?? null,
        user_id: champion.user_id ?? null,
        points: num(champion.points),
        title: cfg.champion_title,
      }
      : null,
    eliminated_order: eliminated,
    outsiders,
  };
}

// ── Saying what a format is, in one line ───────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "16 drivers · 4 rounds · reset to 2000 + playoff points" — the line the
// season form shows beside the tick, and the badge on the playoff panel, so a
// format can be read without opening the menu.
export function describePlayoffFormat(config) {
  const cfg = normalizePlayoffConfig(config);
  const bits = [];
  const wild = cfg.wildcards.length;
  const field = cfg.qualify_mode === "all" ? "Everybody eligible" : plural(cfg.field_size, "driver");
  bits.push(wild
    ? `${field}${cfg.wildcard_mode === "extra" ? " + " : ", "}${plural(wild, "wildcard")}${cfg.wildcard_mode === "extra" ? "" : " of them picked"}`
    : field);
  bits.push(cfg.rounds.length > 1 ? `${plural(cfg.rounds.length, "round")} of eliminations` : "one round");
  if (cfg.seed_mode === "carry_over") bits.push("points carried over");
  else if (cfg.seed_gap) bits.push(`seeded from ${cfg.seed_base} in ${plural(cfg.seed_gap, "point")} steps`);
  else if (!cfg.seed_base && !cfg.playoff_points_enabled) bits.push("everyone reset to zero");
  else bits.push(`reset to ${cfg.seed_base}${cfg.playoff_points_enabled ? " + playoff points" : ""}`);
  if (cfg.rounds.length > 1 && cfg.finale_mode === "best_finish") bits.push("best finisher in the final race takes it");
  return bits.join(" · ");
}

// Anything an admin has set that can't be raced as it stands. These are
// warnings, never refusals: a season is very often half set up, and a menu that
// refuses to save until the calendar exists is a menu you can't use in
// February. Returns [] when the format is sound.
// `entries` is the season's roster, when the caller has one. Handed over, the
// wildcards are checked against it — a pick whose roster entry has since been
// deleted would otherwise sit in the format looking fine and quietly stop being
// a driver.
export function playoffSetupWarnings(config, races = [], entries = null) {
  const cfg = normalizePlayoffConfig(config);
  const out = [];
  const { playoff } = splitRaces(races, cfg);
  const cutoff = resolveRegularRounds(cfg, races);
  const planned = cfg.rounds.reduce((a, r) => a + Math.max(0, int(r.races, 0)), 0);

  if (races.length && !cutoff) {
    out.push("No regular season: every round on the calendar is a playoff round. Set where the regular season ends.");
  }
  if (races.length && !playoff.length) {
    out.push(`Nothing to race: the calendar stops at round ${cutoff}, so there are no playoff rounds after it.`);
  }
  if (planned > 0 && playoff.length && planned > playoff.length) {
    out.push(`The rounds below ask for ${plural(planned, "race")}, but only ${plural(playoff.length, "race")} follow the regular season.`);
  }
  let left = cfg.field_size;
  for (const round of cfg.rounds) {
    if (int(round.advance, 1) > left) {
      out.push(`"${round.name}" advances ${round.advance} drivers but only ${left} are still in it.`);
    }
    left = Math.min(left, int(round.advance, 1));
  }
  if (cfg.rounds.length && int(cfg.rounds[cfg.rounds.length - 1].advance, 1) !== 1) {
    out.push("The last round advances more than one driver — nothing decides the title.");
  }
  if (cfg.qualify_mode === "wins_only" && cfg.seed_mode === "carry_over") {
    out.push("Winners only, with points carried over: a driver who won once from the back of the field starts the playoff there.");
  }
  if (cfg.wildcards.length && cfg.wildcard_mode === "within_field" && cfg.wildcards.length >= cfg.field_size) {
    out.push(`Every place in the field is a wildcard: ${plural(cfg.wildcards.length, "pick")} for ${plural(cfg.field_size, "slot")}, so the regular season decides nothing.`);
  }
  if (cfg.wildcards.length && Array.isArray(entries) && entries.length) {
    const roster = new Set(entries.map(e => e.id));
    const gone = cfg.wildcards.filter(w => !roster.has(w.entry_id));
    for (const w of gone) {
      out.push(`Wildcard "${w.name || w.entry_id}" isn't on this season's roster any more — remove the pick or add them back.`);
    }
  }
  return out;
}
