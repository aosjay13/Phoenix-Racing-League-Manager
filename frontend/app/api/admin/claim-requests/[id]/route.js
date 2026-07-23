import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

// Admin-only: resolve a pending driver-profile claim request.
//
//   body.action = "approve" → writes drivers.user_id = request.uid (the ONLY
//                             place a user-requested link is ever applied), then
//                             auto-denies any sibling requests for that driver.
//   body.action = "deny"    → just marks the request denied.
//
// The user↔driver link lives on the driver doc (drivers.user_id), matching the
// admin dashboard, roster, career stats, and public profiles. Only one driver
// may be linked to a user, so approving detaches any driver the user held before.
export const PATCH = withAdmin(async (request, { params }, admin) => {
  const { id } = params;
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  const reqRef = db().collection("claim_requests").doc(id);
  const reqDoc = await reqRef.get();
  if (!reqDoc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const req = reqDoc.data();
  if (req.status !== "pending") {
    return NextResponse.json({ error: "This request has already been resolved." }, { status: 400 });
  }

  const stamp = { resolved_at: new Date().toISOString(), resolved_by: admin.uid };

  if (action === "deny") {
    await reqRef.update({ status: "denied", ...stamp });
    return NextResponse.json({ ok: true, id, status: "denied" });
  }

  if (action !== "approve") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const targetRef = db().collection("drivers").doc(req.driver_id);
  const targetDoc = await targetRef.get();
  if (!targetDoc.exists) {
    return NextResponse.json({ error: "The requested driver profile no longer exists." }, { status: 404 });
  }

  const batch = db().batch();

  // Detach whichever driver currently holds this user's link (one link per user).
  const existing = await db().collection("drivers").where("user_id", "==", req.uid).get();
  existing.docs.forEach(d => { if (d.id !== req.driver_id) batch.update(d.ref, { user_id: null }); });

  // Apply the requested link.
  batch.update(targetRef, { user_id: req.uid });

  // Resolve this request, and auto-deny any other pending requests for the same
  // driver (it can only belong to one account).
  const siblings = await db().collection("claim_requests")
    .where("driver_id", "==", req.driver_id)
    .where("status", "==", "pending").get();
  siblings.docs.forEach(s => {
    if (s.id === id) batch.update(s.ref, { status: "approved", ...stamp });
    else batch.update(s.ref, { status: "denied", ...stamp, note: "Auto-denied: profile claimed by another account." });
  });

  await batch.commit();
  return NextResponse.json({ ok: true, id, status: "approved", driver_id: req.driver_id, uid: req.uid });
});
