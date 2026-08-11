import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { TEAM_SEASONS_COLLECTION } from "@/lib/teams";
import { clearTeamFromEntries, fetchSeasonMappings, syncEntryTeams } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Edit one team's lineup for one season: PATCH { driver_ids: [driver_uid, …] }.
//
// Two things happen alongside the write, and both are what make the stats
// cascade trustworthy:
//
//   1. A driver races for ONE team per season. Anyone added here is removed
//      from the other lineups in the same season, so their results can never
//      be counted for two teams at once.
//   2. `entries.team_id` is mirrored from the lineup (see lib/teamsServer.js),
//      so the results grid, the event page and every export keep showing the
//      team without knowing this collection exists.
export const PATCH = withAdmin(async (request, { params }) => {
  const body = await request.json();
  if (!Array.isArray(body.driver_ids)) {
    return NextResponse.json({ error: "driver_ids must be an array" }, { status: 400 });
  }
  const driverIds = [...new Set(body.driver_ids.map(id => String(id || "").trim()).filter(Boolean))];

  const ref = db().collection(TEAM_SEASONS_COLLECTION).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mapping = { id: doc.id, ...doc.data() };

  const previous = mapping.driver_ids || [];
  const removed = previous.filter(id => !driverIds.includes(id));

  // (1) Take the added drivers off every other team in this season.
  const moved = [];
  const siblings = (await fetchSeasonMappings(mapping.season_id)).filter(m => m.id !== mapping.id);
  for (const sibling of siblings) {
    const keep = (sibling.driver_ids || []).filter(id => !driverIds.includes(id));
    if (keep.length !== (sibling.driver_ids || []).length) {
      await db().collection(TEAM_SEASONS_COLLECTION).doc(sibling.id).update({ driver_ids: keep });
      moved.push(sibling.id);
    }
  }

  await ref.update({ driver_ids: driverIds });
  // (2) Mirror onto the roster entries.
  const entriesSynced = await syncEntryTeams(mapping.season_id, {
    teamId: mapping.team_id,
    driverIds,
    removedDriverIds: removed,
  });

  return NextResponse.json({ ...mapping, driver_ids: driverIds, entries_synced: entriesSynced, moved_from: moved });
});

// Remove a team from ONE season. The team itself, its other seasons and every
// race result stay exactly as they are — this only ends the team's entry in
// this season, and clears the team tag off that season's roster entries.
export const DELETE = withAdmin(async (request, { params }) => {
  const ref = db().collection(TEAM_SEASONS_COLLECTION).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mapping = doc.data();

  const entriesCleared = await clearTeamFromEntries(mapping.team_id, { seasonId: mapping.season_id });
  await ref.delete();
  return NextResponse.json({ ok: true, entries_cleared: entriesCleared });
});
