import { db } from "@/lib/firebase";
import { resolveSessionFlags } from "@/lib/standings";
import { racePerClassResults } from "@/lib/classFilter";
import { clampSr, computeSrDeltas, strengthOfField, SR_BASELINE, ratingForGame } from "@/lib/skillRating";

// ── Chronological, date-based Skill Rating engine ──────────────────────────
//
// SR is an Elo-style, per-game rating. This engine treats a game's SR history as
// one timeline ordered by EVENT DATE (not the order results were entered), so
// ratings are identical no matter when data is imported or corrected:
//
//   • replayGame(gameId)            — loads the game's SR races, orders them
//                                     chronologically, and replays every Elo
//                                     exchange from the 1500 baseline forward.
//   • computeGameSkillRatings       — thin read wrapper (leaderboard / profile).
//   • recalcGameSkillRatings        — replays AND persists the corrected current
//                                     ratings, per-result sr_delta, and per-race
//                                     strength_of_field. Called after any race
//                                     result is saved, edited, or deleted, so a
//                                     race slotted into the past "ripples"
//                                     through every later race automatically.
//
// Because a recalc always rebuilds the whole timeline from baseline, inserting
// an older-dated race recomputes the Strength of Field at its position and
// re-runs every subsequent exchange — the current SR stays mathematically sound.

// Session types that move SR: the standard Race, or the Feature/A-Main of a
// heat-format weekend. Heats, consolations and qualifying never exchange SR.
const SR_SESSION_TYPES = new Set(["race", "feature"]);
export function isSrSession(sessionType) {
  return SR_SESSION_TYPES.has(sessionType);
}

// The game a season belongs to — SR is gated per game. Null for a legacy season
// with no game_id (SR is then skipped, since a rating has nowhere to live).
export async function gameIdForSeason(seasonId) {
  if (!seasonId) return null;
  const doc = await db().collection("seasons").doc(seasonId).get();
  return doc.exists ? (doc.data().game_id || null) : null;
}

// A starter is a row that actually took the green flag: not a provisional
// (points-only) entry and not a DNS.
function isStarter(row) {
  return !row.provisional && (row.status || "finished") !== "dns";
}

