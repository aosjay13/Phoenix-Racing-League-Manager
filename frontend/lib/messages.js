// The league's message board: everything an admin does TO a player, said to
// that player, with a thread they can answer in.
//
// Two inboxes, one collection:
//
//   • the PLAYER'S is their Dashboard. Every admin decision about them lands
//     there — a sign-up approved or denied, a car number granted or refused,
//     a driver profile claimed, a removal from a season's roster.
//   • the ADMIN'S is Approvals. Requests arrive there as they always did, and
//     now so do the players' replies, so a question asked in answer to a
//     decision reaches somebody rather than sitting unread on a Dashboard.
//
// Before this, an admin's decision was a state change on a document and
// nothing else: the queue emptied and the player was left to infer what had
// happened from a roster they might not think to look at. Being *removed* from
// a season was the worst of them — entirely silent, and the one most likely to
// be read as the app losing their entry.
//
// Everything here is pure: the same rendering runs on the Dashboard, in the
// admin's list and in the tests, so the two sides can't describe the same
// decision differently.

// ── The kinds of thing an admin does ───────────────────────────────────────
//
// `tone` decides how the card is drawn — "good" for something granted, "bad"
// for something refused or taken away, "info" for the rest. Colour is never
// the only signal: every card says what happened in words too.
export const MESSAGE_KINDS = {
  signup_approved: {
    tone: "good",
    // The one that gets the full welcome treatment — schedule, calendar,
    // Discord — because it's somebody's first minute in the league.
    actions: ["schedule", "calendar", "discord"],
    title: c => `Welcome to ${c.series_name || "the league"}!`,
    body: c => `You're on the roster for ${c.season_name || "the season"}`
      + (detailOf(c) ? ` — ${detailOf(c)}` : "") + ".",
  },
  signup_denied: {
    tone: "bad",
    actions: ["signups"],
    title: c => `Your sign-up for ${label(c)} wasn't approved`,
    body: () => "You can sign up again once whatever's below is sorted — your details are already"
      + " saved, so it's a much shorter form the second time.",
  },
  number_approved: {
    tone: "good",
    actions: ["myseries"],
    title: c => (c.number
      ? `You've got #${c.number} in ${label(c)}`
      : `Your car number change in ${label(c)} went through`),
    body: c => (c.previous_number && c.number
      ? `Your number has changed from #${c.previous_number} to #${c.number}.`
      : c.number ? `Your car number is now #${c.number}.`
      : "An admin has updated your car number."),
  },
  number_denied: {
    tone: "bad",
    actions: ["myseries"],
    title: c => (c.number
      ? `Your request for #${c.number} in ${label(c)} wasn't granted`
      : `Your car number change in ${label(c)} wasn't granted`),
    body: c => (c.previous_number
      ? `You're still running #${c.previous_number}. You can ask for a different one any time.`
      : "You can ask for a different number any time."),
  },
  // Explicitly requested, and the one that was most alarming when silent.
  roster_removed: {
    tone: "bad",
    actions: ["signups"],
    title: c => `You've been taken off the roster for ${label(c)}`,
    body: () => "You're no longer entered in this season. If you think that's a mistake, reply"
      + " here — an admin will see it.",
  },
  claim_approved: {
    tone: "good",
    actions: ["profile"],
    title: c => `Your account is now linked to ${c.driver_name || "your driver profile"}`,
    body: () => "Your race history and stats are attached to your account from here on.",
  },
  claim_denied: {
    tone: "bad",
    actions: ["signups"],
    title: c => `Your request to race as ${c.driver_name || "that driver"} wasn't approved`,
    body: () => "Nothing has changed on your account. Reply here if you're not sure why.",
  },
  // An admin writing to a player for no other reason. The board is worth having
  // as a way to simply say something.
  note: {
    tone: "info",
    actions: [],
    title: c => c.subject || "A message from the league admins",
    body: () => "",
  },
};

function label(c = {}) {
  return [c.series_name, c.season_name].filter(Boolean).join(" · ") || "that season";
}

// "#42 · Ferrari 296 GT3" — only the parts that season actually uses.
function detailOf(c = {}) {
  return [c.number ? `#${c.number}` : "", c.car].filter(Boolean).join(" · ");
}

export function messageKind(msg) {
  return MESSAGE_KINDS[msg?.kind] ? msg.kind : "note";
}

