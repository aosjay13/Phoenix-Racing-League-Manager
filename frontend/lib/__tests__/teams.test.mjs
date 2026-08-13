// Teams are persistent; line-ups are not. The invariants that matter:
//
//   1. a driver's results count for the team they drove for IN THAT SEASON,
//      even after they move to a rival the following year;
//   2. a season's team table is exactly the sum of its driver table;
//   3. a team's all-time line is exactly the sum of its seasons.
//
// Everything below asserts those three against the real scoring engine, so the
// cascade can't quietly break as points rules change.
import assert from "node:assert";
import { applySeasonTeams, buildTeamIndex, teamsForEntries } from "../teams.js";
import {
  aggregateCareerStats, calculateStandings, calculateTeamStandings,
  decorateRaceBonuses, decorateSessionFlags, makeScorer, resolveSeasonConfig,
} from "../standings.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// race P1 100 / P2 90 / P3 80, no qualifying points in play
const config = resolveSeasonConfig({ race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80 }) }, null);
const racesById = { r1: { sessions: ["Race"] } };

const teams = [
  { id: "phoenix", name: "Phoenix Motorsports", logo_url: "phoenix.png", created_at: "2024-01-01" },
  { id: "falcon", name: "Falcon Racing", created_at: "2024-01-02" },
];
const drivers = [
  { id: "dA", name: "Ana" },
  { id: "dB", name: "Bo" },
  { id: "dC", name: "Cyd" },
];

// Season 1: Ana + Bo drive for Phoenix, Cyd for Falcon.
// Season 2: they swap — Cyd to Phoenix, Ana + Bo to Falcon.
const teamSeasons = [
  { id: "m1", team_id: "phoenix", season_id: "s1", driver_ids: ["dA", "dB"] },
  { id: "m2", team_id: "falcon", season_id: "s1", driver_ids: ["dC"] },
  { id: "m3", team_id: "phoenix", season_id: "s2", driver_ids: ["dC"] },
  { id: "m4", team_id: "falcon", season_id: "s2", driver_ids: ["dA", "dB"] },
];

const index = buildTeamIndex({ teams, teamSeasons, drivers });

const seasonEntries = {
  s1: [
    { id: "e1", season_id: "s1", name: "Ana", driver_id: "dA" },
    { id: "e2", season_id: "s1", name: "Bo", driver_id: "dB" },
    { id: "e3", season_id: "s1", name: "Cyd", driver_id: "dC" },
  ],
  s2: [
    { id: "e4", season_id: "s2", name: "Ana", driver_id: "dA" },
    { id: "e5", season_id: "s2", name: "Bo", driver_id: "dB" },
    { id: "e6", season_id: "s2", name: "Cyd", driver_id: "dC" },
  ],
};
const race = (entry, pos) => ({ race_id: "r1", entry_id: entry, session: "Race", session_type: "race", finish_pos: pos });
const seasonResults = {
  // Ana wins, Bo 2nd, Cyd 3rd
  s1: [race("e1", 1), race("e2", 2), race("e3", 3)],
  // and the year after, Cyd wins, Bo 2nd, Ana 3rd
  s2: [race("e6", 1), race("e5", 2), race("e4", 3)],
};

// One season, scored end to end exactly as /api/standings does it.
function seasonTables(seasonId) {
  const entries = applySeasonTeams(seasonEntries[seasonId], seasonId, index);
  const results = decorateRaceBonuses(decorateSessionFlags(seasonResults[seasonId], racesById));
  const drivers = calculateStandings(results, entries, teamsForEntries(entries, seasonId, index), config);
  return { entries, results, drivers, teams: calculateTeamStandings(drivers.rows, teamsForEntries(entries, seasonId, index)) };
}

// ── 1. A line-up is scoped to its season ──────────────────────────────────
const s1 = seasonTables("s1");
const s2 = seasonTables("s2");

check("season 1 line-ups", Object.fromEntries(s1.entries.map(e => [e.name, e.team_id])),
  { Ana: "phoenix", Bo: "phoenix", Cyd: "falcon" });
check("season 2 line-ups — everyone has moved", Object.fromEntries(s2.entries.map(e => [e.name, e.team_id])),
  { Ana: "falcon", Bo: "falcon", Cyd: "phoenix" });

// ── 2. A season's team table is the sum of its driver table ───────────────
for (const [label, season] of [["season 1", s1], ["season 2", s2]]) {
  const fromDrivers = {};
  for (const row of season.drivers.rows) {
    fromDrivers[row.team_id] = (fromDrivers[row.team_id] || 0) + row.adjusted_points;
  }
  check(`${label} team points roll up from the drivers`,
    Object.fromEntries(season.teams.map(t => [t.team_id, t.points])), fromDrivers);
}

// Ana 100 + Bo 90 = 190 for Phoenix; Cyd 80 for Falcon.
check("season 1 team points", Object.fromEntries(s1.teams.map(t => [t.team, t.points])),
  { "Phoenix Motorsports": 190, "Falcon Racing": 80 });
// The swap flips it: Cyd's 100 is Phoenix's, Ana + Bo's 170 is Falcon's.
check("season 2 team points", Object.fromEntries(s2.teams.map(t => [t.team, t.points])),
  { "Falcon Racing": 170, "Phoenix Motorsports": 100 });
