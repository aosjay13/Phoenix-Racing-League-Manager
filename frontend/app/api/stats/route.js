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

// Aggregated driver stats across seasons — the app version of the
// spreadsheet's "Overall Stats" sheets.
//   scope=league                → every season
//   scope=game&game_id=…        → all seasons in a game
//   scope=series&series_id=…    → all seasons in a series
//   scope=season&season_id=…    → one season
// Drivers are unified across seasons by linked account (user_id) when
// present, otherwise by roster name.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  let seasonsQuery = db().collection("seasons");
  if (scope === "game") {
    const gameId = searchParams.get("game_id");
    if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("game_id", "==", gameId);
  } else if (scope === "series") {
    const seriesId = searchParams.get("series_id");
    if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("series_id", "==", seriesId);
  } else if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(seasonId).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    return NextResponse.json(await buildStats([{ id: doc.id, ...doc.data() }]));
  } else if (scope !== "league") {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }

  const snap = await seasonsQuery.get();
  const seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return NextResponse.json(await buildStats(seasons));
}

async function buildStats(seasons) {
  // driverKey -> { name, number, user_id, results[], titles }
  const drivers = {};
  // teamKey (lowercased name) -> aggregated team bucket. Teams are per-season
  // docs with no global id, so cross-season identity keys on the team name —
  // mirroring how drivers fall back to name when they have no driver_id.
  const teams = {};
  const templatesById = await fetchTemplatesById();

  for (const season of seasons) {
    const config = resolveSeasonConfig(season);
    const [entriesSnap, resultsSnap, racesSnap, teamsSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
      db().collection("teams").where("season_id", "==", season.id).get(),
    ]);
    const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const teamsById = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data()]));
    const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
    const results = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    const qualPosMap = buildQualPosMap(results);
    const qualTemplateByRace = buildQualTemplateMap(results);

    // Prefer the global driver identity (driver_id) so a driver who races
    // under a different alias/number in each series still aggregates as one
    // person; fall back to linked account or name for older entries written
    // before driver_id existed.
    const keyFor = entry =>
      entry.driver_id ? `d:${entry.driver_id}` : entry.user_id ? `u:${entry.user_id}` : `n:${String(entry.name || "").trim().toLowerCase()}`;

    const teamKeyFor = entry => {
      const t = entry.team_id ? teamsById[entry.team_id] : null;
      const name = (t?.name ?? entry.team ?? "").trim();
      return name ? `t:${name.toLowerCase()}` : null;
    };

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const key = keyFor(entry);
      const bucket = (drivers[key] ??= {
        driver_name: entry.name,
        driver_number: entry.number ?? null,
        driver_id: entry.driver_id ?? null,
        user_id: entry.user_id ?? null,
        results: [],
        titles: 0,
      });
      // Prefer the most recent identity details we see.
      bucket.driver_name = entry.name;
      if (entry.number != null) bucket.driver_number = entry.number;
      if (entry.user_id) bucket.user_id = entry.user_id;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      const scored = {
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : pointsFor(r, configForTemplate(config, templatesById[r.points_template_id]), qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null, configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]])),
      };
      bucket.results.push(scored);

      // Mirror the same scored result into its team bucket. A team's stats are
      // the combined results of every driver who raced for it in scope.
      const tk = teamKeyFor(entry);
      if (tk) {
        const t = entry.team_id ? teamsById[entry.team_id] : null;
        const tb = (teams[tk] ??= { team_name: t?.name ?? entry.team, logo_url: t?.logo_url ?? null, color: t?.color ?? null, results: [], driverKeys: new Set(), titles: 0 });
        if (t?.name) tb.team_name = t.name;
        if (t?.logo_url) tb.logo_url = t.logo_url;
        if (t?.color) tb.color = t.color;
        tb.results.push(scored);
        tb.driverKeys.add(key);
      }
    }

    // Titles: champion of each completed season — credited to the driver and,
    // if they were on a team that season, to that team.
    if (season.status === "completed" && results.length) {
      const standings = calculateStandings(results, entries, [], config, templatesById);
      const winner = standings.rows[0] && entriesById[standings.rows[0].entry_id];
      if (winner) {
        const key = keyFor(winner);
        if (drivers[key]) drivers[key].titles += 1;
        const tk = teamKeyFor(winner);
        if (tk && teams[tk]) teams[tk].titles += 1;
      }
    }
  }

  // A driver can run a different alias per series; when aggregating across
  // more than one season, show their canonical global-driver name instead of
  // whichever alias happened to be seen last.
  const driverIds = [...new Set(Object.values(drivers).map(d => d.driver_id).filter(Boolean))];
  const canonicalName = {};
  if (driverIds.length) {
    const docs = await Promise.all(driverIds.map(id => db().collection("drivers").doc(id).get()));
    for (const doc of docs) if (doc.exists) canonicalName[doc.id] = doc.data().name;
  }

  const rows = Object.values(drivers).map(d => ({
    driver_name: (d.driver_id && canonicalName[d.driver_id]) || d.driver_name,
    driver_number: d.driver_number,
    user_id: d.user_id,
    ...aggregateCareerStats(d.results, d.titles),
  }));

  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.driver_name.localeCompare(b.driver_name));

  const team_rows = Object.values(teams).map(t => ({
    team_name: t.team_name,
    logo_url: t.logo_url,
    color: t.color,
    drivers: t.driverKeys.size,
    ...aggregateCareerStats(t.results, t.titles),
  }));
  team_rows.sort((a, b) => b.points - a.points || b.wins - a.wins || String(a.team_name).localeCompare(String(b.team_name)));

  return {
    seasons_counted: seasons.length,
    rows,
    team_rows,
  };
}
