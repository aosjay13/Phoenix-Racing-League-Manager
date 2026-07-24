import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withOwner } from "@/lib/serverAuth";

// Rename / re-logo / re-describe a league. Owner-only. This is what the
// "League Settings" panel uses to give the migrated default league its proper
// name.
export const PATCH = withOwner(async (request, { params }) => {
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

// Remove a league doc. Owner-only, and refuses to delete the last remaining
// league. This only deletes the league record itself — it never cascade-deletes
// the league's games/seasons/drivers/results, honoring the "zero data loss"
// guarantee; orphaned data can always be reclaimed by re-pointing its league_id.
export const DELETE = withOwner(async (request, { params }) => {
  const snap = await db().collection("leagues").get();
  if (snap.size <= 1) {
    return NextResponse.json({ error: "Cannot delete the only league" }, { status: 400 });
  }
  await db().collection("leagues").doc(params.id).delete();
  return NextResponse.json({ ok: true });
});
