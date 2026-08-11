// ─────────────────────────────────────────────────────────────────────────────
// Team identity — the pure half (no Firestore), so it can be unit-tested.
//
// A team is a PERSISTENT entity, exactly like a driver in the global pool:
//
//   teams/{id}          { name, logo_url, color, created_at }        ← global
//   team_seasons/{id}   { team_id, season_id, driver_ids[] }         ← contextual
//
// The global doc is who the team IS. The `team_seasons` doc is who drove for
// it IN ONE SEASON — which is what lets Driver A race for Team X in Season 1
// and Team Y in Season 2 without either team losing its history. `driver_ids`
// holds GLOBAL driver ids (drivers/{id} — the same identity `entries.driver_id`
// points at), so a lineup survives a driver being renamed, re-numbered or
// entered under a different alias in another series.
//
// Teams used to be per-SEASON documents keyed by name: one `teams` doc per
// season, with cross-season identity inferred by lowercasing the name. Those
// docs still exist in leagues that haven't run the migration
// (POST /api/admin/teams/migrate), so everything here reads BOTH shapes:
//
//   • a doc with no `season_id` is a global team — its own id is its identity;
//   • a doc WITH a `season_id` is a legacy per-season team — its identity is
//     the canonical doc sharing its name (see canonical selection below).
//
// That's what makes the overhaul non-destructive: an un-migrated league keeps
// aggregating exactly as it did, and a migrated one keys on a real id.
// ─────────────────────────────────────────────────────────────────────────────

export const TEAM_SEASONS_COLLECTION = "team_seasons";

// Cross-season identity of a legacy per-season team: its lowercased name.
export function teamNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

// Which of two docs sharing a name is the persistent one. A global doc always
// beats a per-season doc (that's the whole point of the migration), then the
// oldest wins, and the id breaks a dead tie so the answer never depends on the
// order Firestore handed the docs back.
function preferTeam(a, b) {
  const aGlobal = !a.season_id, bGlobal = !b.season_id;
  if (aGlobal !== bGlobal) return aGlobal ? a : b;
  const at = String(a.created_at ?? ""), bt = String(b.created_at ?? "");
  if (at !== bt) return at < bt ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}

// The identity keys a roster entry can be matched on, most specific first —
// the same chain /api/roster and /api/stats unify drivers by.
export function entryIdentityKeys(entry = {}) {
  const keys = [];
  if (entry.driver_id) keys.push(`d:${entry.driver_id}`);
  if (entry.user_id) keys.push(`u:${entry.user_id}`);
  const name = teamNameKey(entry.name);
  if (name) keys.push(`n:${name}`);
  return keys;
}

// The same keys for a global driver doc, so a season lineup written as
// driver_ids still matches an old entry that never got a driver_id (matched by
// linked account, then by name).
function driverIdentityKeys(driver = {}) {
  const keys = [`d:${driver.id}`];
  if (driver.user_id) keys.push(`u:${driver.user_id}`);
  const name = teamNameKey(driver.name);
  if (name) keys.push(`n:${name}`);
  return keys;
}

