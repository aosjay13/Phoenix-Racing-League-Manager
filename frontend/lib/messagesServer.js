import { db } from "@/lib/firebase";
import { ADMIN, MESSAGE_KINDS, PLAYER, messageBody, messageTitle } from "@/lib/messages";
import { queueEmail } from "@/lib/mailer";

// Writing to the league's message board. One place, so every admin action that
// affects a player says so the same way and nothing is left silent.
//
// Posting NEVER throws into the caller. An admin approving a sign-up has made a
// decision and that decision is already recorded; failing to announce it must
// not undo it. A message that didn't get written is a gap in the conversation,
// not a corrupted roster.

export const MESSAGES = "messages";

// Post one message to a player.
//
// `context` carries the names as they were at the time — a series renamed later
// shouldn't rewrite what somebody was told. `admin_note` is the admin's own
// words attached to the decision (a deny reason, why they were taken off a
// roster), which the card leads with.
export async function postMessage({
  uid, leagueId = null, kind, context = {}, adminNote = "", admin = null, email = null,
}) {
  if (!uid || !MESSAGE_KINDS[kind]) return null;
  const now = new Date().toISOString();
  const doc = {
    uid,
    kind,
    context,
    admin_note: String(adminNote ?? "").trim().slice(0, 1000) || null,
    replies: [],
    created_at: now,
    created_by: admin?.uid || null,
    created_by_name: admin?.name || null,
    // Read stamps, one per side. The admin's starts stamped: they wrote it.
    user_seen_at: null,
    admin_seen_at: now,
    ...(leagueId ? { league_id: leagueId } : {}),
  };
  try {
    const ref = await db().collection(MESSAGES).add(doc);

    // The same message by email, when there's an address and a mail worker to
    // send it (see lib/mailer.js — without the extension installed these queue
    // harmlessly). The board is the source of truth either way.
    if (email) {
      const msg = { kind, context, admin_note: doc.admin_note };
      const note = doc.admin_note ? `\n\nFrom the admins: ${doc.admin_note}` : "";
      await queueEmail({
        to: email,
        subject: messageTitle(msg),
        text: `${messageBody(msg)}${note}\n\nReply on your Dashboard.`,
        kind: `message:${kind}`,
        meta: { uid, message_id: ref.id },
      });
    }
    return ref.id;
  } catch (err) {
    console.error("Posting a league message failed", err);
    return null;
  }
}

// Append a reply. `side` decides whose unread flag it trips: a player's reply
// is news for the admin, an admin's is news for the player — and writing one
// marks the thread read for its own author, since you've plainly seen what
// you're answering.
export async function appendReply(ref, { uid, name, side, body }) {
  const text = String(body ?? "").trim().slice(0, 2000);
  if (!text) return null;
  const now = new Date().toISOString();
  const reply = {
    id: `${now}-${uid}`.slice(0, 60),
    uid,
    name: String(name ?? "").trim().slice(0, 60) || "Someone",
    side: side === ADMIN ? ADMIN : PLAYER,
    body: text,
    at: now,
  };
  const snap = await ref.get();
  const existing = Array.isArray(snap.data()?.replies) ? snap.data().replies : [];
  await ref.update({
    replies: [...existing, reply],
    ...(reply.side === PLAYER ? { user_seen_at: now } : { admin_seen_at: now }),
  });
  return reply;
}

// Every message addressed to one player. Capped — this is an inbox, not an
// archive, and the whole history stays in the collection.
export async function messagesForUser(uid, limit = 50) {
  if (!uid) return [];
  const snap = await db().collection(MESSAGES).where("uid", "==", uid).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, limit);
}

// Every message in a league, for the admin side. Scoped by league so one
// league's staff never see another's conversations.
//
// Each row is stamped with WHO it's addressed to. The document only holds a
// uid, and a queue that says "somebody is waiting on a reply" without naming
// them is a queue nobody can work — so the accounts are read once, here, rather
// than by the screen row by row.
export async function messagesForLeague(leagueId, limit = 200) {
  let query = db().collection(MESSAGES);
  if (leagueId) query = query.where("league_id", "==", leagueId);
  const snap = await query.get();
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, limit);

  const names = await namesForUsers([...new Set(rows.map(r => r.uid).filter(Boolean))]);
  return rows.map(r => ({ ...r, user_name: names[r.uid] || "A player" }));
}

// Display names for a set of accounts, as one lookup. Missing accounts simply
// don't appear — the caller falls back rather than failing.
async function namesForUsers(uids) {
  if (!uids.length) return {};
  const docs = await Promise.all(
    uids.map(uid => db().collection("users").doc(uid).get().catch(() => null)));
  const out = {};
  docs.forEach((doc, i) => {
    const data = doc?.exists ? doc.data() : null;
    if (data) out[uids[i]] = data.display_name || data.email || "";
  });
  return out;
}

// The player's email, for the nudge. Read from their account rather than taken
// from the caller, so a message can't be aimed at an address by whoever
// triggered it.
export async function emailForUser(uid) {
  if (!uid) return null;
  try {
    const doc = await db().collection("users").doc(uid).get();
    return doc.exists ? (doc.data().email || null) : null;
  } catch {
    return null;
  }
}
