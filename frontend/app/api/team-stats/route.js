import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { fetchSeriesByIds } from "@/lib/seriesServer";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { cachedPayload } from "@/lib/statsCache";
import {
  aggregateCareerStats,
  compareStandings,
  decorateRaceBonuses,
  decorateSessionFlags,
  sessionScopeContext,
  makeScorer,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { fetchSeasonClasses } from "@/lib/classServer";
import { seasonChampions, titlesByEntry } from "@/lib/champions";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { applySeasonTeams, teamNameKey } from "@/lib/teams";
import { loadTeamIndex } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Career profile for ONE persistent team, aggregated across every season it has
// fielded a lineup in.
//
//   ?team=<id>     the team document (what every link in the app now sends)
//   ?team=<name>   or its name — old links, and anything still keyed by name
//   ?name=<name>   the original parameter, still honoured
//
// The cascade in one place: for each season, every driver on the team's lineup
// that season has their results scored under that season's rules, those results
// roll up into the team's line for the season, and the seasons add up to the
// all-time line at the top. A driver who moves teams takes their future results
// with them and leaves their past ones behind — which is the point of scoping a
// lineup to a season.
//
// Cached on (league, team) and dropped whenever a write could move a number —
// see lib/statsCache.js. A team's profile is the combined record of its lineup
// in every season it has ever entered, so it reads the same history the
// league-wide stats do.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wanted = (searchParams.get("team") || searchParams.get("team_id") || searchParams.get("name") || "").trim();
  if (!wanted) return NextResponse.json({ error: "team required" }, { status: 400 });

  const { status, body } = await teamStatsFor(getRequestLeagueId(request), { team: wanted });
  return NextResponse.json(body, { status });
}

const teamStatsFor = cachedPayload("team-stats", async (leagueId, { team: wanted }) => {
  const [teamIndex, templatesById, seasonsSnap] = await Promise.all([
    loadTeamIndex({ leagueId }),
    fetchTemplatesById(),
    // Scope to the active league so a team name shared across leagues doesn't
    // merge their results into one profile.
    scopeByLeague(db().collection("seasons"), leagueId).get(),
  ]);

  // Resolve the target: an id first (the persistent identity), then a name.
  let team = teamIndex.teamById(wanted);
  if (!team) {
    const key = teamNameKey(wanted);
    team = [...teamIndex.teamsById.values()]
      .map(t => teamIndex.teamById(t.id))
      .find(t => t && teamNameKey(t.name) === key) ?? null;
  }
  if (!team) return { status: 404, body: { error: "Team not found" } };

  const seasons = seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Each season scores on its SERIES' points unless it overrides them.
  const seriesById = await fetchSeriesByIds(seasons.map(s => s.series_id));

  const all = [];                 // every scored result for the team
  const drivers = {};             // driverKey -> { driver_name, user_id, results, titles }
  const perSeason = [];           // one row per season the team raced
  let titles = 0;

  const keyFor = e => e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${teamNameKey(e.name)}`;

  for (const season of seasons) {
    const [entriesSnap, resultsSnap, racesSnap, seasonClasses] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
      fetchSeasonClasses(season.id),
    ]);

    // Who was on this team that season, resolved the same way the standings
    // resolve it — from the season's lineup, falling back to the entry's tag.
    const entries = applySeasonTeams(
      entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      season.id,
      teamIndex,
    );
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const onTeam = entry => !!entry && entry.team_id === team.id;
    if (!entries.some(onTeam) && !teamIndex.driverIdsFor(team.id, season.id).length) continue;

    const config = resolveSeasonConfig(season, seriesById[season.series_id] || null);
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const results = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById,
      sessionScopeContext({ seasons: [season], classes: seasonClasses, entriesById })));
    // Each result scores under its driver's class, so a class with its own
    // points structure carries that structure into the team totals.
    const scorer = makeScorer(results, { config, classes: seasonClasses, entriesById, templatesById });

    const seasonResults = [];
    const seasonDrivers = new Map();
    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!onTeam(entry)) continue;
      const scored = {
        ...r,
        // Qualifying scores itself now, so it is not excluded here — only a
        // session whose points toggle is off scores nothing.
        points: r.counts_points === false ? 0 : scorer.points(r),
      };
      all.push(scored);
      seasonResults.push(scored);
      const k = keyFor(entry);
      const bucket = (drivers[k] ??= { driver_name: entry.name, user_id: entry.user_id ?? null, driver_id: entry.driver_id ?? null, results: [], titles: 0 });
      bucket.driver_name = entry.name;
      if (entry.user_id) bucket.user_id = entry.user_id;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      bucket.results.push(scored);
      seasonDrivers.set(k, entry.name);
    }
    if (!seasonResults.length) continue;

    // Every championship won on this team that season — class champions
    // included, and no overall champion at all when the season runs
    // class-only titles. A dual crown (class + overall) is two championships.
    for (const [entryId, rec] of titlesByEntry(seasonChampions(season, results, entries, config, templatesById, seasonClasses))) {
      const champ = entriesById[entryId];
      if (!onTeam(champ)) continue;
      titles += rec.titles;
      const ck = keyFor(champ);
      if (drivers[ck]) drivers[ck].titles += rec.titles;
    }

    const line = aggregateCareerStats(seasonResults, 0);
    perSeason.push({
      season_id: season.id,
      season_name: season.name,
      points: line.points,
      starts: line.starts,
      wins: line.wins,
      podiums: line.podiums,
      poles: line.poles,
      // The lineup that scored it, so the profile can show who drove for the
      // team that year rather than only the combined driver list.
      drivers: [...seasonDrivers.values()],
    });
  }

  // A team profile spans every game the team raced in, so its members show
  // their overall display name (see lib/driverNames.js) rather than any one
  // game's on-track name.
  const names = await fetchDriverNames(Object.values(drivers).map(d => d.driver_id));

  const driverRows = Object.values(drivers)
    .map(d => ({ driver_name: (d.driver_id && names[d.driver_id]?.overall) || d.driver_name, driver_id: d.driver_id, user_id: d.user_id, ...aggregateCareerStats(d.results, d.titles) }))
    .sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "driver_name" }));

  return { status: 200, body: {
    team_id: team.id,
    team_name: team.name,
    logo_url: team.logo_url ?? null,
    color: team.color ?? null,
    created_at: team.created_at ?? null,
    stats: aggregateCareerStats(all, titles),
    seasons_raced: perSeason.length,
    // Every season the team is entered in, including one whose racing hasn't
    // started — so a lineup set up in advance is visible before it scores.
    seasons_entered: teamIndex.seasonsForTeam(team.id).length,
    drivers: driverRows,
    seasons: perSeason,
  } };
});
