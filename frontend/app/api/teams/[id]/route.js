import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { coerceField, SPECS } from "@/lib/entityApi";
import { docInLeague, getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { canUploadImages, imageFieldNames, stripImageFields } from "@/lib/imagePermissions";
import { teamNameKey } from "@/lib/teams";
import { clearTeamFromEntries, deleteMappingsForTeam, loadTeamIndex } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Edit a team in the global pool. A rename/re-logo lands on the persistent doc
// AND on every legacy per-season doc that still resolves to it (a league that
// hasn't run the migration), because those docs' shared NAME is what holds the
// old identity together — renaming only one would split the team in two.
export const PATCH = withAdmin(async (request, { params }, user, role, leagueId) => {
  const body = await request.json();
  const updates = {};
  for (const [name, opts] of Object.entries(SPECS.teams.fields)) {
    if (body[name] !== undefined) {
      const coerced = coerceField(opts, body[name]);
      if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
      updates[name] = coerced.value;
    }
  }
  if (updates.name !== undefined) updates.name = String(updates.name).trim();
  const ref = db().collection("teams").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Staff of this league write this league's teams. Addressed by id, so the
  // check belongs here as well as on the listing — a team from another league
  // reads as gone. (docInLeague lets a legacy, unstamped doc through.)
  if (!docInLeague(doc.data(), leagueId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A team logo is an image, and images are the Owner's to set (see
  // lib/imagePermissions.js). Re-posting the logo the edit form was showing
  // isn't a change and passes through, so renaming a team never trips over it.
  const guarded = stripImageFields(updates, {
    fields: imageFieldNames(SPECS.teams.fields),
    existing: doc.data(),
    allowed: canUploadImages(role),
  });
  Object.keys(updates).forEach(k => { if (!(k in guarded.updates)) delete updates[k]; });
  if (!Object.keys(updates).length) {
    return NextResponse.json({
      error: guarded.stripped.length ? "Only the league Owner can change images." : "No valid fields to update",
    }, { status: guarded.stripped.length ? 403 : 400 });
  }

  const index = await loadTeamIndex({ leagueId: getRequestLeagueId(request), withDrivers: false });
  const canonicalId = index.canonicalTeamId(params.id);
  const siblings = [...index.teamsById.values()]
    .filter(t => t.id !== params.id && index.canonicalTeamId(t.id) === canonicalId);

  const batch = db().batch();
  batch.update(ref, updates);
  for (const sibling of siblings) batch.update(db().collection("teams").doc(sibling.id), updates);
  await batch.commit();

  return NextResponse.json({ id: params.id, ...doc.data(), ...updates, also_updated: siblings.length });
});

// Delete a team outright: the pool doc (plus any legacy per-season doc sharing
// its identity), every season lineup it holds, and the team tag on every roster
// entry that pointed at it. Race results belong to entries, not to teams, so no
// history is lost — the drivers simply stop being credited to a team that no
// longer exists.
export const DELETE = withAdmin(async (request, { params }, user, role, leagueId) => {
  const target = await db().collection("teams").doc(params.id).get();
  if (target.exists && !docInLeague(target.data(), leagueId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const index = await loadTeamIndex({ leagueId: getRequestLeagueId(request), withDrivers: false });
  const canonicalId = index.canonicalTeamId(params.id);
  const docIds = [...index.teamsById.values()]
    .filter(t => index.canonicalTeamId(t.id) === canonicalId)
    .map(t => t.id);
  if (!docIds.includes(params.id)) docIds.push(params.id);

  let entriesCleared = 0, mappingsRemoved = 0;
  for (const id of docIds) {
    mappingsRemoved += await deleteMappingsForTeam(id);
    entriesCleared += await clearTeamFromEntries(id);
  }
  const batch = db().batch();
  for (const id of docIds) batch.delete(db().collection("teams").doc(id));
  await batch.commit();

  return NextResponse.json({ ok: true, teams_deleted: docIds.length, mappingsRemoved, entriesCleared });
});

// Everything about one team, by id: its pool record, the seasons it has
// fielded a lineup in, and who drove for it in each. This is the read the Team
// Roster screen and the team profile share.
export async function GET(request, { params }) {
  const leagueId = getRequestLeagueId(request);
  const index = await loadTeamIndex({ leagueId, withDrivers: false });
  const team = index.teamById(params.id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const seasonIds = index.seasonsForTeam(team.id);
  const seasons = await Promise.all(seasonIds.map(async id => {
    const doc = await db().collection("seasons").doc(id).get();
    return {
      season_id: id,
      season_name: doc.exists ? doc.data().name : "Unknown season",
      driver_ids: index.driverIdsFor(team.id, id),
    };
  }));
  seasons.sort((a, b) => String(a.season_name).localeCompare(String(b.season_name)));

  const { season_id, ...clean } = team;
  return NextResponse.json({ ...clean, name_key: teamNameKey(team.name), seasons });
}
