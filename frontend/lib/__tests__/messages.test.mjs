// The league's message board — everything an admin does TO a player, said to
// that player, with a thread they can answer in.
//
// What has to hold:
//
//   1. EVERY KIND SAYS SOMETHING. A decision that renders as a blank card is
//      worse than no card: it looks like a bug, and the player still doesn't
//      know what happened. Every kind must produce a title, whatever the
//      context it was given.
//   2. THE TWO READ STAMPS ARE INDEPENDENT. A player reading their Dashboard
//      must never clear the admin's flag — that would mark a question answered
//      by the person who asked it — and vice versa.
//   3. A THREAD SORTS BY WHAT HAPPENED IN IT LAST. A six-week-old decision
//      somebody just replied to is current again; if it sorted by when it was
//      opened it would be answered last, or never.
//   4. THE ADMIN'S OWN WORDS SURVIVE. The reason attached to a decision is the
//      whole point of announcing it.
import assert from "node:assert";
import {
  ADMIN, MESSAGE_KINDS, PLAYER, adminInboxTitle, adminNote, adminThreadsNeedingReply,
  awaitingAdmin, lastReply, messageActions, messageBody, messageKind, messageScope,
  messageTitle, messageTone, normalizeReply, openPlayerMessages, playerInbox,
  playerInboxTitle, replies, unreadByAdmin, unreadByPlayer, unreadPlayerMessages,
} from "../messages.js";
import { scopeHref } from "../scopeLink.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const msg = (over = {}) => ({
  id: "m1",
  uid: "u1",
  kind: "signup_approved",
  context: {
    series_name: "Formula Phoenix", season_name: "Season 4",
    number: "42", car: "Ferrari 296 GT3",
  },
  admin_note: null,
  replies: [],
  created_at: "2026-03-02T10:00:00Z",
  user_seen_at: null,
  admin_seen_at: "2026-03-02T10:00:00Z",
  ...over,
});

const reply = (side, at, body = "…") => ({ id: at, uid: "x", name: "X", side, body, at });

// ── 1. Every kind says something ───────────────────────────────────────────
for (const kind of Object.keys(MESSAGE_KINDS)) {
  // Given a full context…
  ok(`${kind} has a title`, messageTitle(msg({ kind })).length > 0);
  // …and given NOTHING at all. A message whose season was deleted, or written
  // by an older version of the app, still has to render.
  ok(`${kind} renders with an empty context`, messageTitle({ kind }).length > 0);
  ok(`${kind} never renders "undefined"`, !messageTitle({ kind }).includes("undefined"));
  ok(`${kind} body never renders "undefined"`, !messageBody({ kind }).includes("undefined"));
  ok(`${kind} has a tone`, ["good", "bad", "info"].includes(messageTone({ kind })));
  ok(`${kind} has an actions list`, Array.isArray(messageActions({ kind })));
}

// An unknown kind — a row written by a newer version, or corrupted — falls back
// rather than throwing the whole Dashboard away.
check("an unknown kind falls back to a note", messageKind({ kind: "wat" }), "note");
ok("and still renders", messageTitle({ kind: "wat" }).length > 0);
check("as does a row with no kind at all", messageKind({}), "note");
check("and no message at all", messageKind(null), "note");

// The specific wording players read.
check("the welcome names the series",
  messageTitle(msg()), "Welcome to Formula Phoenix!");
check("and the body names the season, number and car",
  messageBody(msg()), "You're on the roster for Season 4 — #42 · Ferrari 296 GT3.");
check("a season with no number or car still reads",
  messageBody(msg({ context: { series_name: "FP", season_name: "S4" } })),
  "You're on the roster for S4.");
check("a number with no car",
  messageBody(msg({ context: { season_name: "S4", number: "7" } })),
  "You're on the roster for S4 — #7.");

check("a denial names the season",
  messageTitle(msg({ kind: "signup_denied" })),
  "Your sign-up for Formula Phoenix · Season 4 wasn't approved");
check("a removal is unambiguous about what happened",
  messageTitle(msg({ kind: "roster_removed" })),
  "You've been taken off the roster for Formula Phoenix · Season 4");
check("a granted number says which one",
  messageTitle(msg({ kind: "number_approved", context: { number: "8", series_name: "FP" } })),
  "You've got #8 in FP");
