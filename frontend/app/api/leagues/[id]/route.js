import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { forgetLegacyLeague, getUserRole, withUser } from "@/lib/serverAuth";

// Owner OF THE LEAGUE BEING EDITED, which is not the same as owner of the
// league the tab happens to be scoped to. Roles are per-league, so the check has
// to name the league it is about: an Owner of League A renaming League B by id
// is exactly the cross-league write this whole change exists to stop.
async function requireLeagueOwner(user, leagueId) {
  if ((await getUserRole(user, leagueId)) === "owner") return null;
  return NextResponse.json({ error: "Owner access required for this league" }, { status: 403 });
}

// Rename / re-logo / re-describe a league. Owner-of-that-league only. This is
// what the "League Settings" panel uses to give the migrated default league its
// proper name.
export const PATCH = withUser(async (request, { params }, user) => {
  const denied = await requireLeagueOwner(user, params.id);
  if (denied) return denied;

  const body = await request.json();
  const updates = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    updates.name = name;
  }
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url || null;
  if (body.description !== undefined) updates.description = body.description || null;
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  const ref = db().collection("leagues").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await ref.update(updates);
  return NextResponse.json({ id: params.id, ...doc.data(), ...updates });
});

// Remove a league doc. Owner-of-that-league only, and refuses to delete the last
// remaining league. This only deletes the league record itself — it never
// cascade-deletes the league's games/seasons/drivers/results, honoring the "zero
// data loss" guarantee; orphaned data can always be reclaimed by re-pointing its
// league_id.
//
// The `league_roles` entries naming it are left in place for the same reason:
// they are the record of who belonged to it, and they resolve to nothing while
// no such league exists. Re-creating the league under its old id would restore
// its staff along with its data.
export const DELETE = withUser(async (request, { params }, user) => {
  const denied = await requireLeagueOwner(user, params.id);
  if (denied) return denied;

  const snap = await db().collection("leagues").get();
  if (snap.size <= 1) {
    return NextResponse.json({ error: "Cannot delete the only league" }, { status: 400 });
  }
  await db().collection("leagues").doc(params.id).delete();
  // The oldest league decides where un-migrated accounts still hold their role;
  // deleting one can change which league that is.
  forgetLegacyLeague();
  return NextResponse.json({ ok: true });
});
