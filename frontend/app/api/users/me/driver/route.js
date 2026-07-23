import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";

// A user unclaims (unlinks) whichever driver profile is linked to their own
// account, returning it to the unclaimed pool. Their past race results stay on
// record — only the account↔driver link (drivers.user_id) is cleared.
export const DELETE = withUser(async (request, ctx, user) => {
  const snap = await db().collection("drivers").where("user_id", "==", user.uid).get();
  if (snap.empty) {
    return NextResponse.json({ error: "No driver profile is linked to your account." }, { status: 400 });
  }
  const batch = db().batch();
  snap.docs.forEach(d => batch.update(d.ref, { user_id: null }));
  await batch.commit();
  return NextResponse.json({ ok: true, unlinked: snap.docs.map(d => d.id) });
});
