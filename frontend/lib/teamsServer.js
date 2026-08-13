import { db } from "@/lib/firebase";
import { scopeByLeague } from "@/lib/serverAuth";
import { buildTeamIndex, entryIdentityKeys, teamNameKey, TEAM_SEASONS_COLLECTION } from "@/lib/teams";

// Server half of the team model (see lib/teams.js for the rules it applies):
// the Firestore reads that build the index, and the writes that keep a
// season's lineup and its roster entries in step.

export { TEAM_SEASONS_COLLECTION };

const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// The whole team picture for one league, read once: the global pool, every
// season lineup, and the driver pool the lineups name. Callers that walk many
// seasons (the stats tables, a team's career profile) load this ONCE and ask it
// per season, rather than re-reading teams inside the season loop.
//
// `drivers` is only needed to match a lineup against entries written before
// `driver_id` existed; skip it with { withDrivers: false } where every entry is
// known to carry one.
export async function loadTeamIndex({ leagueId = "", withDrivers = true } = {}) {
  const [teamsSnap, mappingsSnap, driversSnap] = await Promise.all([
    scopeByLeague(db().collection("teams"), leagueId).get(),
    scopeByLeague(db().collection(TEAM_SEASONS_COLLECTION), leagueId).get(),
    withDrivers ? scopeByLeague(db().collection("drivers"), leagueId).get() : Promise.resolve(null),
  ]);
  return buildTeamIndex({
    teams: docsOf(teamsSnap),
    teamSeasons: docsOf(mappingsSnap),
    drivers: driversSnap ? docsOf(driversSnap) : [],
  });
}

// A global team whose name already exists in the league, so creating "Phoenix
// Motorsports" for a second season reuses the team it already is instead of
// minting a rival identity — the same "don't spawn duplicates" rule
// ensureDriverId applies to the driver pool.
export async function findTeamByName(name, leagueId = "") {
  const wanted = teamNameKey(name);
  if (!wanted) return null;
  const snap = await scopeByLeague(db().collection("teams"), leagueId).get();
  const matches = docsOf(snap).filter(t => teamNameKey(t.name) === wanted);
  if (!matches.length) return null;
  // Prefer a global doc, then the oldest — the same canonical pick lib/teams.js
  // makes when it folds legacy per-season docs together.
  matches.sort((a, b) =>
    (!!a.season_id - !!b.season_id) ||
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    String(a.id).localeCompare(String(b.id)));
  return matches[0];
}

export async function fetchSeasonMappings(seasonId) {
  const snap = await db().collection(TEAM_SEASONS_COLLECTION).where("season_id", "==", seasonId).get();
  return docsOf(snap);
}

