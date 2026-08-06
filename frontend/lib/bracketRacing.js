// ── Bracket Style Racing (drag racing / tournament brackets) ───────────────
//
// A series or a class can be flagged as Bracket Style Racing (`isBracketRacing`
// — see SPECS.series / SPECS.classes in lib/entityApi.js). Unlike Demo Derby /
// Banger Racing, this mode adds NO new stats and NO new bonuses. It changes one
// thing only: how a field is shaped into finishing positions.
//
// A bracket is an elimination tournament. Everyone knocked out in the same
// round finished level with each other — there is no way to separate the two
// semi-final losers, because they never raced each other — so an 8-driver
// bracket produces exactly four finishing positions:
//
//     1st  Winner                      1 driver
//     2nd  Runner-up (lost the final)  1 driver
//     3rd  Semi-final losers           2 drivers
//     4th  Quarter-final losers        4 drivers
//
// That is the whole feature: a results grid whose positions come from the
// bracket rather than running 1..N, and which therefore allows several drivers
// to share one position.
//
// ── Why the stats engine needs no bracket-specific code ────────────────────
//
// These are ORDINARY racing finishes — a bracket 3rd is a 3rd. So they must
// cascade into Wins, Podiums, Top 5s, Average Finish and the Overall/Game
// views exactly like any other result, and they do, because every consumer
// already works one result at a time off `finish_pos`:
//
//   • Average Finish sums each driver's own finish_pos over their own starts
//     (statLine in lib/standings.js), so a semi-final loser contributes a pure
//     3 — not a 3.5, and not a re-ranked 4.
//   • Points are looked up as racePoints[finish_pos] (pointsFor), so both 3rd
//     place finishers are paid the P3 value, identically.
//   • Wins / Podiums / Top N are per-result comparisons (=== 1, <= 3, <= 5).
//   • Skill Rating already scores equal positions as a half-win each way
//     (lib/skillRating.js), which is exactly right for drivers who never met.
//
// Nothing in that chain assumes positions are unique, so the ONLY thing this
// mode had to remove was the results editor's "two drivers share the same
// finishing position" guard — a rule that is correct for a race and wrong for
// a bracket. See handleSave in components/SessionEditor.jsx.

// The bracket sizes an admin can pick for a race. Powers of two, because an
// elimination bracket has to halve cleanly every round.
export const BRACKET_SIZES = [4, 8, 16, 32];

// "8-Driver Bracket" — the dropdown's label for a size.
export function bracketSizeLabel(size) {
  return `${size}-Driver Bracket`;
}

// "a 4-driver bracket" / "an 8-driver bracket" — the label mid-sentence, with
// the article the number actually takes.
function aBracketOf(size) {
  return `${Number(size) === 8 ? "an" : "a"} ${bracketSizeLabel(size).toLowerCase()}`;
}

// A stored bracket size, coerced to one of the offered sizes. Anything else
// (unset, a legacy race, a hand-edited doc) reads as null — "no bracket", which
// is what makes every ordinary race behave exactly as it always did.
export function normalizeBracketSize(size) {
  const n = Number(size);
  return BRACKET_SIZES.includes(n) ? n : null;
}

