import { db } from "@/lib/firebase";
import { ratingForGame, SR_BASELINE } from "@/lib/skillRating";
import { isSrSession, replaySkillRatings } from "@/lib/skillRatingReplay";

// ── The Firestore half of the Skill Rating engine ──────────────────────────
//
// The replay itself is pure and lives in lib/skillRatingReplay.js, so the
// browser can run it over a raw bundle for the leaderboard while this module
// runs the SAME function on the write path to persist what it produced. What is
// left here is the reads that feed it and the writes that follow it:
//
//   • replayGame(gameId)            — loads the game's SR races and replays them.
//   • computeGameSkillRatings       — thin read wrapper (leaderboard / profile).
//   • recalcGameSkillRatings        — replays AND persists the corrected current
//                                     ratings, per-result sr_delta, and per-race
//                                     strength_of_field. Called after any race
//                                     result is saved, edited, or deleted, so a
//                                     race slotted into the past "ripples"
//                                     through every later race automatically.

export { isSrSession };

// The game a season belongs to — SR is gated per game. Null for a legacy season
// with no game_id (SR is then skipped, since a rating has nowhere to live).
export async function gameIdForSeason(seasonId) {
  if (!seasonId) return null;
  const doc = await db().collection("seasons").doc(seasonId).get();
  return doc.exists ? (doc.data().game_id || null) : null;
}

// Load a whole game's SR timeline and hand it to the replay. See
// lib/skillRatingReplay.js for what comes back.
async function replayGame(gameId) {
  if (!gameId) return replaySkillRatings({});

  const seasonsSnap = await db().collection("seasons").where("game_id", "==", gameId).get();
  const seasonIds = seasonsSnap.docs.map(d => d.id);
  if (!seasonIds.length) return replaySkillRatings({});

  const results = [], entries = [], races = [];
  const per = await Promise.all(seasonIds.map(async sid => {
    const [r, e, ra] = await Promise.all([
      db().collection("results").where("season_id", "==", sid).get(),
      db().collection("entries").where("season_id", "==", sid).get(),
      db().collection("races").where("season_id", "==", sid).get(),
    ]);
    return { r: r.docs, e: e.docs, ra: ra.docs };
  }));
  const docsOf = list => list.map(d => ({ id: d.id, ...d.data() }));
  for (const p of per) { results.push(...docsOf(p.r)); entries.push(...docsOf(p.e)); races.push(...docsOf(p.ra)); }

  return replaySkillRatings({
    seasons: seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    results, entries, races,
  });
}

// Read-only: current per-game ratings + trend for the leaderboard and profiles.
export async function computeGameSkillRatings(gameId) {
  if (!gameId) return { ratings: {}, seasonsByDriver: {} };
  const { ratings, seasonsByDriver } = await replayGame(gameId);
  return { ratings, seasonsByDriver };
}

// Persist a fresh chronological replay for one game: writes each driver's
// current SR (skillRatings[gameId]), each result's sr_delta, and each race's
// strength_of_field — only where the value actually changed. This is the
// retroactive "ripple": call it after any SR-affecting write and the whole
// timeline is made consistent. Never throws to its caller's detriment beyond
// its own scope — callers wrap it so a derived-stat failure can't fail a save.
export async function recalcGameSkillRatings(gameId) {
  if (!gameId) return;
  const replay = await replayGame(gameId);
  const { ratings, deltaByResultId, sofByRace, resultMeta, raceMeta } = replay;

  const writes = [];

  // Per-result SR delta: starters that exchanged get their delta; every other
  // result (non-starters, qualifying, heats, excluded sessions) resolves to null.
  for (const rm of resultMeta) {
    const desired = deltaByResultId[rm.id] ?? null;
    if ((rm.sr_delta ?? null) !== desired) {
      writes.push({ ref: db().collection("results").doc(rm.id), data: { sr_delta: desired } });
    }
  }

  // Per-race Strength of Field.
  for (const rc of raceMeta) {
    const desired = sofByRace[rc.id] ?? null;
    if ((rc.strength_of_field ?? null) !== desired) {
      writes.push({ ref: db().collection("races").doc(rc.id), data: { strength_of_field: desired } });
    }
  }

  // Current per-game rating on each driver. Update participants whose value
  // moved, and reset any driver still carrying a stale rating for a game they no
  // longer race (e.g. after their last race in it was deleted) back to baseline.
  const driversSnap = await db().collection("drivers").get();
  for (const d of driversSnap.docs) {
    const map = d.data().skillRatings;
    const current = ratingForGame(map, gameId);
    const hasKey = !!(map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, gameId));
    const recRating = ratings[d.id]?.rating;
    if (recRating != null) {
      if (current !== recRating) writes.push({ ref: d.ref, data: { [`skillRatings.${gameId}`]: recRating } });
    } else if (hasKey && current !== SR_BASELINE) {
      writes.push({ ref: d.ref, data: { [`skillRatings.${gameId}`]: SR_BASELINE } });
    }
  }

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db().batch();
    for (const w of writes.slice(i, i + 450)) batch.update(w.ref, w.data);
    await batch.commit();
  }
}
