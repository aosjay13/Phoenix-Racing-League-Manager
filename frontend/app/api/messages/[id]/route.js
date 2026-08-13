import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";
import { PLAYER } from "@/lib/messages";
import { MESSAGES, appendReply } from "@/lib/messagesServer";

export const dynamic = "force-dynamic";

// One message in the player's own inbox: mark it read, or answer it.
//
// Ownership is the whole of the check on both — the message must be addressed
// to the CALLER. An admin answering goes through /api/admin/messages/[id]
// instead; this route gives nobody power over anybody else's thread, staff
// included.

// Mark read. Only the PLAYER's stamp moves: a player reading their Dashboard
// must never clear the admin's flag, or a question would be marked answered by
// the person who asked it.
export const PATCH = withUser(async (request, { params }, user) => {
  const ref = db().collection(MESSAGES).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (doc.data().uid !== user.uid) {
    return NextResponse.json({ error: "That isn't your message." }, { status: 403 });
  }
  await ref.update({ user_seen_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, id: params.id });
});

// Reply to it. This is the player's side of the conversation — it lands in the
// admin's Approvals queue, which is where they answer from.
export const POST = withUser(async (request, { params }, user) => {
  const body = await request.json().catch(() => ({}));
  const ref = db().collection(MESSAGES).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (doc.data().uid !== user.uid) {
    return NextResponse.json({ error: "That isn't your message." }, { status: 403 });
  }

  const profile = await db().collection("users").doc(user.uid).get();
  const reply = await appendReply(ref, {
    uid: user.uid,
    name: profile.data()?.display_name || user.name || user.email || "Player",
    side: PLAYER,
    body: body.body,
  });
  if (!reply) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  return NextResponse.json({ ok: true, reply });
});
