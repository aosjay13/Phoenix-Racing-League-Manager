import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { entryIdentityKeys, teamNameKey, TEAM_SEASONS_COLLECTION } from "@/lib/teams";
import { findMapping, loadTeamIndex, syncEntryTeams } from "@/lib/teamsServer";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { withStatsRefresh } from "@/lib/statsRefresh";

export const dynamic = "force-dynamic";

// A season's team lineups — which persistent teams are racing this season and
// who drives for each of them.
//
//   GET  /api/team-seasons?season_id=…   the season's lineups, drivers resolved
//   POST /api/team-seasons               { season_id, team_id, driver_ids? }
//
// A driver belongs to at most ONE team per season, which is what makes the
// stats cascade unambiguous: every result they score that season rolls up to
// exactly one team. Adding them to a second team moves them (see the PATCH
// route), it doesn't clone them.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const leagueId = getRequestLeagueId(request);
  const [index, seasonDoc, entriesSnap] = await Promise.all([
    loadTeamIndex({ leagueId }),
    db().collection("seasons").doc(seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
  ]);
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const season = { id: seasonDoc.id, ...seasonDoc.data() };
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const teams = index.teamsInSeason(seasonId);
  const driverIds = new Set();
  for (const team of teams) for (const id of index.driverIdsFor(team.id, seasonId)) driverIds.add(id);
  // The season belongs to one game, so a driver shows the name they race under
  // in THAT game (see lib/driverNames.js) — the same name the roster shows.
  const names = await fetchDriverNames([...driverIds], season.game_id || null);

  // A lineup names global drivers; their roster entry (if any) is what carries
  // the car number, so pair the two up for the screen — matching on driver id,
  // then linked account, then name, exactly as the stats engine does.
  const entryFor = driverId => {
    const driverKeys = new Set(index.keysForDriver(driverId));
    const name = names[driverId]?.overall;
    if (name) driverKeys.add(`n:${teamNameKey(name)}`);
    return entries.find(e => entryIdentityKeys(e).some(k => driverKeys.has(k))) ?? null;
  };

  const rows = teams.map(team => {
    const mapping = index.mappingFor(team.id, seasonId);
    const ids = index.driverIdsFor(team.id, seasonId);
    return {
      id: mapping?.id ?? null,
      team_id: team.id,
      season_id: seasonId,
      team_name: team.name,
      logo_url: team.logo_url ?? null,
      color: team.color ?? null,
      // No mapping doc means this team is only in the season through legacy
      // per-season data; the screen offers to bring it across.
      legacy: !mapping,
      driver_ids: ids,
      drivers: ids.map(id => {
        const entry = entryFor(id);
        return {
          driver_id: id,
          name: names[id]?.display || entry?.name || "Unknown driver",
          entry_id: entry?.id ?? null,
          number: entry?.number ?? null,
          // A driver on the team but not on the season's roster scores nothing
          // — worth saying so on screen rather than silently contributing 0.
          on_roster: !!entry,
        };
      }),
    };
  });
  rows.sort((a, b) => String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")));

  return NextResponse.json({ season_id: seasonId, season_name: season.name ?? null, teams: rows });
}

// Enter an existing global team in a season. Idempotent: a team already in the
// season returns the lineup it already has instead of a second one.
const handlePOST = withAdmin(async (request, ctx, user) => {
  const body = await request.json();
  const seasonId = String(body.season_id || "").trim();
  const teamId = String(body.team_id || "").trim();
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
  if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

  const [seasonDoc, teamDoc] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("teams").doc(teamId).get(),
  ]);
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  if (!teamDoc.exists) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const existing = await findMapping(teamId, seasonId);
  if (existing) return NextResponse.json(existing);

  const doc = {
    team_id: teamId,
    season_id: seasonId,
    driver_ids: Array.isArray(body.driver_ids) ? [...new Set(body.driver_ids.filter(Boolean))] : [],
    created_at: new Date().toISOString(),
    created_by: user.uid,
  };
  const leagueId = getRequestLeagueId(request);
  if (leagueId) doc.league_id = leagueId;
  const ref = await db().collection(TEAM_SEASONS_COLLECTION).add(doc);
  // Mirror the lineup onto the season's roster entries, so every reader written
  // before team_seasons existed shows the right team straight away.
  if (doc.driver_ids.length) await syncEntryTeams(seasonId, { teamId, driverIds: doc.driver_ids });
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