check("and what it changed from",
  messageBody(msg({ kind: "number_approved", context: { number: "8", previous_number: "42" } })),
  "Your number has changed from #42 to #8.");
check("a first number isn't a change",
  messageBody(msg({ kind: "number_approved", context: { number: "8" } })),
  "Your car number is now #8.");
check("a refused number says what they're still running",
  messageBody(msg({ kind: "number_denied", context: { number: "8", previous_number: "42" } })),
  "You're still running #42. You can ask for a different one any time.");
check("a message with no names at all still names something",
  messageTitle({ kind: "roster_removed" }), "You've been taken off the roster for that season");
// The end of a season names the whole path down to the class, because "your
// season is over" is no use to somebody racing in three of them. The rest of
// this kind — who gets told, and only on the transition — is in
// seasonCompletion.test.mjs.
check("a finished season names game › series › season › class",
  messageTitle(msg({
    kind: "season_completed",
    context: { game_name: "iRacing", series_name: "Formula Phoenix", season_name: "Season 4", class_names: ["Pro"] },
  })),
  "Season completed — iRacing › Formula Phoenix › Season 4 › Pro");
check("a claim approval names the driver",
  messageTitle(msg({ kind: "claim_approved", context: { driver_name: "J. May" } })),
  "Your account is now linked to J. May");
check("an admin's own note carries its subject",
  messageTitle(msg({ kind: "note", context: { subject: "Race night moved to Thursday" } })),
  "Race night moved to Thursday");

// The approval is the one that gets the full welcome treatment, because it's
// somebody's first minute in the league.
check("the welcome points at the schedule, the calendar and the Discord",
  messageActions(msg()), ["schedule", "calendar", "discord"]);
check("a denial points back at the sign-up form",
  messageActions(msg({ kind: "signup_denied" })), ["signups"]);
check("a plain note pushes nowhere", messageActions(msg({ kind: "note" })), []);

// Tone is never the only signal, but it does have to be right.
check("being let in is good news", messageTone(msg()), "good");
check("being turned down isn't", messageTone(msg({ kind: "signup_denied" })), "bad");
check("nor is being removed", messageTone(msg({ kind: "roster_removed" })), "bad");
check("a note is neither", messageTone(msg({ kind: "note" })), "info");

// ── Where a card's buttons go ──────────────────────────────────────────────
//
// Standings, Stats, the Schedule and the Calendar all read the Game ▸ Series ▸
// Season ▸ Class menus at the top of the page. A button that opens one of them
// without saying WHICH season shows the reader whatever they had selected — so
// a card announcing the end of Season 4 of one series could open the standings
// of Season 6 of another, which is the app contradicting the sentence directly
// above the button.
const completed = msg({
  kind: "season_completed",
  context: {
    game_id: "g1", game_name: "iRacing",
    series_id: "sr1", series_name: "Formula Phoenix",
    season_id: "se1", season_name: "Season 4",
    class_names: ["Pro"],
  },
});

check("a card knows the season it is about",
  messageScope(completed), { game: "g1", series: "sr1", season: "se1", class: "Pro" });
check("and it becomes a link that opens there",
  scopeHref("/standings", messageScope(completed)),
  "/standings?game=g1&series=sr1&season=se1&class=Pro");

// ALL THREE IDS OR NOTHING. The levels resolve top-down — a game to find the
// series under, a series to find the season under — so a season named without
// its game would leave the reader's own game selected and land them somewhere
// arbitrary. Better to leave the button exactly as it was.
check("a message with no game named claims no scope",
  messageScope(msg({ context: { series_id: "sr1", season_id: "se1" } })), null);
check("nor one with no series",
  messageScope(msg({ context: { game_id: "g1", season_id: "se1" } })), null);
check("nor one with no season",
  messageScope(msg({ context: { game_id: "g1", series_id: "sr1" } })), null);
check("nor a message written before any of this",
  messageScope({ kind: "season_completed" }), null);
check("nor no message at all", messageScope(null), null);

// The class travels by NAME — its cross-season identity, and what the Class
// menu is remembered by.
const scopeWith = (over) => messageScope(msg({ context: { ...completed.context, ...over } }));
check("one class opens that class's own table", scopeWith({ class_names: ["Am"] }).class, "Am");
// A driver entered in two is shown the season-wide table, which contains both:
// picking the first of them would be a guess, and wrong half the time.
check("two classes open the season-wide view",
  scopeWith({ class_names: ["Pro", "Am"] }).class, "");
