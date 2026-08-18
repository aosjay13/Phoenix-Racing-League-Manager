import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withAdmin } from "@/lib/serverAuth";
import { ADMIN } from "@/lib/messages";
import { MESSAGES, appendReply } from "@/lib/messagesServer";

export const dynamic = "force-dynamic";

// The admin's side of one thread: answer a player, or mark their reply read.
//
// Any staff member may answer any message in their league — the board is the
// league talking to its drivers, not one admin's private correspondence, and a
// question shouldn't wait because the admin who made the decision is away.

export const POST = withAdmin(async (request, { params }, admin, role, leagueId) => {
  const body = await request.json().catch(() => ({}));
  const ref = db().collection(MESSAGES).doc(params.id);
  const doc = await ref.get();
  // The board is one league talking to its drivers, so a message id from
  // another league is not this admin's to answer or to mark read.
  if (!doc.exists || !docInLeague(doc.data(), leagueId)) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const profile = await db().collection("users").doc(admin.uid).get();
  const reply = await appendReply(ref, {
    uid: admin.uid,
    name: profile.data()?.display_name || admin.name || "League admin",
    side: ADMIN,
    body: body.body,
  });
  if (!reply) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  return NextResponse.json({ ok: true, reply });
});

// Mark the player's reply read WITHOUT answering — "seen, nothing to say".
// Only the admin's stamp moves.
export const PATCH = withAdmin(async (request, { params }, admin, role, leagueId) => {
  const ref = db().collection(MESSAGES).doc(params.id);
  const doc = await ref.get();
  // The board is one league talking to its drivers, so a message id from
  // another league is not this admin's to answer or to mark read.
  if (!doc.exists || !docInLeague(doc.data(), leagueId)) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  await ref.update({ admin_seen_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, id: params.id });
});
