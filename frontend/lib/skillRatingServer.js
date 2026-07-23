import { db } from "@/lib/firebase";
import { resolveSessionFlags } from "@/lib/standings";
import { clampSr, computeSrDeltas, ratingOf, strengthOfField } from "@/lib/skillRating";

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
export async function exchangeSkillRatings({ race, savedRows, session, sessionType, priorByEntry = {} }) {
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
    currentRating[doc.id] = doc.exists ? ratingOf(doc.data().skillRating) : ratingOf(null);
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
  const eligible = isSrSession(sessionType) && flags.counts_stats !== false && starters.length >= 1;

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
    batch.update(db().collection("drivers").doc(id), { skillRating: clampSr(newRating[id]) });
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
// points and stats do. `priorByEntry` maps entry_id -> total sr_delta to undo.
export async function reverseSkillRatings(priorByEntry) {
  const entryIds = Object.keys(priorByEntry);
  if (!entryIds.length) return;

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
    batch.update(doc.ref, { skillRating: clampSr(ratingOf(doc.data().skillRating) - priorByDriver[doc.id]) });
  }
  await batch.commit();
}