export function messageSpec(msg) {
  return MESSAGE_KINDS[messageKind(msg)];
}

export function messageTitle(msg) {
  return messageSpec(msg).title(msg?.context || {});
}

export function messageBody(msg) {
  return messageSpec(msg).body(msg?.context || {});
}

export function messageTone(msg) {
  return messageSpec(msg).tone;
}

export function messageActions(msg) {
  return messageSpec(msg).actions;
}

// The admin's own words attached to the decision — a deny reason, a note on why
// somebody came off a roster. Distinct from the replies: this one was written
// as part of the decision itself, so it leads.
export function adminNote(msg) {
  const note = String(msg?.admin_note ?? "").trim();
  return note || null;
}

// ── The thread ─────────────────────────────────────────────────────────────

export const PLAYER = "player";
export const ADMIN = "admin";

// One reply, normalised. `side` is who wrote it, which is what decides where it
// counts as unread: a player's reply is news for the admin and vice versa.
export function normalizeReply(reply) {
  return {
    id: String(reply?.id ?? ""),
    uid: String(reply?.uid ?? ""),
    name: String(reply?.name ?? "").trim() || "Someone",
    side: reply?.side === ADMIN ? ADMIN : PLAYER,
    body: String(reply?.body ?? "").trim(),
    at: String(reply?.at ?? ""),
  };
}

export function replies(msg) {
  return (Array.isArray(msg?.replies) ? msg.replies : [])
    .map(normalizeReply)
    .filter(r => r.body)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function lastReply(msg) {
  const list = replies(msg);
  return list.length ? list[list.length - 1] : null;
}

// ── Unread, from each side ─────────────────────────────────────────────────
//
// Each side has its own stamp, and each is moved only by that side reading the
// thread. A player reading their Dashboard must not clear the admin's flag, or
// a question would be marked answered by the person who asked it.

// Is there anything here the PLAYER hasn't seen? The message itself when it's
// never been opened, or an admin reply written since they last looked.
export function unreadByPlayer(msg) {
  const seen = String(msg?.user_seen_at ?? "");
  if (!seen) return true;
  return replies(msg).some(r => r.side === ADMIN && String(r.at) > seen);
}

// And for the admin: a player's reply written since an admin last read it. The
// message itself never counts — an admin wrote it.
export function unreadByAdmin(msg) {
  const seen = String(msg?.admin_seen_at ?? "");
  return replies(msg).some(r => r.side === PLAYER && String(r.at) > seen);
}

// Has this player asked something nobody has answered yet? Writing a reply
// marks the thread read for its author — you have plainly seen what you're
// answering — which on its own would drop the card into "earlier messages" the
// instant they pressed Send. Asking a question and watching it disappear is how
// people conclude it didn't go anywhere, so an open question keeps its card at
// the top until an admin comes back.
export function awaitingAdmin(msg) {
  return lastReply(msg)?.side === PLAYER;
}

export function playerInbox(rows = []) {
  return [...rows].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

// The cards that stay open on the Dashboard: news they haven't read, and
// conversations of their own still waiting on an answer.
export function openPlayerMessages(rows = []) {
  return playerInbox(rows).filter(m => unreadByPlayer(m) || awaitingAdmin(m));
}

// What the BADGE counts — strictly unread. A question they asked themselves is
// not news to them, and badging it would mean the number never falls to zero
// until an admin replies.
export function unreadPlayerMessages(rows = []) {
  return playerInbox(rows).filter(unreadByPlayer);
}

export function adminThreadsNeedingReply(rows = []) {
  return [...rows]
    .filter(unreadByAdmin)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));   // longest wait first
}

// A thread sorts by whatever happened in it last, not by when it started — a
// six-week-old decision somebody just replied to is current again.
function sortKey(msg) {
  return String(lastReply(msg)?.at || msg?.created_at || "");
}

// "2 messages from the league" / "3 players are waiting on a reply" — the badge
// tooltips, worded for whoever is reading.
export function playerInboxTitle(rows = []) {
  const n = rows.length;
  if (!n) return "No new messages";
  return `${n} new message${n === 1 ? "" : "s"} from the league admins`;
}

export function adminInboxTitle(rows = []) {
  const n = rows.length;
  if (!n) return "No replies waiting";
  return `${n} repl${n === 1 ? "y" : "ies"} from players waiting on you`;
}