check("season 1 team wins", Object.fromEntries(s1.teams.map(t => [t.team, t.wins])),
  { "Phoenix Motorsports": 1, "Falcon Racing": 0 });
check("season 2 team wins", Object.fromEntries(s2.teams.map(t => [t.team, t.wins])),
  { "Falcon Racing": 0, "Phoenix Motorsports": 1 });
check("a team's badge comes from the pool doc",
  s1.teams.find(t => t.team_id === "phoenix").logo_url, "phoenix.png");

// ── 3. All-time = the seasons added up, per persistent team ───────────────
// The aggregation /api/stats performs: every scored result bucketed by the
// team its driver raced for that season, keyed by the team's document id.
const buckets = {};
for (const seasonId of ["s1", "s2"]) {
  const entries = applySeasonTeams(seasonEntries[seasonId], seasonId, index);
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
  const results = decorateRaceBonuses(decorateSessionFlags(seasonResults[seasonId], racesById));
  const scorer = makeScorer(results, { config, classes: [], entriesById, templatesById: {} });
  for (const r of results) {
    const teamId = index.teamIdForEntry(entriesById[r.entry_id], seasonId);
    (buckets[teamId] ??= []).push({ ...r, points: scorer.points(r) });
  }
}
const allTime = Object.fromEntries(Object.entries(buckets).map(([id, rs]) => [id, aggregateCareerStats(rs).points]));
check("all-time team points are the seasons added together", allTime, { phoenix: 290, falcon: 250 });
check("nothing is lost or double-counted",
  Object.values(allTime).reduce((a, b) => a + b, 0),
  s1.drivers.rows.concat(s2.drivers.rows).reduce((a, r) => a + r.adjusted_points, 0));

// Each team's all-time wins: one apiece — Ana's for Phoenix, Cyd's for Phoenix
// again, and none for Falcon, whose winners always won for somebody else.
check("all-time team wins",
  Object.fromEntries(Object.entries(buckets).map(([id, rs]) => [id, aggregateCareerStats(rs).wins])),
  { phoenix: 2, falcon: 0 });

// ── 4. A driver on no line-up falls back to their entry's own team tag ────
// This is what keeps a league that has never opened the Team Roster screen —
// or a driver added straight from a results grid — scoring exactly as before.
check("entry tag is the fallback",
  index.teamIdForEntry({ id: "e9", name: "Dee", driver_id: "dD", team_id: "falcon" }, "s1"), "falcon");
check("no line-up and no tag means no team",
  index.teamIdForEntry({ id: "e9", name: "Dee", driver_id: "dD" }, "s1"), null);
check("a line-up beats a stale tag",
  index.teamIdForEntry({ id: "e1", name: "Ana", driver_id: "dA", team_id: "falcon" }, "s1"), "phoenix");

// ── 5. Legacy per-season team documents are one team, not three ───────────
// Before teams were league-wide, each season held its own "Phoenix Motorsports"
// document. Their shared name is the identity, and the oldest doc is the one
// that survives — so an un-migrated league aggregates across seasons too.
const legacy = buildTeamIndex({
  teams: [
    { id: "old1", name: "Phoenix Motorsports", season_id: "s1", created_at: "2023-01-01" },
    { id: "old2", name: "phoenix motorsports", season_id: "s2", created_at: "2023-06-01" },
    { id: "old3", name: "Falcon Racing", season_id: "s2", created_at: "2023-06-02" },
  ],
  teamSeasons: [],
  drivers,
});
check("legacy docs fold onto one identity",
  [legacy.canonicalTeamId("old1"), legacy.canonicalTeamId("old2")], ["old1", "old1"]);
check("a legacy team's seasons are found through its docs",
  legacy.seasonsForTeam("old2").sort(), ["s1", "s2"]);
check("entries in different seasons resolve to the same team",
  [
    legacy.teamIdForEntry({ driver_id: "dA", team_id: "old1" }, "s1"),
    legacy.teamIdForEntry({ driver_id: "dA", team_id: "old2" }, "s2"),
  ], ["old1", "old1"]);
check("a global doc always wins the name",
  buildTeamIndex({
    teams: [
      { id: "old1", name: "Phoenix Motorsports", season_id: "s1", created_at: "2023-01-01" },
      { id: "pool", name: "Phoenix Motorsports", created_at: "2025-01-01" },
    ],
  }).canonicalTeamId("old1"), "pool");

// ── 6. A line-up can name a driver who never got a driver_id ──────────────
// Older roster entries carry only a name (or a linked account). A line-up is
// written in global driver ids, so those entries are matched through the
// driver's own record — the same chain the roster unifies drivers by.
const byName = buildTeamIndex({
  teams,
  teamSeasons: [{ id: "m9", team_id: "phoenix", season_id: "s1", driver_ids: ["dA"] }],
  drivers: [{ id: "dA", name: "Ana", user_id: "uid-ana" }],
});
check("matched by linked account", byName.teamIdForEntry({ name: "A. Nother", user_id: "uid-ana" }, "s1"), "phoenix");
check("matched by name", byName.teamIdForEntry({ name: " ana " }, "s1"), "phoenix");
check("someone else is unaffected", byName.teamIdForEntry({ name: "Bo" }, "s1"), null);

console.log(`teams: ${n} checks passed`);