check("a single-class season likewise", scopeWith({ class_names: [] }).class, "");
check("a context written with the singular class_name is understood",
  messageScope(msg({ context: { game_id: "g", series_id: "s", season_id: "se", class_name: "GT3" } })).class,
  "GT3");
// "All Classes" is a real choice, distinct from "not specified", so it travels
// as the same explicit sentinel the rest of the app's links use.
check("All Classes travels explicitly rather than being left out",
  scopeHref("/stats", scopeWith({ class_names: [] })),
  "/stats?game=g1&series=sr1&season=se1&class=all");
check("a link with nothing to say is just the page", scopeHref("/standings", {}), "/standings");
check("the league is carried when the card is from another one",
  scopeHref("/standings", { ...messageScope(completed), league: "L2" }),
  "/standings?league=L2&game=g1&series=sr1&season=se1&class=Pro");

// ── 4. The admin's own words ───────────────────────────────────────────────
check("read off the message", adminNote(msg({ admin_note: "Wrong number." })), "Wrong number.");
check("trimmed", adminNote(msg({ admin_note: "  spaces  " })), "spaces");
// A box someone tabbed through leaves whitespace that would render as a reason.
check("whitespace is no note", adminNote(msg({ admin_note: "   " })), null);
check("none given", adminNote(msg()), null);
check("missing entirely", adminNote({}), null);

// ── The thread ─────────────────────────────────────────────────────────────
check("a reply keeps its side", normalizeReply({ side: ADMIN }).side, ADMIN);
check("an unknown side is a player's — never silently promoted to staff",
  normalizeReply({ side: "root" }).side, PLAYER);
check("a nameless reply still has an author", normalizeReply({}).name, "Someone");
check("bodies are trimmed", normalizeReply({ body: "  hi  " }).body, "hi");

const threaded = msg({
  replies: [reply(ADMIN, "2026-03-04T00:00:00Z", "second"), reply(PLAYER, "2026-03-03T00:00:00Z", "first")],
});
check("replies read oldest first, whatever order they were stored in",
  replies(threaded).map(r => r.body), ["first", "second"]);
check("the last one is the last one", lastReply(threaded).body, "second");
check("an empty reply is dropped rather than rendered blank",
  replies(msg({ replies: [reply(PLAYER, "2026-03-03T00:00:00Z", "   ")] })), []);
check("no thread, no last reply", lastReply(msg()), null);
check("a message with no replies field at all", replies({}), []);

// ── 2. The two read stamps are independent ─────────────────────────────────
ok("a message nobody has opened is unread by the player", unreadByPlayer(msg()));
ok("but never by the admin — they wrote it", !unreadByAdmin(msg()));

const opened = msg({ user_seen_at: "2026-03-03T00:00:00Z" });
ok("once read it stays read", !unreadByPlayer(opened));

// An admin answers. That's news for the player and nobody else.
const answered = msg({
  user_seen_at: "2026-03-03T00:00:00Z",
  admin_seen_at: "2026-03-02T10:00:00Z",
  replies: [reply(ADMIN, "2026-03-05T00:00:00Z")],
});
ok("an admin's reply is unread by the player", unreadByPlayer(answered));
ok("and not by the admin", !unreadByAdmin(answered));

// The player answers. That's a job for an admin.
const asked = msg({
  user_seen_at: "2026-03-03T00:00:00Z",
  admin_seen_at: "2026-03-02T10:00:00Z",
  replies: [reply(PLAYER, "2026-03-05T00:00:00Z")],
});
ok("a player's reply is unread by the admin", unreadByAdmin(asked));
// THE POINT: the player wrote it, so it must not come back to them as news —
// and reading their own Dashboard must not clear the admin's flag.
ok("and is not unread by the player who wrote it", !unreadByPlayer(asked));
ok("the admin's flag survives the player reading the thread",
  unreadByAdmin({ ...asked, user_seen_at: "2026-03-06T00:00:00Z" }));
ok("and the player's survives the admin reading it",
  unreadByPlayer({ ...answered, admin_seen_at: "2026-03-06T00:00:00Z" }));

// An admin answering marks it dealt with; a later player reply raises it again.
ok("answered and read is clear",
  !unreadByAdmin({ ...asked, admin_seen_at: "2026-03-06T00:00:00Z" }));