// Load a whole game's SR timeline and replay it chronologically from the 1500
// baseline. Returns everything both the read and persist paths need:
//   ratings[driverId]        = { rating, races, last_delta }  (current per-game)
//   seasonsByDriver[driverId]= Set(season_id) they started an SR race in
//   deltaByResultId[resultId]= the SR change that result's driver earned
//   sofByRace[raceId]        = Strength of Field of that race's SR session
//   resultMeta[]             = { id, sr_delta }  (current stored value, to diff)
//   raceMeta[]               = { id, strength_of_field }  (current, to diff)
async function replayGame(gameId) {
  const out = { ratings: {}, seasonsByDriver: {}, deltaByResultId: {}, sofByRace: {}, resultMeta: [], raceMeta: [] };
  if (!gameId) return out;

  const seasonsSnap = await db().collection("seasons").where("game_id", "==", gameId).get();
  const seasonIds = seasonsSnap.docs.map(d => d.id);
  if (!seasonIds.length) return out;
  const seasonById = Object.fromEntries(seasonsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  const resultDocs = [], entryDocs = [], raceDocs = [];
  const per = await Promise.all(seasonIds.map(async sid => {
    const [r, e, ra] = await Promise.all([
      db().collection("results").where("season_id", "==", sid).get(),
      db().collection("entries").where("season_id", "==", sid).get(),
      db().collection("races").where("season_id", "==", sid).get(),
    ]);
    return { r: r.docs, e: e.docs, ra: ra.docs };
  }));
  for (const p of per) { resultDocs.push(...p.r); entryDocs.push(...p.e); raceDocs.push(...p.ra); }

  const driverByEntry = {};
  for (const e of entryDocs) { const id = e.data().driver_id; if (id) driverByEntry[e.id] = id; }
  const raceById = {};
  for (const ra of raceDocs) {
    raceById[ra.id] = { id: ra.id, ...ra.data() };
    out.raceMeta.push({ id: ra.id, strength_of_field: ra.data().strength_of_field ?? null });
  }

  // Group SR-bearing result rows into their sessions (a race can hold several —
  // "Race 1"/"Race 2", or a Feature), skipping any session an admin excluded
  // from official stats — exactly the eligibility the exchange used to apply.
  const sessions = new Map();
  for (const doc of resultDocs) {
    const r = doc.data();
    out.resultMeta.push({ id: doc.id, sr_delta: r.sr_delta ?? null });
    const sessionType = r.session_type || "race";
    if (!isSrSession(sessionType)) continue;
    const race = raceById[r.race_id];
    if (!race) continue;
    const sessionName = r.session || (Array.isArray(race.sessions) && race.sessions[0]) || "Race";
    // On an event that ran its classes as separate sessions, each class is its
    // own race: Pro's P1 beat Pro's field, not the Amateur car that finished
    // "ahead" of them on a grid they never shared. Keying the exchange by class
    // keeps those comparisons — and the Strength of Field behind them — honest.
    const srClass = racePerClassResults(race, seasonById[race.season_id]) ? (r.class_id || "") : null;
    const key = srClass == null ? `${r.race_id}|${sessionName}` : `${r.race_id}|${sessionName}|${srClass}`;
    let s = sessions.get(key);
    if (s === undefined) {
      const flags = resolveSessionFlags(
        { race_id: race.id, session: sessionName, session_type: sessionType },
        { [race.id]: race },
      );
      if (flags.counts_stats === false) { sessions.set(key, null); continue; }
      const idx = Array.isArray(race.sessions) ? race.sessions.indexOf(sessionName) : -1;
      const sessionIndex = sessionType === "feature" ? 900 : (idx >= 0 ? idx : 500);
      s = {
        raceId: race.id,
        rows: [],
        // Chronology: EVENT DATE first, then round number, then session order
        // within the event, then earliest save time as a final tiebreak.
        order: [race.date || "", String(Number(race.round_number) || 0).padStart(6, "0"), String(sessionIndex).padStart(4, "0")],
        minCreated: r.created_at || "",
      };
      sessions.set(key, s);
    }
    if (s === null) continue; // excluded session
    if (r.created_at && (!s.minCreated || r.created_at < s.minCreated)) s.minCreated = r.created_at;
    s.rows.push({ id: doc.id, entry_id: r.entry_id, finish_pos: Number(r.finish_pos), provisional: !!r.provisional, status: r.status || "finished", season_id: r.season_id });
  }

  const ordered = [...sessions.values()].filter(Boolean).sort((a, b) => {
    const ka = `${a.order.join("|")}|${a.minCreated}`;
    const kb = `${b.order.join("|")}|${b.minCreated}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const rec = id => (out.ratings[id] ??= { rating: SR_BASELINE, races: 0, last_delta: null });

  for (const s of ordered) {
    const starters = s.rows
      .filter(isStarter)
      .map(r => ({ id: r.id, driver_id: driverByEntry[r.entry_id], finish_pos: r.finish_pos, season_id: r.season_id }))
      .filter(r => r.driver_id);
    if (!starters.length) continue;
    // Score against every starter's rating as it stands BEFORE this session,
    // guaranteeing each driver's first race in the game exchanges off 1500.
    const field = starters.map(st => ({ id: st.id, driver_id: st.driver_id, finish_pos: st.finish_pos, rating: rec(st.driver_id).rating }));
    out.sofByRace[s.raceId] = strengthOfField(field.map(f => f.rating));
    for (const d of computeSrDeltas(field)) {
      const dr = rec(d.driver_id);
      dr.rating = clampSr(dr.rating + d.delta);
      dr.races += 1;
      dr.last_delta = d.delta;      // most recent chronological race → the trend
      out.deltaByResultId[d.id] = d.delta;
    }
    for (const st of starters) (out.seasonsByDriver[st.driver_id] ??= new Set()).add(st.season_id);
  }

  return out;
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
