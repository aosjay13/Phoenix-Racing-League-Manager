// A denied sign-up has to reach the player, twice: an email they may never
// open, and a notice on the Sign-ups screen they can't miss. Both are built
// here, from one request document, so they can't tell different stories.
//
// What matters:
//
//   1. THE ADMIN'S REASON SURVIVES INTACT. It's the whole point — a denial with
//      no reason is what players complain about, and one whose reason got lost
//      on the way is the same thing with extra steps.
//   2. A denial with no reason still reads as deliberate, not as a blank space
//      that looks like a bug.
//   3. The reason is free text an admin typed, and it lands in an HTML email —
//      so it must not be able to carry markup into somebody's inbox.
import assert from "node:assert";
import {
  denialHtml, denialNotice, denialSubject, denialText, denyReason, unreadDenials,
} from "../denialNotice.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const denied = (over = {}) => ({
  id: "r1", status: "denied", kind: "signup",
  name: "J. May", number: "42", car: "Ferrari 296 GT3",
  season_id: "s4", season_name: "Season 4",
  series_id: "fp", series_name: "Formula Phoenix",
  deny_reason: "That number is retired — please pick another.",
  resolved_at: "2026-03-02T10:00:00Z",
  ...over,
});

// ── 1. The reason survives ─────────────────────────────────────────────────
check("read off the request", denyReason(denied()), "That number is retired — please pick another.");
check("trimmed", denyReason(denied({ deny_reason: "  spaces  " })), "spaces");
// A box someone tabbed through leaves whitespace that would render as a reason.
check("whitespace is no reason", denyReason(denied({ deny_reason: "   " })), null);
check("none given", denyReason(denied({ deny_reason: null })), null);
check("missing entirely", denyReason({}), null);

ok("the email body carries it", denialText(denied()).includes("That number is retired"));
ok("so does the HTML", denialHtml(denied()).includes("That number is retired"));
ok("and the in-app notice", denialNotice(denied()).reason === "That number is retired — please pick another.");

// The subject names the series, so a player in three of them knows which one
// this is about without opening it.
check("the subject names the season",
  denialSubject(denied()), "Your sign-up for Formula Phoenix · Season 4 wasn't approved");
check("a request with no names still reads",
  denialSubject({}), "Your sign-up for that season wasn't approved");

// ── 2. No reason still reads as deliberate ─────────────────────────────────
const noReason = denied({ deny_reason: null });
ok("the email says none was given", denialText(noReason).includes("didn't leave a reason"));
ok("and so does the HTML", denialHtml(noReason).includes("didn&rsquo;t leave a reason"));
ok("never an empty quote", !denialText(noReason).includes("The reason they gave:"));
check("the notice carries null rather than an empty string", denialNotice(noReason).reason, null);

// Both bodies always say they can try again — that's the actionable half.
ok("the email says to try again", denialText(denied()).includes("sign up again"));
ok("even with no reason", denialText(noReason).includes("sign up again"));
ok("and links there when given a URL",
  denialText(denied(), { signupUrl: "https://x.test/signups" }).includes("https://x.test/signups"));
ok("the HTML links too",
  denialHtml(denied(), { signupUrl: "https://x.test/signups" }).includes('href="https://x.test/signups"'));
ok("and omits the link when there's no URL", !denialHtml(denied()).includes("<a href"));

// ── 3. An admin's words can't carry markup into an inbox ───────────────────
const nasty = denied({
  deny_reason: '<script>alert("x")</script> & "quotes" <b>bold</b>',
  name: "<img src=x onerror=1>",
});
const html = denialHtml(nasty);
ok("no script tag survives", !html.includes("<script>"));
ok("nor any injected bold", !html.includes("<b>bold</b>"));
ok("it's escaped instead", html.includes("&lt;script&gt;"));
ok("ampersands too", html.includes("&amp;"));
ok("quotes too", html.includes("&quot;"));
ok("a name is escaped as well", !html.includes("<img src=x"));
// The plain-text half needs no escaping and must NOT be mangled.
ok("plain text keeps the reason verbatim",
  denialText(nasty).includes('<script>alert("x")</script>'));

// ── The notice the screen renders ──────────────────────────────────────────
const notice = denialNotice(denied());
check("it knows which season to re-open",
  [notice.season_id, notice.series_name, notice.season_name], ["s4", "Formula Phoenix", "Season 4"]);
check("and what they had asked for", [notice.number, notice.car], ["42", "Ferrari 296 GT3"]);
check("a bare request still renders",
  [denialNotice({}).season_name, denialNotice({}).series_name], ["Season", "Series"]);

// ── Only the ones they haven't read, newest first ──────────────────────────
const rows = [
  denied({ id: "old", resolved_at: "2026-01-01T00:00:00Z" }),
  denied({ id: "read", resolved_at: "2026-04-01T00:00:00Z", player_seen_at: "2026-04-02T00:00:00Z" }),
  denied({ id: "new", resolved_at: "2026-03-01T00:00:00Z" }),
];
check("acknowledged ones drop out", unreadDenials(rows).map(d => d.id), ["new", "old"]);
check("newest first", unreadDenials(rows)[0].id, "new");
check("nothing unread", unreadDenials([rows[1]]), []);
check("nothing at all", unreadDenials(), []);
// Acknowledging is what lets them try again, so it must actually clear.
check("once read, nothing is held back",
  unreadDenials(rows.map(r => ({ ...r, player_seen_at: "2026-05-01T00:00:00Z" }))), []);

console.log(`denialNotice: ${n} assertions passed`);
