// ── What the public results viewer shows about bonuses ─────────────────────
//
// Everything an admin can tick on a results row (fastest lap, most laps led,
// halfway leader, hard charger, laps led) is worth points only because some
// level of the points chain pays for it — and until now the only place that
// arithmetic was visible was the admin grid's Points tooltip. A viewer looking
// at a 358 next to a 350-point win had no way to see where the other 8 came
// from.
//
// This module is the read-only half of that: the list of achievements a result
// row can carry (so the results table can print a tick against each), and the
// plain-English summary of what this session actually pays for them (so the
// header can say "1 Bonus Point for a Lap Led"). Nothing here scores anything —
// pointsFor in lib/standings.js remains the single scorer — and nothing here is
// used by the results editor, so the admin side is untouched.
import { BANGER_STATS } from "@/lib/bangerRacing";

// The per-result achievements, in the order they appear as columns.
//
//   key    column identity (also the share-graphic column key)
//   header the column heading on the results table
//   name   how the achievement reads in a tooltip or a bonus line
//   bonus  the bonus_points key that pays for it (see BONUS_TYPES)
//   phrase how the bonus line reads: "<n> Bonus Points for <phrase>"
//   on     does this result row carry the achievement?
//
// `most_laps_led` reads is_most_laps_led first: scored results carry that
// derived flag (decorateRaceBonuses), and it is what the points total was
// actually built from, so the tick and the points always agree.
export const RESULT_FLAGS = [
  {
    key: "fastest_lap",
    header: "FL",
    name: "Best Lap",
    bonus: "best_lap",
    phrase: "Best Lap",
    title: "Best Lap — the fastest lap of the race",
    on: r => !!r.fastest_lap,
  },
  {
    key: "most_laps_led",
    header: "MLL",
    name: "Most Laps Led",
    bonus: "most_laps_led",
    phrase: "Most Laps Led",
    title: "Most Laps Led — led more laps than anyone else in this race",
    on: r => !!(r.is_most_laps_led ?? r.most_laps_led),
  },
  {
    key: "lead_a_lap",
    header: "LAL",
    name: "Led a Lap",
    bonus: "lead_a_lap",
    phrase: "a Lap Led",
    title: "Led a Lap — led at least one lap of this race",
    on: r => Number(r.laps_led || 0) > 0,
  },
  {
    key: "halfway_leader",
    header: "HW",
    name: "Halfway Leader",
    bonus: "halfway_point",
    phrase: "Leading at Halfway",
    title: "Halfway Leader — led the race at the halfway point",
    on: r => !!r.halfway_leader,
  },
  {
    key: "hard_charger",
    header: "HC",
    name: "Hard Charger",
    bonus: "hard_charger",
    phrase: "Hard Charger",
    title: "Hard Charger — the biggest gain from the starting position",
    on: r => !!r.hard_charger,
  },
];

// The achievement columns worth printing for one session: an achievement
// nobody earned is left off rather than shown as a column of dashes. A bonus
// the session pays keeps its column even with no takers, so the header's
// "5 Bonus Points for Hard Charger" always has a column to point at.
export function flagColumnsFor(results = [], bonuses = null) {
  return RESULT_FLAGS.filter(f =>
    results.some(f.on) || (bonuses ? Number(bonuses[f.bonus] || 0) !== 0 : false));
}

// What this session pays, as lines for the header — one entry per bonus that is
// actually worth something. A bonus set to 0 (or never set) is left out
// entirely, so a series that pays no bonuses shows no panel at all.
//
// `per` marks a counted rate (Demo Derby takedowns are paid per car put out)
// rather than a one-off award, which is the difference between "2 Bonus Points
// per Takedown" and "10 Bonus Points for Most Lethal".
export function bonusLines(bonuses = null, { banger = false } = {}) {
  if (!bonuses) return [];
  const lines = [];
  for (const f of RESULT_FLAGS) {
    const value = Number(bonuses[f.bonus] || 0);
    if (value) lines.push({ key: f.bonus, value, phrase: f.phrase, per: false });
  }
  if (banger) {
    for (const s of BANGER_STATS) {
      const value = Number(bonuses[s.bonus.key] || 0);
      if (!value) continue;
      // A counted stat is named in the singular here — it's a rate, so it reads
      // "2 Bonus Points per Takedown", not "per Takedowns". The singular is
      // already spelled out in the bonus's own admin label ("Points per
      // Takedown"), so take it from there rather than guessing at plurals.
      const per = s.type === "number";
      // A flag named "… Bonus" drops the word, so the line doesn't stutter
      // ("3 Bonus Points for Survival Bonus").
      const phrase = per
        ? (s.bonus.label.replace(/^Points per /i, "") || s.name)
        : s.name.replace(/\s+Bonus$/i, "");
      lines.push({ key: s.bonus.key, value, phrase, per });
    }
  }
  return lines;
}

// One bonus line as the sentence the viewer reads: "1 Bonus Point for a Lap
// Led", "2 Bonus Points per Takedown".
export function bonusLineText(line) {
  const unit = Math.abs(line.value) === 1 ? "Bonus Point" : "Bonus Points";
  return `${line.value} ${unit} ${line.per ? "per" : "for"} ${line.phrase}`;
}

// Group a session's per-class bonus maps into the panels to print. Classes
// that pay exactly the same bonuses share one panel (the ordinary case — one
// points structure for the whole field, so no class labels appear at all);
// a class scoring on its own structure gets its own labelled panel instead of
// its rates being averaged away or silently dropped.
//
// `entries` is [classId, bonusMap] pairs; `classNameFor` resolves a class id to
// its display name (an unclassed "" reads as "Unclassified" only when it has to
// be told apart from a labelled group).
export function groupBonusPanels(entries = [], { banger = false, classNameFor = () => null } = {}) {
  const panels = [];
  for (const [classId, bonuses] of entries) {
    const lines = bonusLines(bonuses, { banger });
    if (!lines.length) continue;
    const key = lines.map(l => `${l.key}:${l.value}`).join("|");
    const existing = panels.find(p => p.key === key);
    if (existing) existing.classIds.push(classId);
    else panels.push({ key, classIds: [classId], lines });
  }
  // With a single panel there is nothing to tell apart, so it carries no label.
  if (panels.length < 2) return panels.map(p => ({ ...p, label: null }));
  return panels.map(p => ({
    ...p,
    label: p.classIds.map(id => classNameFor(id) || "Unclassified").join(" · "),
  }));
}
