import { db } from "@/lib/firebase";
import { resolveSessionFlags } from "@/lib/standings";
import { clampSr, computeSrDeltas, ratingForGame, strengthOfField, SR_BASELINE } from "@/lib/skillRating";

// Session types whose results move Skill Rating: the standard Race, or the
// Feature/A-Main of a heat-format weekend. Preliminary sessions (heats,
// consolations) and Qualifying never exchange SR — they mirror the sessions
// that count toward stats by default (see defaultSessionFlags in standings.js).
const SR_SESSION_TYPES = new Set(["race", "feature"]);

export function isSrSession(sessionType) {
  return SR_SESSION_TYPES.has(sessionType);
}

// A starter is any saved row that actually took the green flag: not a
// provisional (points-only, didn't race) and not a DNS.
function isStarter(row) {
  return !row.provisional && (row.status || "finished") !== "dns";
}

// Recompute Skill Ratings for one just-saved main-race session.
//
// This is idempotent per session and self-correcting on re-save. `priorByEntry`
// carries the sr_delta each now-overwritten result doc previously awarded; we
// first reverse those, restoring every affected driver to their pre-race
// rating, then — only if the session still counts toward SR — compute fresh
// deltas against those restored ratings and apply them. Saving identical
// results twice is a no-op; correcting finishing order cleanly re-exchanges.
//
// `savedRows` are the freshly-written result docs ({ id, entry_id, finish_pos,
// provisional, status }). All writes (driver ratings, per-result sr_delta, the
// race's strength_of_field) happen in one batch. Returns { sof, deltasByEntry }.
//
// SR is gated per game: ratings live under drivers.skillRatings[gameId], so a
// driver's GT7 rating and iRacing rating are independent. `gameId` is the game
// this race belongs to (race → season → game_id). When it's missing (a legacy
// season with no game_id), SR can't be gated, so the exchange is skipped.
export async function exchangeSkillRatings({ race, savedRows, session, sessionType, gameId, priorByEntry = {} }) {
  // Resolve the driver identity behind every entry involved — both the new
  // starters and any entries whose prior deltas must be reversed (e.g. a driver
  // dropped from a corrected result set).
  const entryIds = new Set([...savedRows.map(r => r.entry_id), ...Object.keys(priorByEntry)]);
  const entryDocs = await Promise.all(
    [...entryIds].map(id => db().collection("entries").doc(id).get())
  );
  const driverIdByEntry = {};
  for (const doc of entryDocs) {
    if (doc.exists && doc.data().driver_id) driverIdByEntry[doc.id] = doc.data().driver_id;
  }

  // Reverse prior deltas per driver (an entry with no linked global driver never
  // held SR, so it's simply skipped).
  const priorByDriver = {};
  for (const [entryId, delta] of Object.entries(priorByEntry)) {
    const driverId = driverIdByEntry[entryId];
    if (driverId) priorByDriver[driverId] = (priorByDriver[driverId] || 0) + Number(delta || 0);
  }

  // The starters that can actually exchange SR: took the green flag AND link to
  // a global driver record (SR lives on the drivers doc).
  const starters = savedRows
    .filter(isStarter)
    .map(r => ({ entry_id: r.entry_id, driver_id: driverIdByEntry[r.entry_id], finish_pos: Number(r.finish_pos) }))
    .filter(r => r.driver_id);

  // Load every driver doc we might touch (starters + reversal targets).
  const driverIds = [...new Set([...starters.map(s => s.driver_id), ...Object.keys(priorByDriver)])];
  const driverDocs = await Promise.all(
    driverIds.map(id => db().collection("drivers").doc(id).get())
  );
  const currentRating = {};
  const driverExists = {};
  for (const doc of driverDocs) {
    driverExists[doc.id] = doc.exists;
    currentRating[doc.id] = doc.exists ? ratingForGame(doc.data().skillRatings, gameId) : ratingForGame(null, gameId);
  }

  // Rating after reversing this session's prior contribution — the true
  // pre-race rating to score against.
  const restored = {};
  for (const id of driverIds) restored[id] = currentRating[id] - (priorByDriver[id] || 0);

  // Does this session still count toward SR? Respects the "Count towards
  // Official Stats" toggle (session_stats) exactly like every other stat.
  const flags = resolveSessionFlags(
    { race_id: race.id, session, session_type: sessionType },
    { [race.id]: race }
  );
  // Without a game to gate under, SR can't be exchanged — per-game rating has
  // nowhere to land. Treat it like any other non-SR session.
  const eligible = !!gameId && isSrSession(sessionType) && flags.counts_stats !== false && starters.length >= 1;

  const newRating = { ...restored };
  const deltasByEntry = {};
  let sof = null;

  if (eligible) {
    const field = starters.map(s => ({ ...s, rating: restored[s.driver_id] }));
    sof = strengthOfField(field.map(f => f.rating));
    for (const d of computeSrDeltas(field)) {
      newRating[d.driver_id] = clampSr(restored[d.driver_id] + d.delta);
      deltasByEntry[d.entry_id] = d.delta;
    }
  }

  // Persist: driver ratings, each starter's per-race sr_delta, and the race's
  // strength_of_field. When the session didn't exchange SR (toggled off stats,
  // not a main race, no starters), sr_delta is stored as null — so those docs
  // read as non-SR results everywhere — and the SoF is cleared.
  const batch = db().batch();
  for (const id of driverIds) {
    if (!driverExists[id]) continue; // never resurrect a deleted driver
    // Dot-path update writes just this game's slot in the skillRatings map,
    // leaving the driver's ratings for other games untouched.
    batch.update(db().collection("drivers").doc(id), { [`skillRatings.${gameId}`]: clampSr(newRating[id]) });
  }
  for (const row of savedRows) {
    batch.update(db().collection("results").doc(row.id), {
      sr_delta: eligible ? (deltasByEntry[row.entry_id] ?? 0) : null,
    });
  }
  batch.update(db().collection("races").doc(race.id), { strength_of_field: sof });
  await batch.commit();

  return { sof, deltasByEntry, eligible };
}