// The smallest bracket that would hold a field of `n` drivers, for seeding the
// dropdown from a roster instead of guessing. Falls back to the largest size.
export function bracketSizeForField(n) {
  return BRACKET_SIZES.find(size => size >= Number(n || 0)) ?? BRACKET_SIZES[BRACKET_SIZES.length - 1];
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
export function ordinal(n) {
  return ORDINALS[n] ?? `${n}th`;
}

// What a driver in this position did, in the words an admin filling the grid in
// would use. "Winner" / "Runner-up" / "Semi-final losers" / …
//
//   pos 1  the winner                  pos 4  quarter-finals (8 left)
//   pos 2  the final (2 left)          pos 5  round of 16
//   pos 3  the semi-finals (4 left)    pos 6  round of 32
//
// Position p is reached by the drivers knocked out when 2^(p-1) were still in,
// which is what makes the names fall out of the position number alone.
function roundDescriptionFor(pos) {
  if (pos === 1) return "Winner";
  if (pos === 2) return "Runner-up";
  const remaining = 2 ** (pos - 1);
  if (remaining === 4) return "Semi-final losers";
  if (remaining === 8) return "Quarter-final losers";
  return `Round of ${remaining} losers`;
}

// The shape of a bracket, one entry per FINISHING POSITION:
//
//   [{ position: 1, count: 1, description: "Winner",
//      label: "1st Place — Winner" }, …]
//
// `count` is how many drivers share that position: 1, 1, 2, 4, 8, … — the
// losers of each round, doubling as the rounds get earlier. They sum to the
// bracket size, which is what makes the grid below exactly `size` rows long.
// An unrecognised size returns [], so a race with no bracket chosen simply has
// no bracket layout rather than a broken one.
export function bracketRounds(size) {
  const n = normalizeBracketSize(size);
  if (!n) return [];
  const positions = Math.log2(n) + 1;
  const rounds = [];
  for (let position = 1; position <= positions; position++) {
    const count = position === 1 ? 1 : 2 ** (position - 2);
    const description = roundDescriptionFor(position);
    rounds.push({
      position,
      count,
      description,
      label: `${ordinal(position)} Place — ${description}`,
    });
  }
  return rounds;
}

// The bracket as a flat list of finishing positions, one per grid row:
// an 8-driver bracket is [1, 2, 3, 3, 4, 4, 4, 4]. This IS the results grid's
// position column — rows are laid out from it, renumbered from it after a drag
// or a delete, and validated against it on save.
export function bracketPositions(size) {
  return bracketRounds(size).flatMap(r => Array.from({ length: r.count }, () => r.position));
}

// The position a row at grid index `i` takes. Past the end of the bracket (an
// admin who added an extra slot by hand) it stays on the last position, which
// is the round that already holds several drivers — the only one where one more
// is meaningful.
export function bracketPositionAt(positions, i) {
  if (!positions?.length) return i + 1;
  return positions[i] ?? positions[positions.length - 1];
}

// The round a finishing position belongs to, for labelling a row or a results
// table. Null for a position outside this bracket.
export function bracketRoundFor(size, position) {
  return bracketRounds(size).find(r => r.position === Number(position)) ?? null;
}

// ── Where the flag lives ───────────────────────────────────────────────────
//
// `isBracketRacing` can be set on a SERIES or on a single CLASS, and the two
// add up the same way the derby flag does: bracket racing is on for anything at
// or under a flagged level. A flagged series means every season and class in
// it; a flagged class means that class alone — which is how a season runs a
// bracket class (a drag-racing class) alongside its ordinary racing ones.
//
// What a scope CONTAINS never makes it a bracket scope: a series with one
// bracket class in one of its seasons is still an ordinary series, and its
// shared results grids run 1..N like any other race.

// Does this one doc (a series or a class) carry the flag?
export function isBracketDoc(doc) {
  return !!(doc && doc.isBracketRacing);
}

// Is the scope being viewed/entered itself bracket racing? `season` is accepted
// and honoured so a season doc that ever grows the flag resolves through the
// same chain, but nothing sets it today — the toggles are series and class.
//
// This is the ONLY rule. There is deliberately no wider "entry" variant that
// asks whether anything in the field races brackets: such a rule turns every
// shared grid in a season into an elimination ladder the moment one class is
// flagged, which regroups an ordinary race's finishing order into tied
// positions (1, 2, 3, 3, 4, 4, 4, 4) and drops the guard that stops two drivers
// sharing a place. A bracket class inside an ordinary season enters its ladder
// on its own class-scoped grid — that is what per-class results are for.
export function isBracketScope({ series = null, season = null, cls = null } = {}) {
  return isBracketDoc(cls) || isBracketDoc(season) || isBracketDoc(series);
}

// ── Validation ─────────────────────────────────────────────────────────────
//
// What a bracket grid may NOT contain. Deliberately short: sharing a position
// is the entire point, so the only real error is a position the bracket has no
// round for (an 8-driver bracket has no 5th place), or more drivers in a round
// than that round eliminates (three semi-final losers).
//
// Returns an error string, or null when the grid is sound.
export function bracketGridError(rows = [], size) {
  const rounds = bracketRounds(size);
  if (!rounds.length) return null;
  const byPosition = new Map(rounds.map(r => [r.position, r]));
  const counts = new Map();
  for (const row of rows) {
    const pos = Number(row.finish_pos);
    if (!pos) continue;
    const round = byPosition.get(pos);
    if (!round) {
      return `Position ${pos} isn't part of ${aBracketOf(size)} — it runs ${ordinal(1)} to ${ordinal(rounds.length)}.`;
    }
    counts.set(pos, (counts.get(pos) || 0) + 1);
  }
  for (const round of rounds) {
    const used = counts.get(round.position) || 0;
    if (used > round.count) {
      return `${round.label} holds ${round.count} driver${round.count === 1 ? "" : "s"} in ${aBracketOf(size)}, but ${used} are entered there.`;
    }
  }
  return null;
}