// Build the resolver every stats path shares.
//
//   teams        — every doc in the `teams` collection (global and/or legacy)
//   teamSeasons  — every doc in `team_seasons`
//   drivers      — the global driver pool (optional; only needed to match
//                  entries that carry no driver_id)
//
// The returned index answers one load-bearing question — "which team was this
// driver racing for in THIS season?" — and answers it the same way for the
// standings, the stats tables and a team's career profile, so the three can
// never disagree about who scored what.
export function buildTeamIndex({ teams = [], teamSeasons = [], drivers = [] } = {}) {
  const teamsById = new Map(teams.map(t => [t.id, t]));
  const driversById = new Map(drivers.map(d => [d.id, d]));

  // One canonical doc per team name, used to fold legacy per-season docs into
  // a single persistent identity.
  const canonicalByName = new Map();
  for (const t of teams) {
    const key = teamNameKey(t.name);
    if (!key) continue;
    const cur = canonicalByName.get(key);
    canonicalByName.set(key, cur ? preferTeam(t, cur) : t);
  }

  // A raw team doc id → the persistent team id it belongs to. An id we've never
  // seen is returned untouched rather than dropped: a dangling entry.team_id
  // should keep pointing somewhere, not silently lose the driver's team.
  function canonicalTeamId(id) {
    if (!id) return null;
    const t = teamsById.get(id);
    if (!t) return id;
    if (!t.season_id) return t.id;
    return canonicalByName.get(teamNameKey(t.name))?.id ?? t.id;
  }

  function teamById(id) {
    const cid = canonicalTeamId(id);
    return cid ? teamsById.get(cid) ?? teamsById.get(id) ?? null : null;
  }

  // season_id → Map(driver identity key → persistent team id). Built from the
  // season lineups; the first team to claim a driver keeps them, so a driver
  // mistakenly listed on two teams in one season still scores exactly once.
  const bySeason = new Map();
  const claim = (map, key, teamId) => { if (!map.has(key)) map.set(key, teamId); };
  for (const ts of teamSeasons) {
    if (!ts?.season_id || !ts?.team_id) continue;
    const teamId = canonicalTeamId(ts.team_id);
    let map = bySeason.get(ts.season_id);
    if (!map) bySeason.set(ts.season_id, (map = new Map()));
    for (const driverId of ts.driver_ids || []) {
      if (!driverId) continue;
      claim(map, `d:${driverId}`, teamId);
      const d = driversById.get(driverId);
      if (d) for (const k of driverIdentityKeys({ ...d, id: driverId })) claim(map, k, teamId);
    }
  }

  // Which teams are mapped into a season: its `team_seasons` rows, plus any
  // legacy per-season doc that belongs to it (an un-migrated league has no
  // team_seasons at all and would otherwise look empty).
  const seasonTeamIds = new Map();
  const addSeasonTeam = (seasonId, teamId) => {
    if (!seasonId || !teamId) return;
    let set = seasonTeamIds.get(seasonId);
    if (!set) seasonTeamIds.set(seasonId, (set = new Set()));
    set.add(teamId);
  };
  for (const ts of teamSeasons) addSeasonTeam(ts.season_id, canonicalTeamId(ts.team_id));
  for (const t of teams) if (t.season_id) addSeasonTeam(t.season_id, canonicalTeamId(t.id));

  // The team_seasons doc for one (team, season), so a roster edit knows what it
  // is editing rather than creating a second lineup for the same pair.
  const mappingKey = (teamId, seasonId) => `${canonicalTeamId(teamId)}::${seasonId}`;
  const mappingByPair = new Map();
  for (const ts of teamSeasons) {
    if (!ts?.season_id || !ts?.team_id) continue;
    mappingByPair.set(mappingKey(ts.team_id, ts.season_id), ts);
  }

  return {
    teamsById,
    driversById,
    canonicalTeamId,
    teamById,

    // The identity keys one global driver can be matched on, so a caller can
    // pair a lineup's driver ids with the season's roster entries.
    keysForDriver(driverId) {
      const d = driversById.get(driverId);
      return d ? driverIdentityKeys({ ...d, id: driverId }) : [`d:${driverId}`];
    },

    // THE question: which team did this roster entry drive for that season?
    // The season lineup is the source of truth; `entries.team_id` is the
    // fallback, so a league that has never opened the new screen (or a driver
    // added straight from a results grid) still resolves exactly as before.
    teamIdForEntry(entry, seasonId) {
      const map = seasonId ? bySeason.get(seasonId) : null;
      if (map) {
        for (const key of entryIdentityKeys(entry)) {
          const hit = map.get(key);
          if (hit) return hit;
        }
      }
      return entry?.team_id ? canonicalTeamId(entry.team_id) : null;
    },

    teamForEntry(entry, seasonId) {
      const id = this.teamIdForEntry(entry, seasonId);
      return id ? teamById(id) : null;
    },

    teamIdsInSeason(seasonId) {
      return [...(seasonTeamIds.get(seasonId) || [])];
    },

    teamsInSeason(seasonId) {
      return this.teamIdsInSeason(seasonId).map(id => teamById(id)).filter(Boolean);
    },

    // Every season this persistent team has been mapped into.
    seasonsForTeam(teamId) {
      const wanted = canonicalTeamId(teamId);
      const out = [];
      for (const [seasonId, ids] of seasonTeamIds) if (ids.has(wanted)) out.push(seasonId);
      return out;
    },

    mappingFor(teamId, seasonId) {
      return mappingByPair.get(mappingKey(teamId, seasonId)) ?? null;
    },

    driverIdsFor(teamId, seasonId) {
      return [...(this.mappingFor(teamId, seasonId)?.driver_ids ?? [])];
    },
  };
}

// Stamp every entry with the team it actually raced for that season, so
// everything downstream (calculateStandings, calculateTeamStandings, the stats
// buckets, an event's results grid) keeps reading a plain `entry.team_id` and
// gets the season lineup's answer for free. `team` carries the resolved name
// for the readers that fall back to it when a team doc is missing.
// Every team doc a season's tables need: the teams entered in the season, plus
// any team its entries resolve to (a legacy tag on an entry whose team was
// never mapped into the season). Passing this to calculateTeamStandings is what
// gives each team row its name, logo and colour.
export function teamsForEntries(entries, seasonId, index) {
  const byId = new Map(index.teamsInSeason(seasonId).map(t => [t.id, t]));
  for (const entry of entries) {
    const id = index.teamIdForEntry(entry, seasonId);
    if (!id || byId.has(id)) continue;
    const team = index.teamById(id);
    if (team) byId.set(team.id, team);
  }
  return [...byId.values()];
}

export function applySeasonTeams(entries, seasonId, index) {
  return entries.map(entry => {
    const teamId = index.teamIdForEntry(entry, seasonId);
    if (!teamId) return entry;
    const team = index.teamById(teamId);
    return { ...entry, team_id: teamId, team: team?.name ?? entry.team ?? null };
  });
}
