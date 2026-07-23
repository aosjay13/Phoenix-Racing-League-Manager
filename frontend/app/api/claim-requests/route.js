import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// A signed-in user asks admins to link a statistical driver profile to their
// account. NOTHING is linked here — the request lands in `claim_requests` with
// status "pending", and only an admin approval (see /api/admin/claim-requests)
// actually writes the drivers.user_id link. This enforces the "must be approved
// by an admin" rule.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const driverId = body.driver_id;
  if (!driverId) return NextResponse.json({ error: "Missing driver_id" }, { status: 400 });

  const driverRef = db().collection("drivers").doc(driverId);
  const driverDoc = await driverRef.get();
  if (!driverDoc.exists) return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
  const driver = driverDoc.data();

  if (driver.user_id === user.uid) {
    return NextResponse.json({ error: "This profile is already linked to your account." }, { status: 400 });
  }
  if (driver.user_id) {
    return NextResponse.json({ error: "This profile is already claimed by another account." }, { status: 400 });
  }

  // One open request per user + driver.
  const dup = await db().collection("claim_requests")
    .where("uid", "==", user.uid)
    .where("driver_id", "==", driverId)
    .where("status", "==", "pending")
    .limit(1).get();
  if (!dup.empty) {
    return NextResponse.json({ error: "You already have a pending request for this profile." }, { status: 409 });
  }

  const userDoc = await db().collection("users").doc(user.uid).get();
  const u = userDoc.exists ? userDoc.data() : {};

  const doc = {
    uid: user.uid,
    user_name: u.display_name || user.name || user.email || "Unknown",
    user_email: u.email || user.email || null,
    user_photo: u.photo_url || null,
    driver_id: driverId,
    driver_name: driver.name || "Driver",
    status: "pending",
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
  };
  const ref = await db().collection("claim_requests").add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
});

// The caller's own claim requests — lets the driver profile page reflect a
// "request pending" state so a user doesn't spam duplicate requests.
export const GET = withUser(async (request, ctx, user) => {
  const snap = await db().collection("claim_requests").where("uid", "==", user.uid).get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return NextResponse.json(rows);
});