ok("then they write again", unreadByAdmin({
  ...asked, admin_seen_at: "2026-03-06T00:00:00Z",
  replies: [...asked.replies, reply(PLAYER, "2026-03-07T00:00:00Z")],
}));
// A never-stamped admin side (a legacy row) counts a player's reply as waiting
// rather than silently swallowing it.
ok("no admin stamp at all still surfaces a player's reply",
  unreadByAdmin({ replies: [reply(PLAYER, "2026-03-01T00:00:00Z")] }));

// ── 3. Sorting: whatever happened last ─────────────────────────────────────
const old = msg({ id: "old", created_at: "2026-01-01T00:00:00Z" });
const recent = msg({ id: "recent", created_at: "2026-05-01T00:00:00Z" });
const revived = msg({
  id: "revived", created_at: "2026-02-01T00:00:00Z",
  replies: [reply(ADMIN, "2026-06-01T00:00:00Z")],
});
check("the player's inbox is newest-first by last activity",
  playerInbox([old, recent, revived]).map(m => m.id), ["revived", "recent", "old"]);
check("an empty inbox", playerInbox(), []);
check("sorting doesn't mutate the caller's array",
  (() => { const rows = [old, recent]; playerInbox(rows); return rows.map(m => m.id); })(),
  ["old", "recent"]);

check("only the unread ones badge",
  unreadPlayerMessages([old, msg({ id: "read", user_seen_at: "2026-06-01T00:00:00Z" })])
    .map(m => m.id), ["old"]);
check("nothing unread", unreadPlayerMessages([msg({ user_seen_at: "2026-06-01T00:00:00Z" })]), []);

// ── A question of their own stays on screen ────────────────────────────────
//
// Writing a reply marks the thread read for its author — you have plainly seen
// what you're answering. On its own that would drop the card into "earlier
// messages" the instant they pressed Send, and asking a question then watching
// it disappear is how people conclude it never went anywhere.
const asked2 = msg({
  id: "asked", user_seen_at: "2026-06-01T00:00:00Z",
  replies: [reply(PLAYER, "2026-06-01T00:00:00Z")],
});
ok("their own unanswered question is waiting on an admin", awaitingAdmin(asked2));
ok("but is NOT unread to them", !unreadByPlayer(asked2));
check("so it stays open on their board", openPlayerMessages([asked2]).map(m => m.id), ["asked"]);
// …and must not sit on the badge, or the number never falls to zero.
check("without badging", unreadPlayerMessages([asked2]), []);

const answered2 = { ...asked2, replies: [...asked2.replies, reply(ADMIN, "2026-06-02T00:00:00Z")] };
ok("once answered it is no longer waiting on anyone", !awaitingAdmin(answered2));
ok("and the answer is unread news for them", unreadByPlayer(answered2));

const settled = msg({ id: "settled", user_seen_at: "2026-07-01T00:00:00Z" });
check("a settled card folds away", openPlayerMessages([settled]), []);
check("unread and waiting cards both stay",
  openPlayerMessages([settled, asked2, old]).map(m => m.id).sort(), ["asked", "old"]);

// The admin's queue runs the OTHER way: longest wait first, so nobody sits at
// the bottom of a list forever.
const waited = (id, at) => msg({
  id, admin_seen_at: "2026-01-01T00:00:00Z", replies: [reply(PLAYER, at)],
});
check("longest wait first",
  adminThreadsNeedingReply([waited("b", "2026-05-01T00:00:00Z"), waited("a", "2026-02-01T00:00:00Z")])
    .map(m => m.id), ["a", "b"]);
check("answered threads drop out of the queue",
  adminThreadsNeedingReply([msg(), answered]), []);
check("an empty queue", adminThreadsNeedingReply(), []);

// ── The badge tooltips ─────────────────────────────────────────────────────
check("no messages", playerInboxTitle([]), "No new messages");
check("one", playerInboxTitle([msg()]), "1 new message from the league admins");
check("two", playerInboxTitle([msg(), msg()]), "2 new messages from the league admins");
check("no replies waiting", adminInboxTitle([]), "No replies waiting");
check("one reply", adminInboxTitle([msg()]), "1 reply from players waiting on you");
check("two replies", adminInboxTitle([msg(), msg()]), "2 replies from players waiting on you");

console.log(`messages: ${n} assertions passed`);