// The lineup doc for one (team, season) pair, or null. Used before a create so
// adding a team to a season twice edits the mapping it already has.
export async function findMapping(teamId, seasonId) {
  const snap = await db().collection(TEAM_SEASONS_COLLECTION)
    .where("season_id", "==", seasonId)
    .where("team_id", "==", teamId)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ── Keeping roster entries in step ──────────────────────────────────────────
//
// `entries.team_id` is mirrored from the season lineup, exactly the way an
// entry's `class_id` mirrors `class_ids[0]`. The lineup is the source of truth;
// the mirror is what keeps every reader written before team_seasons existed —
// a results grid, an event page, an export — showing the right team without
// having to know about the new collection.
//
// Returns how many entries were touched, so a route can report it.
export async function syncEntryTeams(seasonId, { teamId, driverIds = [], removedDriverIds = [] }) {
  if (!seasonId || !teamId) return 0;
  const [entriesSnap, driversSnap] = await Promise.all([
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("drivers").get(),
  ]);
  const entries = docsOf(entriesSnap);
  const driversById = Object.fromEntries(docsOf(driversSnap).map(d => [d.id, d]));

  // Every identity key each named driver could be matched by, so a lineup still
  // finds an entry that predates driver_id.
  const keysFor = ids => {
    const keys = new Set();
    for (const id of ids) {
      if (!id) continue;
      keys.add(`d:${id}`);
      const d = driversById[id];
      if (d?.user_id) keys.add(`u:${d.user_id}`);
      if (d?.name) keys.add(`n:${teamNameKey(d.name)}`);
    }
    return keys;
  };
  const wanted = keysFor(driverIds);
  const dropped = keysFor(removedDriverIds);

  const batch = db().batch();
  let touched = 0;
  for (const entry of entries) {
    const keys = entryIdentityKeys(entry);
    if (keys.some(k => wanted.has(k))) {
      if (entry.team_id !== teamId) {
        batch.update(db().collection("entries").doc(entry.id), { team_id: teamId });
        touched++;
      }
    } else if (entry.team_id === teamId && keys.some(k => dropped.has(k))) {
      // Dropped from the lineup: clear the mirror rather than leaving the entry
      // pointing at a team the driver no longer races for.
      batch.update(db().collection("entries").doc(entry.id), { team_id: "" });
      touched++;
    }
  }
  if (touched) await batch.commit();
  return touched;
}

// The mirror in the other direction: an admin who sets a driver's team on the
// roster (or a sign-up approved onto one) has just said who they drive for this
// season, so the season's LINEUP is updated to match — added to the team named,
// removed from any other, with a lineup document created if the team hadn't
// been entered in the season yet.
//
// Without this the two halves could disagree, and the team tables would quietly
// follow whichever half the reader happened to consult. A driver with no global
// identity yet (no driver_id) can't join a lineup — their entry's own team tag
// still resolves them, which is exactly the fallback lib/teams.js keeps.
export async function syncLineupFromEntry({ seasonId, driverId, teamId, userId = null }) {
  if (!seasonId || !driverId) return null;
  const mappings = await fetchSeasonMappings(seasonId);
  const target = teamId ? String(teamId) : "";

  let joined = null;
  for (const mapping of mappings) {
    const ids = mapping.driver_ids || [];
    const isTarget = mapping.team_id === target;
    if (isTarget) {
      joined = mapping.id;
      if (!ids.includes(driverId)) {
        await db().collection(TEAM_SEASONS_COLLECTION).doc(mapping.id).update({ driver_ids: [...ids, driverId] });
      }
    } else if (ids.includes(driverId)) {
      await db().collection(TEAM_SEASONS_COLLECTION).doc(mapping.id)
        .update({ driver_ids: ids.filter(id => id !== driverId) });
    }
  }

  if (target && !joined) {
    const teamDoc = await db().collection("teams").doc(target).get();
    if (!teamDoc.exists) return null;
    const doc = {
      team_id: target,
      season_id: seasonId,
      driver_ids: [driverId],
      created_at: new Date().toISOString(),
      created_by: userId || null,
    };
    const leagueId = teamDoc.data().league_id;
    if (leagueId) doc.league_id = leagueId;
    const ref = await db().collection(TEAM_SEASONS_COLLECTION).add(doc);
    joined = ref.id;
  }
  return joined;
}

// Clear a team off every entry in one season — used when a team is removed from
// a season, and when it's deleted outright.
export async function clearTeamFromEntries(teamId, { seasonId = null } = {}) {
  let query = db().collection("entries").where("team_id", "==", teamId);
  if (seasonId) query = query.where("season_id", "==", seasonId);
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = db().batch();
  for (const doc of snap.docs) batch.update(doc.ref, { team_id: "" });
  await batch.commit();
  return snap.size;
}

// Delete every season lineup for a team (all seasons, or just one).
export async function deleteMappingsForTeam(teamId, { seasonId = null } = {}) {
  let query = db().collection(TEAM_SEASONS_COLLECTION).where("team_id", "==", teamId);
  if (seasonId) query = query.where("season_id", "==", seasonId);
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = db().batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}
