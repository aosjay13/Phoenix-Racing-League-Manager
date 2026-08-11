import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { loadTeamIndex } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Directory of every team in the league — the Teams page's public list, and the
// team-side mirror of the global driver pool at /api/drivers.
//
// Teams are persistent documents now (see lib/teams.js), so a row IS one team:
// its id, its branding, how many seasons it has fielded a lineup in and how
// many distinct drivers have raced for it. A league that hasn't run the
// migration still has per-season team documents; those are collapsed onto the
// canonical doc for the name, so the directory reads the same either way.
// `ids` lists every backing document for the row, which is what lets the
// directory delete a team — including a "phantom" that has no drivers and no
// results — in one action.
export async function GET(request) {
  const index = await loadTeamIndex({ leagueId: getRequestLeagueId(request), withDrivers: false });

  const rows = new Map();
  for (const doc of index.teamsById.values()) {
    const team = index.teamById(doc.id);
    if (!team) continue;
    const row = rows.get(team.id) || {
      id: team.id,
      name: team.name,
      logo_url: team.logo_url ?? null,
      color: team.color ?? null,
      created_at: team.created_at ?? null,
      ids: [],
      seasons: 0,
      drivers: 0,
    };
    row.ids.push(doc.id);
    rows.set(team.id, row);
  }

  for (const row of rows.values()) {
    const seasonIds = index.seasonsForTeam(row.id);
    row.seasons = seasonIds.length;
    const drivers = new Set();
    for (const seasonId of seasonIds) {
      for (const driverId of index.driverIdsFor(row.id, seasonId)) drivers.add(driverId);
    }
    row.drivers = drivers.size;
  }

  const teams = [...rows.values()].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return NextResponse.json(teams);
}
