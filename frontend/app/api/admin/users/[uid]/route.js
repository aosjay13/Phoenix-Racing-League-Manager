import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { withAdmin, getUserRole, isEnvAdmin } from "@/lib/serverAuth";
import { normalizeRole, roleLevel, canManage, ROLE_LABELS } from "@/lib/roles";
import { syncEntryNamesForDriver } from "@/lib/driverSync";

// Admin-only: set a user's role within the staff hierarchy and/or (re)link their
// statistical driver profile. Both changes flow through withAdmin, so the actor
// is a verified staff member before anything is written.
//
//   body.role      → "owner" | "admin" | "moderator" | "statistician" | "player"
//   body.driver_id → driver doc id, or "" / null to unlink
//
// Role changes are governed by the hierarchy (see lib/roles): the actor may only
// edit accounts at or below their own level, and may only assign roles at or
// below their own level. These checks run server-side and never trust the UI.
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

  // --- Display name change ---------------------------------------------
  // For a driver linked to an account, the account's display_name is the name
  // shown everywhere (the pool-driver name is only a fallback), so this is how
  // an admin corrects a linked driver's name. The change cascades onto that
  // driver's roster entries so results, standings, and the race-entry pickers
  // all follow — only the denormalized name string is touched (zero data loss).
  if (body.display_name !== undefined) {
    const dn = String(body.display_name).trim();
    if (!dn) return NextResponse.json({ error: "Display name can't be empty." }, { status: 400 });
    const actorRole = await getUserRole(admin);
    const targetRole = isEnvAdmin(userDoc.data().email) ? "owner" : normalizeRole(userDoc.data().role || "player");
    // Same hierarchy guard as role edits, except you may always rename yourself.
    if (uid !== admin.uid && !canManage(actorRole, targetRole)) {
      return NextResponse.json({ error: `You can't edit a ${ROLE_LABELS[targetRole]} — they rank at or above your role.` }, { status: 403 });
    }
    await userRef.update({ display_name: dn });
    changed.display_name = dn;
    const linked = await db().collection("drivers").where("user_id", "==", uid).limit(1).get();
    if (!linked.empty) {
      try { await syncEntryNamesForDriver(linked.docs[0].id); } catch (err) { console.error("display_name cascade failed", err); }
    }
  }

  // --- Role change ------------------------------------------------------
  if (body.role !== undefined) {
    const newRole = normalizeRole(body.role);
    const actorRole = await getUserRole(admin);
    const targetEnvAdmin = isEnvAdmin(userDoc.data().email);
    const targetRole = targetEnvAdmin ? "owner" : normalizeRole(userDoc.data().role || "player");

    // Guard against self-lockout: nobody can change their own role.
    if (uid === admin.uid) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }
    // Env-var owners are permanent; the DB role can't override ADMIN_EMAILS.
    if (targetEnvAdmin) {
      return NextResponse.json({ error: "This account is a permanent Owner (set via ADMIN_EMAILS) and can't be changed." }, { status: 400 });
    }
    // Hierarchy: can't touch an account at or above your own level.
    if (!canManage(actorRole, targetRole)) {
      return NextResponse.json({ error: `You can't modify a ${ROLE_LABELS[targetRole]} — they rank at or above your role.` }, { status: 403 });
    }
    // Hierarchy: can't hand out a role higher than your own.
    if (roleLevel(newRole) > roleLevel(actorRole)) {
      return NextResponse.json({ error: `You can't assign the ${ROLE_LABELS[newRole]} role — it's above your own.` }, { status: 403 });
    }
    await userRef.update({ role: newRole });
    changed.role = newRole;
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

  // Guard against self-deletion (lockout) and permanent env-var owners.
  if (uid === admin.uid) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  const userRef = db().collection("users").doc(uid);
  const userDoc = await userRef.get();
  const email = userDoc.exists ? userDoc.data().email : null;
  if (isEnvAdmin(email)) {
    return NextResponse.json({ error: "This account is a permanent Owner (set via ADMIN_EMAILS) and can't be deleted." }, { status: 400 });
  }
  // Hierarchy: you can only delete accounts at or below your own level.
  const actorRole = await getUserRole(admin);
  const targetRole = userDoc.exists ? normalizeRole(userDoc.data().role || "player") : "player";
  if (!canManage(actorRole, targetRole)) {
    return NextResponse.json({ error: `You can't delete a ${ROLE_LABELS[targetRole]} — they rank at or above your role.` }, { status: 403 });
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
