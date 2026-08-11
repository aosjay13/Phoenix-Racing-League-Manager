import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";
import { getRequestUser } from "@/lib/serverAuth";
import { syncLineupFromEntry } from "@/lib/teamsServer";

const routes = makeCollectionRoutes(SPECS.entries);
export const GET = routes.GET;

// Adding a driver to a season's roster WITH a team is the same statement as
// putting them on that team's line-up for the season, so the line-up is kept in
// step (see lib/teamsServer.js) — otherwise the team tables would show the
// driver only through the entry's tag, and the Team Roster screen would show
// the team as empty. Never fails the create over it: the entry's own tag still
// resolves them.
export async function POST(request, ctx) {
  const response = await routes.POST(request, ctx);
  if (response.status !== 201) return response;
  try {
    const created = await response.clone().json();
    if (created.team_id && created.driver_id) {
      const user = await getRequestUser(request);
      await syncLineupFromEntry({
        seasonId: created.season_id,
        driverId: created.driver_id,
        teamId: created.team_id,
        userId: user?.uid ?? null,
      });
    }
  } catch (err) {
    console.error("Team line-up sync failed", err);
  }
  return response;
}
