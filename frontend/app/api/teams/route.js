import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { coerceField, SPECS } from "@/lib/entityApi";
import { canUploadImages } from "@/lib/imagePermissions";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { findMapping, findTeamByName, loadTeamIndex, TEAM_SEASONS_COLLECTION } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// The GLOBAL team pool — teams are persistent entities, like drivers, and are
// pulled into a season through `team_seasons` (see lib/teams.js).
//
//   GET /api/teams                → every team in the league
//   GET /api/teams?season_id=…    → the teams fielding a lineup in that season,
//                                   each with the `driver_ids` racing for it
//
// The `season_id` form is what the roster's Team dropdown asks for, and what
// every caller written while teams were per-season documents already sends —
// so it keeps answering, now from the season's lineup rather than from a
// duplicate team doc.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const leagueId = getRequestLeagueId(request);
  const index = await loadTeamIndex({ leagueId, withDrivers: false });

  if (seasonId) {
    const teams = index.teamsInSeason(seasonId).map(t => ({
      ...t,
      season_id: seasonId,
      driver_ids: index.driverIdsFor(t.id, seasonId),
      mapping_id: index.mappingFor(t.id, seasonId)?.id ?? null,
    }));
    teams.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return NextResponse.json(teams);
  }

  // The whole pool, one row per persistent team (legacy per-season duplicates
  // collapsed into the canonical doc they belong to).
  const seen = new Set();
  const teams = [];
  for (const t of index.teamsById.values()) {
    const canonical = index.teamById(t.id);
    if (!canonical || seen.has(canonical.id)) continue;
    seen.add(canonical.id);
    const { season_id, ...team } = canonical;
    teams.push({ ...team, seasons: index.seasonsForTeam(canonical.id).length });
  }
  teams.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return NextResponse.json(teams);
}

// Create a team in the global pool. `season_id` is optional: passing one also
// enters the team in that season (creating its `team_seasons` lineup), which is
// what "＋ Add Team to Season" and the roster's inline team form do.
//
// A name that already exists in the league REUSES that team rather than minting
// a second identity for it — the same rule ensureDriverId applies to the driver
// pool, and the reason a team no longer fragments into one doc per season.
export const POST = withAdmin(async (request, ctx, user, role) => {
  const body = await request.json();
  const leagueId = getRequestLeagueId(request);

  // A team logo is an image, and images are the Owner's alone to add (see
  // lib/imagePermissions.js). Anybody else creating a team gets the team —
  // just without a logo on it.
  const mayUpload = canUploadImages(role);

  const doc = {};
  for (const [name, opts] of Object.entries(SPECS.teams.fields)) {
    if (opts.image && !mayUpload) continue;
    const value = body[name];
    if (opts.required && (value === undefined || value === null || value === "")) {
      return NextResponse.json({ error: `${name} required` }, { status: 400 });
    }
    if (value !== undefined) {
      const coerced = coerceField(opts, value);
      if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
      doc[name] = coerced.value;
    } else if (opts.default !== undefined) doc[name] = opts.default;
  }
  doc.name = String(doc.name ?? "").trim();

  let team = await findTeamByName(doc.name, leagueId);
  let created = false;
  if (team) {
    // An existing team gains anything the caller filled in that it was missing
    // (a logo added while entering it in a new season, say) — never losing what
    // it already had.
    const patch = {};
    for (const field of ["logo_url", "color"]) {
      if (doc[field] && !team[field]) patch[field] = doc[field];
    }
    if (Object.keys(patch).length) {
      await db().collection("teams").doc(team.id).update(patch);
      team = { ...team, ...patch };
    }
  } else {
    const fresh = { ...doc, created_at: new Date().toISOString(), created_by: user.uid };
    if (leagueId) fresh.league_id = leagueId;
    const ref = await db().collection("teams").add(fresh);
    team = { id: ref.id, ...fresh };
    created = true;
  }

  let mapping = null;
  if (body.season_id) {
    mapping = await findMapping(team.id, body.season_id);
    if (!mapping) {
      const fresh = {
        team_id: team.id,
        season_id: body.season_id,
        driver_ids: [],
        created_at: new Date().toISOString(),
        created_by: user.uid,
      };
      if (leagueId) fresh.league_id = leagueId;
      const ref = await db().collection(TEAM_SEASONS_COLLECTION).add(fresh);
      mapping = { id: ref.id, ...fresh };
    }
  }

  const { season_id, ...clean } = team;
  return NextResponse.json(
    { ...clean, ...(mapping ? { season_id: mapping.season_id, mapping_id: mapping.id, driver_ids: mapping.driver_ids } : {}) },
    { status: created ? 201 : 200 },
  );
});
