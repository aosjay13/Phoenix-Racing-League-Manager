// Synthetic league data for the CPU profiler.
//
// The shapes here mirror what the real collections hold — enough of each
// document for the scoring, summarizing and roster code to do its actual work
// rather than bailing out early on a missing field. A profile run is only
// honest if the aggregation loops it measures really execute, so every result
// resolves to a race, every entry to a class, and every race to a season.
//
// `scale` is the number of SEASONS the league has raced. Everything else grows
// from it the way a real league does: seasons bring races, races bring results,
// results are per entry per session. A league that has run 12 seasons of
// 20-round championships is not an exotic case — it is four years of racing.

const GAMES = ["iracing", "acc", "ams2", "gt7"];
const SESSIONS = ["Qualifying", "Heat 1", "Heat 2", "Feature"];

// Deterministic PRNG, so two runs profile identical data and a difference in
// the numbers is a difference in the code.
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function buildDataset({
  seasons: seasonCount = 12,
  racesPerSeason = 20,
  driversPerSeason = 28,
  classesPerSeason = 2,
  users = 120,
  seed = 7,
} = {}) {
  const rand = rng(seed);
  const leagueId = "league-main";
  const data = {
    leagues: [], users: [], drivers: [], games: [], series: [], seasons: [],
    classes: [], races: [], entries: [], results: [], teams: [], team_seasons: [],
    messages: [], signup_requests: [], claim_requests: [], points_templates: [],
    tracks: [], settings: [],
  };

  data.leagues.push({ id: leagueId, name: "Phoenix Racing League", created_at: "2021-01-01T00:00:00.000Z" });
  data.points_templates.push({
    id: "tpl-standard", league_id: leagueId, name: "Standard",
    points: JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, 100 - i * 3]))),
  });
  for (const g of GAMES) data.games.push({ id: g, league_id: leagueId, name: g.toUpperCase() });
  for (let t = 0; t < 40; t++) {
    data.tracks.push({ id: `track-${t}`, league_id: leagueId, name: `Circuit ${t}`, length_mi: 1.5 + rand() * 2 });
  }

  // Accounts. Most are plain players; a handful hold staff roles. The admin
  // dashboard reads this collection whole on every poll, so its real size is
  // part of what the profiler is measuring.
  for (let u = 0; u < users; u++) {
    const role = u === 0 ? "owner" : u < 4 ? "admin" : u < 8 ? "moderator" : "player";
    data.users.push({
      id: `uid-${u}`,
      email: `driver${u}@example.com`,
      display_name: `Driver ${u}`,
      role,
      league_roles: { [leagueId]: role },
      created_at: new Date(Date.UTC(2021, 0, 1 + u)).toISOString(),
      photo_url: null,
      signup_league_id: leagueId,
    });
  }

  // The driver pool: every person who has ever raced, which is what the roster
  // and the team index read whole.
  const driverCount = Math.max(users, driversPerSeason * 3);
  for (let d = 0; d < driverCount; d++) {
    data.drivers.push({
      id: `drv-${d}`,
      league_id: leagueId,
      name: `Driver ${d}`,
      user_id: d < users ? `uid-${d}` : null,
      // The stored shape lib/driverNames.js actually reads: [{ game_id, name }].
      // `acc` deliberately differs from the overall name, so any table that
      // resolves names per game is measurably different from one that doesn't.
      game_names: [{ game_id: "iracing", name: `Driver ${d}` }, { game_id: "acc", name: `D${d}` }],
      created_at: "2021-01-01T00:00:00.000Z",
    });
  }

  for (let t = 0; t < 8; t++) {
    data.teams.push({ id: `team-${t}`, league_id: leagueId, name: `Team ${t}` });
  }

  for (let s = 0; s < seasonCount; s++) {
    const seriesId = `series-${s % 3}`;
    if (!data.series.find(x => x.id === seriesId)) {
      data.series.push({ id: seriesId, league_id: leagueId, name: `Series ${s % 3}`, game_id: GAMES[s % GAMES.length] });
    }
    const seasonId = `season-${s}`;
    data.seasons.push({
      id: seasonId,
      league_id: leagueId,
      series_id: seriesId,
      game_id: GAMES[s % GAMES.length],
      name: `Season ${s + 1}`,
      order: s,
      completed: s < seasonCount - 1,
      race_points: JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, 100 - i * 3]))),
      qual_points: JSON.stringify({ 1: 5, 2: 3, 3: 1 }),
      bonus_points: { fastest_lap: 1, most_laps_led: 1 },
      created_at: new Date(Date.UTC(2021, s, 1)).toISOString(),
    });

    const classIds = [];
    for (let c = 0; c < classesPerSeason; c++) {
      const classId = `class-${s}-${c}`;
      classIds.push(classId);
      data.classes.push({
        id: classId, league_id: leagueId, season_id: seasonId,
        name: c === 0 ? "Pro" : "Am", order: c, car: `Car ${c}`,
      });
    }

    // Entries: one per driver per season, spread across the classes.
    const entryIds = [];
    for (let e = 0; e < driversPerSeason; e++) {
      const entryId = `entry-${s}-${e}`;
      entryIds.push(entryId);
      const teamId = `team-${e % 8}`;
      data.entries.push({
        id: entryId, league_id: leagueId, season_id: seasonId,
        driver_id: `drv-${e % driverCount}`,
        name: `Driver ${e % driverCount}`,
        class_ids: [classIds[e % classIds.length]],
        class_id: classIds[e % classIds.length],
        team_id: teamId, team: `Team ${e % 8}`,
        car_number: String(e + 1),
      });
      if (e < 8) {
        data.team_seasons.push({
          id: `ts-${s}-${e}`, league_id: leagueId, season_id: seasonId,
          team_id: `team-${e}`, name: `Team ${e}`, entry_ids: entryIds.filter((_, i) => i % 8 === e),
        });
      }
    }

    for (let r = 0; r < racesPerSeason; r++) {
      const raceId = `race-${s}-${r}`;
      data.races.push({
        id: raceId, league_id: leagueId, season_id: seasonId,
        track_id: `track-${(s * racesPerSeason + r) % 40}`,
        name: `Round ${r + 1}`,
        date: new Date(Date.UTC(2021 + Math.floor(s / 4), (s % 4) * 3, 1 + r * 7)).toISOString(),
        sessions: SESSIONS,
        distance_laps: 30 + (r % 10),
        class_id: r % 7 === 0 ? classIds[0] : null,
      });

      // Every session of every round, for every entry. This is the collection
      // that actually gets big: seasons x rounds x sessions x drivers.
      for (const session of SESSIONS) {
        const order = entryIds
          .map(id => ({ id, k: rand() }))
          .sort((a, b) => a.k - b.k)
          .map(x => x.id);
        order.forEach((entryId, i) => {
          data.results.push({
            id: `res-${s}-${r}-${session}-${entryId}`,
            league_id: leagueId, season_id: seasonId, race_id: raceId,
            entry_id: entryId, session,
            session_type: session === "Qualifying" ? "qualifying" : "race",
            finish_pos: i + 1, start_pos: ((i + 3) % order.length) + 1,
            laps: session === "Qualifying" ? 3 : 30 + (r % 10) - (i > 20 ? 2 : 0),
            laps_led: i === 0 ? 20 : 0,
            fastest_lap: i === 1,
            incidents: Math.floor(rand() * 6),
            interval: i === 0 ? "—" : `+${(i * 1.7).toFixed(3)}`,
          });
        });
      }
    }
  }

  // Board traffic and queues — small collections, but the admin pollers read
  // them whole every minute alongside everything else.
  for (let m = 0; m < 60; m++) {
    data.messages.push({
      id: `msg-${m}`, league_id: leagueId, uid: `uid-${m % users}`,
      kind: "signup_approved", context: { series_name: "Series 0" },
      replies: m % 3 === 0 ? [{ by: "player", text: "Thanks!", at: "2024-01-01T00:00:00.000Z" }] : [],
      created_at: new Date(Date.UTC(2024, 0, 1 + m)).toISOString(),
      admin_seen_at: m % 3 === 0 ? null : "2024-01-01T00:00:00.000Z",
      user_seen_at: null,
    });
  }
  for (let s = 0; s < 90; s++) {
    data.signup_requests.push({
      id: `sr-${s}`, league_id: leagueId, uid: `uid-${s % users}`,
      series_id: "series-0", season_id: `season-${seasonCount - 1}`,
      status: s < 6 ? "pending" : "approved",
      driver_name: `Driver ${s % users}`,
      created_at: new Date(Date.UTC(2025, 0, 1 + s)).toISOString(),
    });
  }
  for (let c = 0; c < 4; c++) {
    data.claim_requests.push({
      id: `cr-${c}`, league_id: leagueId, uid: `uid-${c}`,
      driver_id: `drv-${c}`, status: "pending",
      created_at: "2025-06-01T00:00:00.000Z",
    });
  }

  return { leagueId, data };
}

// Row counts, for the report header.
export function describe({ data }) {
  return Object.fromEntries(
    Object.entries(data)
      .map(([name, rows]) => [name, rows.length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]),
  );
}
