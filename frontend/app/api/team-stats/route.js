import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  buildQualPosMap,
  buildQualTemplateMap,
  calculateStandings,
  configForTemplate,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";

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
  const seasonsSnap = await db().collection("seasons").get();
  const seasons = seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const all = [];                 // every scored result for the team
  const drivers = {};             // driverKey -> { driver_name, user_id, results, titles }
  const perSeason = [];           // one row per season the team raced
  let displayName = null, logo_url = null, color = null, titles = 0;

  const keyFor = e => e.driver_id ? `d:${e.driver_id}` : e.user_id ? `u:${e.user_id}` : `n:${String(e.name || "").trim().toLowerCase()}`;

  for (const season of seasons) {
    const [teamsSnap, entriesSnap, resultsSnap, racesSnap] = await Promise.all([
      db().collection("teams").where("season_id", "==", season.id).get(),
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
    ]);
    const matchTeams = teamsSnap.docs.filter(d => String(d.data().name || "").trim().toLowerCase() === wanted);
    if (!matchTeams.length) continue;
    const teamIds = new Set(matchTeams.map(d => d.id));
    const teamMeta = matchTeams[0].data();
    displayName = teamMeta.name || displayName;
    if (teamMeta.logo_url) logo_url = teamMeta.logo_url;
    if (teamMeta.color) color = teamMeta.color;

    const config = resolveSeasonConfig(season);
    const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const results = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    const qualPosMap = buildQualPosMap(results);
    const qualTemplateByRace = buildQualTemplateMap(results);

    const seasonResults = [];
    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry || !teamIds.has(entry.team_id)) continue;
      const scored = {
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : pointsFor(r, configForTemplate(config, templatesById[r.points_template_id]), qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null, configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]])),
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

    // Season champion on this team → a team (and driver) title.
    if (season.status === "completed" && results.length) {
      const standings = calculateStandings(results, entries, [], config, templatesById);
      const champ = standings.rows[0] && entriesById[standings.rows[0].entry_id];
      if (champ && teamIds.has(champ.team_id)) {
        titles += 1;
        const ck = keyFor(champ);
        if (drivers[ck]) drivers[ck].titles += 1;
      }
    }

    const line = aggregateCareerStats(seasonResults, 0);
    perSeason.push({ season_id: season.id, season_name: season.name, points: line.points, starts: line.starts, wins: line.wins, podiums: line.podiums, poles: line.poles });
  }

  if (displayName == null) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // Prefer canonical global-driver names for members spanning seasons.
  const driverIds = [...new Set(Object.values(drivers).map(d => d.driver_id).filter(Boolean))];
  const canonicalName = {};
  if (driverIds.length) {
    const docs = await Promise.all(driverIds.map(id => db().collection("drivers").doc(id).get()));
    for (const doc of docs) if (doc.exists) canonicalName[doc.id] = doc.data().name;
  }

  const driverRows = Object.values(drivers)
    .map(d => ({ driver_name: (d.driver_id && canonicalName[d.driver_id]) || d.driver_name, user_id: d.user_id, ...aggregateCareerStats(d.results, d.titles) }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || String(a.driver_name).localeCompare(String(b.driver_name)));

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