// Sum the SR each result doc awarded, keyed by entry — the input to
// reverseSkillRatings when results are being deleted rather than re-saved.
export function srDeltasByEntry(resultsData) {
  const out = {};
  for (const r of resultsData) {
    if (r.sr_delta != null) out[r.entry_id] = (out[r.entry_id] || 0) + Number(r.sr_delta);
  }
  return out;
}

// Give back the SR that a set of results awarded — used when results are
// deleted (a single session or a whole event) so ratings scrub as cleanly as
// points and stats do. `priorByEntry` maps entry_id -> total sr_delta to undo;
// `gameId` is the game whose per-game rating slot the deltas came from. With no
// game (legacy) there is nothing to reverse.
export async function reverseSkillRatings(priorByEntry, gameId) {
  const entryIds = Object.keys(priorByEntry);
  if (!entryIds.length || !gameId) return;

  const entryDocs = await Promise.all(entryIds.map(id => db().collection("entries").doc(id).get()));
  const priorByDriver = {};
  for (const doc of entryDocs) {
    if (!doc.exists || !doc.data().driver_id) continue;
    const driverId = doc.data().driver_id;
    priorByDriver[driverId] = (priorByDriver[driverId] || 0) + Number(priorByEntry[doc.id] || 0);
  }

  const driverIds = Object.keys(priorByDriver);
  if (!driverIds.length) return;
  const driverDocs = await Promise.all(driverIds.map(id => db().collection("drivers").doc(id).get()));
  const batch = db().batch();
  for (const doc of driverDocs) {
    if (!doc.exists) continue;
    const restored = clampSr(ratingForGame(doc.data().skillRatings, gameId) - priorByDriver[doc.id]);
    batch.update(doc.ref, { [`skillRatings.${gameId}`]: restored });
  }
  await batch.commit();
}

