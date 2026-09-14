import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";
import { JOIN_COLLECTION, JOIN_PENDING } from "@/lib/leagueJoin";

export const dynamic = "force-dynamic";

// Withdraw a request you haven't had an answer to yet.
//
// Only ever your own, and only while it is still pending: a decision somebody
// has already made is a record, and deleting it would take the denial reason
// away from the one person entitled to read it.
export const DELETE = withUser(async (request, ctx, user) => {
  const { id } = ctx.params;
  const ref = db().collection(JOIN_COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const data = doc.data();
  if (data.uid !== user.uid) {
    return NextResponse.json({ error: "That isn't your request." }, { status: 403 });
  }
  if ((data.status || JOIN_PENDING) !== JOIN_PENDING) {
    return NextResponse.json(
      { error: "That request has already been decided." }, { status: 409 });
  }
  await ref.delete();
  return NextResponse.json({ ok: true, id });
});
