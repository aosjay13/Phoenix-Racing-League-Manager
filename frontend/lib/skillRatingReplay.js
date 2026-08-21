// ── Chronological, date-based Skill Rating replay ──────────────────────────
//
// The engine itself, with no Firestore in it. SR is an Elo-style, per-game
// rating, and this treats a game's SR history as one timeline ordered by EVENT
// DATE (not the order results were entered), so ratings come out identical no
// matter when data is imported or corrected.
//
// Both halves of the app run THIS function, which is the point of it living
// here: the leaderboard replays a game in the browser (see
// lib/skillRatingsCompute.js) and the write path replays it on the server to
// persist deltas (see lib/skillRatingServer.js). One implementation, so a
// displayed rating cannot disagree with a stored one.
//
// Because a replay always rebuilds the whole timeline from baseline, inserting
// an older-dated race recomputes the Strength of Field at its position and
// re-runs every subsequent exchange — the current SR stays mathematically sound.

import { resolveSessionFlags } from "@/lib/standings";
import { racePerClassResults } from "@/lib/classFilter";
import { clampSr, computeSrDeltas, strengthOfField, SR_BASELINE } from "@/lib/skillRating";

// Session types that move SR: the standard Race, or the Feature/A-Main of a
// heat-format weekend. Heats, consolations and qualifying never exchange SR.
const SR_SESSION_TYPES = new Set(["race", "feature"]);
export function isSrSession(sessionType) {
  return SR_SESSION_TYPES.has(sessionType);
}

// A starter is a row that actually took the green flag: not a provisional
// (points-only) entry and not a DNS.
function isStarter(row) {
  return !row.provisional && (row.status || "finished") !== "dns";
}

export function emptyReplay() {
  return { ratings: {}, seasonsByDriver: {}, deltaByResultId: {}, sofByRace: {}, resultMeta: [], raceMeta: [] };
}

// Replay one game's SR timeline from the 1500 baseline. Every argument is a
// plain array of documents (`{ id, ... }`) already narrowed to that game.
// Returns everything both the read and persist paths need:
//   ratings[driverId]         = { rating, races, last_delta }  (current per-game)
//   seasonsByDriver[driverId] = Set(season_id) they started an SR race in
//   deltaByResultId[resultId] = the SR change that result's driver earned
//   sofByRace[raceId]         = Strength of Field of that race's SR session
//   resultMeta[]              = { id, sr_delta }  (current stored value, to diff)
//   raceMeta[]                = { id, strength_of_field }  (current, to diff)
export function replaySkillRatings({ seasons = [], results = [], entries = [], races = [] } = {}) {
  const out = emptyReplay();
  if (!seasons.length) return out;

  const seasonById = Object.fromEntries(seasons.map(s => [s.id, s]));

  const driverByEntry = {};
  for (const e of entries) if (e.driver_id) driverByEntry[e.id] = e.driver_id;
  const raceById = {};
  for (const race of races) {
    raceById[race.id] = race;
    out.raceMeta.push({ id: race.id, strength_of_field: race.strength_of_field ?? null });
  }

  // Group SR-bearing result rows into their sessions (a race can hold several —
  // "Race 1"/"Race 2", or a Feature), skipping any session an admin excluded
  // from official stats — exactly the eligibility the exchange used to apply.
  const sessions = new Map();
  for (const r of results) {
    out.resultMeta.push({ id: r.id, sr_delta: r.sr_delta ?? null });
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
    s.rows.push({ id: r.id, entry_id: r.entry_id, finish_pos: Number(r.finish_pos), provisional: !!r.provisional, status: r.status || "finished", season_id: r.season_id });
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