// ── Authoritative read-time recompute ──────────────────────────────────────
//
// The exchange above maintains ratings incrementally as each session is saved,
// which makes a driver's stored rating (and each result's sr_delta) depend on
// the ORDER results were entered — and leaves stale deltas behind from the
// pre-per-game migration. For DISPLAY (leaderboard + profile) we instead replay
// a whole game's SR races in true chronological order from the 1500 baseline, so
// every driver's current rating AND their most-recent-race trend are consistent,
// order-independent, and always gated to this one game.
//
// Returns { ratings, seasonsByDriver }:
//   ratings[driverId]        = { rating, races, last_delta }
//     - rating     : current SR in this game (1500 baseline if never moved)
//     - races      : SR races the driver started in this game
//     - last_delta : (SR after their most recent SR race) − (SR before it),
//                    i.e. the trend; null if they never started one
//   seasonsByDriver[driverId] = Set(season_id) they raced an SR event in
//     (lets a series/season-scoped leaderboard list the right drivers)
export async function computeGameSkillRatings(gameId) {
  const empty = { ratings: {}, seasonsByDriver: {} };
  if (!gameId) return empty;

  const seasonsSnap = await db().collection("seasons").where("game_id", "==", gameId).get();
  const seasonIds = seasonsSnap.docs.map(d => d.id);
  if (!seasonIds.length) return empty;

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
  for (const ra of raceDocs) raceById[ra.id] = { id: ra.id, ...ra.data() };

  // Group SR-bearing result rows into their sessions (a race can hold several,
  // e.g. "Race 1"/"Race 2" or a Feature), skipping any session an admin has
  // excluded from official stats — exactly the eligibility the live exchange uses.
  const sessions = new Map();
  for (const doc of resultDocs) {
    const r = doc.data();
    const sessionType = r.session_type || "race";
    if (!isSrSession(sessionType)) continue;
    const race = raceById[r.race_id];
    if (!race) continue;
    const sessionName = r.session || (Array.isArray(race.sessions) && race.sessions[0]) || "Race";
    const key = `${r.race_id}|${sessionName}`;
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
        rows: [],
        // Chronology: race date, then round, then session order within the
        // event, then earliest save time as a final tiebreak.
        order: [race.date || "", String(Number(race.round_number) || 0).padStart(6, "0"), String(sessionIndex).padStart(4, "0")],
        minCreated: r.created_at || "",
      };
      sessions.set(key, s);
    }
    if (s === null) continue; // excluded session
    if (r.created_at && (!s.minCreated || r.created_at < s.minCreated)) s.minCreated = r.created_at;
    s.rows.push(r);
  }

  const ordered = [...sessions.values()].filter(Boolean);
  ordered.sort((a, b) => {
    const ka = `${a.order.join("|")}|${a.minCreated}`;
    const kb = `${b.order.join("|")}|${b.minCreated}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const ratings = {};
  const seasonsByDriver = {};
  const rec = id => (ratings[id] ??= { rating: SR_BASELINE, races: 0, last_delta: null });

  for (const s of ordered) {
    const starters = s.rows
      .filter(r => !r.provisional && (r.status || "finished") !== "dns")
      .map(r => ({ driver_id: driverByEntry[r.entry_id], finish_pos: Number(r.finish_pos), season_id: r.season_id }))
      .filter(r => r.driver_id);
    if (!starters.length) continue;
    // Score against every starter's rating as it stands BEFORE this session.
    const field = starters.map(st => ({ driver_id: st.driver_id, finish_pos: st.finish_pos, rating: rec(st.driver_id).rating }));
    for (const d of computeSrDeltas(field)) {
      const dr = rec(d.driver_id);
      dr.rating = clampSr(dr.rating + d.delta);
      dr.races += 1;
      dr.last_delta = d.delta;
    }
    for (const st of starters) (seasonsByDriver[st.driver_id] ??= new Set()).add(st.season_id);
  }

  return { ratings, seasonsByDriver };
}
