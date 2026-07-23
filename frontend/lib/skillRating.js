// Skill Rating (SR) — an Elo-based, zero-sum driver rating updated after every
// main race (the standard Race session, or the Feature/A-Main of a heat-format
// weekend). Every driver starts at SR_BASELINE and is bounded to [SR_MIN, SR_MAX].
//
// The exchange is pairwise Elo across the whole field: each driver is compared
// head-to-head with every other starter, "winning" a pairing by finishing ahead.
// Beating a much higher-rated driver is a big surprise (low expected score) and
// pays out large; beating a lower-rated one pays little. Because each pairing's
// outcome and expectation each sum to 1 across the two drivers, the raw deltas
// sum to zero — the top half of the field gains exactly what the bottom half
// loses. See computeSrDeltas.

export const SR_BASELINE = 1500;
export const SR_MIN = 500;
export const SR_MAX = 10000;

// K-factor — the most a single head-to-head pairing can move a rating. Deltas
// are the average pairwise "surprise" over the field, so a driver who finishes
// exactly where their rating predicts barely moves, while a large upset over a
// strong field moves the most.
export const SR_K = 48;

// The Elo logistic scale: a 400-point rating gap means the favourite is expected
// to finish ahead ~10x as often.
const SR_SCALE = 400;

// Clamp a rating to the allowed range.
export function clampSr(value) {
  const n = Number.isFinite(value) ? value : SR_BASELINE;
  return Math.max(SR_MIN, Math.min(SR_MAX, Math.round(n)));
}

// A stored rating, defaulting missing/blank values to the baseline.
export function ratingOf(value) {
  return Number.isFinite(Number(value)) && value != null && value !== "" ? Number(value) : SR_BASELINE;
}

// Expected score of A against B — the probability A finishes ahead of B.
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / SR_SCALE));
}

// Strength of Field: the mean rating of every starter, rounded.
export function strengthOfField(ratings) {
  if (!ratings.length) return null;
  return Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

// Compute each starter's SR change for one race. `field` is a list of
// { rating, finish_pos, ... }; the returned list echoes each item with an
// integer `delta`. Lower finish_pos is a better result; equal positions split
// the pairing 0.5/0.5. A field of fewer than two starters exchanges nothing.
export function computeSrDeltas(field) {
  const n = field.length;
  if (n < 2) return field.map(d => ({ ...d, delta: 0 }));
  return field.map(d => {
    let expected = 0;
    let actual = 0;
    for (const o of field) {
      if (o === d) continue;
      expected += expectedScore(d.rating, o.rating);
      if (d.finish_pos < o.finish_pos) actual += 1;
      else if (d.finish_pos === o.finish_pos) actual += 0.5;
    }
    // Normalise by the pairing count so field size doesn't inflate the swing.
    const delta = Math.round((SR_K * (actual - expected)) / (n - 1));
    return { ...d, delta };
  });
}
