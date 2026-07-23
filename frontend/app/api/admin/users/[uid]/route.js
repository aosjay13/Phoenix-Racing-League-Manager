import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { withAdmin, isEnvAdmin } from "@/lib/serverAuth";

// Admin-only: grant/revoke a user's admin role and/or (re)link their statistical
// driver profile. Both changes flow through withAdmin, so an authenticated admin
// is verified before anything is written.
//
//   body.role      → "admin" | "player"  (updates users/<uid>.role)
//   body.driver_id → driver doc id, or "" / null to unlink
//
// The user↔driver link is stored on the driver document (drivers.user_id),
// matching the rest of the app (career stats, roster, public profiles). Only one
// driver may be linked to a user at a time, so setting a new link clears any
// previous one — this also lets an admin override a user's own wrong choice.
export const PATCH = withAdmin(async (request, { params }, admin) => {
  const { uid } = params;
  const body = await request.json().catch(() => ({}));

  const userRef = db().collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const changed = {};

  // --- Role change ------------------------------------------------------
  if (body.role !== undefined) {
    const role = body.role === "admin" ? "admin" : "player";
    // Guard against self-lockout: an admin can't strip their own access.
    if (uid === admin.uid && role !== "admin") {
      return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
    }
    // Env-var admins are permanent; the DB role can't override ADMIN_EMAILS.
    if (isEnvAdmin(userDoc.data().email) && role !== "admin") {
      return NextResponse.json({ error: "This account is a permanent admin (set via ADMIN_EMAILS)." }, { status: 400 });
    }
    await userRef.update({ role });
    changed.role = role;
  }

  // --- Driver profile link change --------------------------------------
  if (body.driver_id !== undefined) {
    const targetId = body.driver_id || null;
    const batch = db().batch();

    // Detach this user from whichever driver currently holds the link.
    const existing = await db().collection("drivers").where("user_id", "==", uid).get();
    existing.docs.forEach(d => { if (d.id !== targetId) batch.update(d.ref, { user_id: null }); });

    if (targetId) {
      const targetRef = db().collection("drivers").doc(targetId);
      const targetDoc = await targetRef.get();
      if (!targetDoc.exists) return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
      // Overrides any other user that was linked to this driver.
      batch.update(targetRef, { user_id: uid });
    }

    await batch.commit();
    changed.driver_id = targetId;
  }

  if (!Object.keys(changed).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, uid, ...changed });
});

// Admin-only: permanently delete a user account. Their linked driver profile is
// returned to the unclaimed pool (race results stay on record), their pending
// claim requests are dropped, the account doc is removed, and the Firebase Auth
// user is deleted so they can't sign back in and re-create the doc.
export const DELETE = withAdmin(async (request, { params }, admin) => {
  const { uid } = params;

  // Guard against self-deletion (lockout) and permanent env-var admins.
  if (uid === admin.uid) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  const userRef = db().collection("users").doc(uid);
  const userDoc = await userRef.get();
  const email = userDoc.exists ? userDoc.data().email : null;
  if (isEnvAdmin(email)) {
    return NextResponse.json({ error: "This account is a permanent admin (set via ADMIN_EMAILS) and can't be deleted." }, { status: 400 });
  }

  const batch = db().batch();

  // Return any linked driver to the unclaimed pool.
  const linked = await db().collection("drivers").where("user_id", "==", uid).get();
  linked.docs.forEach(d => batch.update(d.ref, { user_id: null }));

  // Drop this user's claim requests.
  const reqs = await db().collection("claim_requests").where("uid", "==", uid).get();
  reqs.docs.forEach(r => batch.delete(r.ref));

  if (userDoc.exists) batch.delete(userRef);
  await batch.commit();

  // Delete the Firebase Auth identity (best-effort — it may already be gone).
  try { await adminAuth().deleteUser(uid); } catch { /* not found / already removed */ }

  return NextResponse.json({ ok: true, uid });
});
