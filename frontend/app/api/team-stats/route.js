import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { fetchSeriesByIds } from "@/lib/seriesServer";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import {
  aggregateCareerStats,
  compareStandings,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  makeScorer,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { fetchSeasonClasses } from "@/lib/classServer";
import { seasonChampions, titlesByEntry } from "@/lib/champions";
import { fetchDriverNames } from "@/lib/driverNamesServer";

export const dynamic = "force-dynamic";

// Career profile for one team, aggregated across every season it appears in.
// Teams are per-season docs keyed by name (no global id), so `?name=` selects
// every season-team sharing that name — the same identity model the Teams
// stats tab uses. Returns the combined stat line, each member driver's
// contribution, and a per-season breakdown.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wanted = (searchParams.get("name") || "").trim().toLowerCase();
  if (!wanted) return NextResponse.json({ error: "name required" }, { status: 400 });

  const templatesById = await fetchTemplatesById();
  // Scope to the active league so a team name shared across leagues doesn't
  // merge their results into one profile.
  const seasonsSnap = await scopeByLeague(db().collection("seasons"), getRequestLeagueId(request)).get();
  const seasons = seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Each season scores on its SERIES' points unless it overrides them.
  const seriesById = await fetchSeriesByIds(seasons.map(s => s.series_id));

  const all = [];                 // every scored result for the team
  const drivers = {};             // driverKey -> { driver_name, user_id, results, titles }
  const perSeason = [];           // one row per season the team raced
  let displayName = null, logo_url = null, color = null, titles = 0;

  const keyFor = e => e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${String(e.name || "").trim().toLowerCase()}`;

  for (const season of seasons) {
    const [teamsSnap, entriesSnap, resultsSnap, racesSnap, seasonClasses] = await Promise.all([
      db().collection("teams").where("season_id", "==", season.id).get(),
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
      fetchSeasonClasses(season.id),
    ]);
    const matchTeams = teamsSnap.docs.filter(d => String(d.data().name || "").trim().toLowerCase() === wanted);
    if (!matchTeams.length) continue;
    const teamIds = new Set(matchTeams.map(d => d.id));
    const teamMeta = matchTeams[0].data();
    displayName = teamMeta.name || displayName;
    if (teamMeta.logo_url) logo_url = teamMeta.logo_url;
    if (teamMeta.color) color = teamMeta.color;

    const config = resolveSeasonConfig(season, seriesById[season.series_id] || null);
    const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const results = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    // Each result scores under its driver's class, so a class with its own
    // points structure carries that structure into the team totals.
    const scorer = makeScorer(results, { config, classes: seasonClasses, entriesById, templatesById });

    const seasonResults = [];
    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry || !teamIds.has(entry.team_id)) continue;
      const scored = {
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : scorer.points(r),
      };
      all.push(scored);
      seasonResults.push(scored);
      const k = keyFor(entry);
      const bucket = (drivers[k] ??= { driver_name: entry.name, user_id: entry.user_id ?? null, driver_id: entry.driver_id ?? null, results: [], titles: 0 });
      bucket.driver_name = entry.name;
      if (entry.user_id) bucket.user_id = entry.user_id;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      bucket.results.push(scored);
    }
    if (!seasonResults.length) continue;

    // Every championship won on this team that season — class champions
    // included, and no overall champion at all when the season runs
    // class-only titles. A dual crown (class + overall) is two championships.
    for (const [entryId, rec] of titlesByEntry(seasonChampions(season, results, entries, config, templatesById, seasonClasses))) {
      const champ = entriesById[entryId];
      if (!champ || !teamIds.has(champ.team_id)) continue;
      titles += rec.titles;
      const ck = keyFor(champ);
      if (drivers[ck]) drivers[ck].titles += rec.titles;
    }

    const line = aggregateCareerStats(seasonResults, 0);
    perSeason.push({ season_id: season.id, season_name: season.name, points: line.points, starts: line.starts, wins: line.wins, podiums: line.podiums, poles: line.poles });
  }

  if (displayName == null) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // A team profile spans every game the team raced in, so its members show
  // their overall display name (see lib/driverNames.js) rather than any one
  // game's on-track name.
  const names = await fetchDriverNames(Object.values(drivers).map(d => d.driver_id));

  const driverRows = Object.values(drivers)
    .map(d => ({ driver_name: (d.driver_id && names[d.driver_id]?.overall) || d.driver_name, driver_id: d.driver_id, user_id: d.user_id, ...aggregateCareerStats(d.results, d.titles) }))
    .sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "driver_name" }));

  return NextResponse.json({
    team_name: displayName,
    logo_url,
    color,
    stats: aggregateCareerStats(all, titles),
    seasons_raced: perSeason.length,
    drivers: driverRows,
    seasons: perSeason,
  });
}
