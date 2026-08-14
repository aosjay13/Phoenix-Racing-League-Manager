// Telling the drivers of a season that it's over.
//
// Marking a season complete used to be silent to everybody it affected — and
// worse than silent, because the Dashboard's Series Information section DROPS a
// finished season the moment it's marked. The row that told a player which
// series, season and class they were in simply stopped being there, so the one
// visible consequence of an admin's decision was a card disappearing.
//
// Four things have to hold, and each of them is a way this fails quietly:
//
//   1. IT FIRES ON THE TRANSITION, NOT THE STATUS. "Mark Completed" is a toggle
//      an admin can press twice, and every later edit to a finished season is a
//      PATCH carrying `status: "completed"` again. Announcing off the stored
//      value would post the same card to the whole roster on every rename.
//   2. ONE CARD PER PERSON. A driver can still hold two entries in a season, and
//      two identical cards read as a bug.
//   3. NOBODY IS POSTED INTO THE VOID. A hand-typed roster row for somebody with
//      no login has no account to tell.
//   4. THE CARD NAMES THE WHOLE PATH. "Your season is over" is no use to a
//      player racing in three of them, so it says game › series › season › class
//      — and still says something when half of those are missing.
import assert from "node:assert";
import {
  completionContext, completionRecipients, seasonJustCompleted,
} from "../seasonCompletion.js";
import {
  messageActions, messageScope, messageTitle, messageTone, unreadByPlayer,
} from "../messages.js";
import { scopeHref } from "../scopeLink.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. The transition, not the status ──────────────────────────────────────
ok("marking a running season complete announces",
  seasonJustCompleted({ status: "active" }, { status: "completed" }));
ok("a season with no status at all is running, so completing it announces",
  seasonJustCompleted({}, { status: "completed" }));
ok("and a season document that predates the field entirely",
  seasonJustCompleted(undefined, { status: "completed" }));
ok("however the status was cased", seasonJustCompleted({}, { status: "Completed" }));

// THE POINT: everything that leaves a finished season finished says nothing.
ok("pressing Mark Completed twice announces once",
  !seasonJustCompleted({ status: "completed" }, { status: "completed" }));
ok("renaming a finished season announces nothing",
  !seasonJustCompleted({ status: "completed", name: "Season 3" },
    { status: "completed", name: "Season 4" }));
ok("nor does any other edit to it",
  !seasonJustCompleted({ status: "completed" }, { status: "completed", drop_weeks: 2 }));
ok("editing a RUNNING season announces nothing",
  !seasonJustCompleted({ status: "active" }, { status: "active", name: "Season 4" }));
// Un-completing is not an announcement either: the card already sent is the
// record of what was decided at the time, and "your season is over, no it
// isn't, yes it is" is not a conversation worth having.
ok("re-opening a season announces nothing",
  !seasonJustCompleted({ status: "completed" }, { status: "active" }));

// ── 2 & 3. Who gets told ───────────────────────────────────────────────────
const classes = [{ id: "pro", name: "Pro" }, { id: "am", name: "Amateur" }];

check("a roster entry linked to an account is told",
  completionRecipients([{ user_id: "u1", name: "J. May", number: "42", class_ids: ["pro"] }], classes),
  [{ uid: "u1", class_names: ["Pro"], driver_name: "J. May", number: "42" }]);

check("a hand-typed row with no account behind it is skipped",
  completionRecipients([{ name: "Nobody", class_ids: ["pro"] }], classes), []);
check("and a blank uid is no uid",
  completionRecipients([{ user_id: "   ", name: "Nobody" }], classes), []);
check("an empty roster tells nobody", completionRecipients([], classes), []);
check("as does no roster at all", completionRecipients(), []);

// A driver holding two entries in one season — the old add-them-once-per-class
// workaround — is one person, and gets one card naming both classes.
check("two entries for one person are one card",
  completionRecipients([
    { user_id: "u1", name: "J. May", number: "42", class_ids: ["pro"] },
    { user_id: "u1", name: "J. May", number: "42", class_ids: ["am"] },
  ], classes),
  [{ uid: "u1", class_names: ["Pro", "Amateur"], driver_name: "J. May", number: "42" }]);

check("the same class twice isn't said twice",
  completionRecipients([
    { user_id: "u1", class_ids: ["pro"] },
    { user_id: "u1", class_ids: ["pro"] },
  ], classes)[0].class_names, ["Pro"]);

check("the second entry fills in what the first left blank",
  completionRecipients([
    { user_id: "u1", class_ids: ["pro"] },
    { user_id: "u1", name: "J. May", number: "42", class_ids: ["pro"] },
  ], classes)[0],
  { uid: "u1", class_names: ["Pro"], driver_name: "J. May", number: "42" });

check("classes read in the season's order, not the order they were ticked",
  completionRecipients([{ user_id: "u1", class_ids: ["am", "pro"] }], classes)[0].class_names,
  ["Pro", "Amateur"]);
// …and not the order the ROSTER ROWS came back in either, which is the one an
// end-to-end run caught: a roster is read straight out of Firestore, so which
// of a driver's two entries arrives first is not an order at all. Merging the
// names row by row read "Amateur & Pro" on a season that lists Pro above
// Amateur on every other screen.
check("nor the order the entries happened to be stored in",
  completionRecipients([
    { user_id: "u1", class_ids: ["am"] },
    { user_id: "u1", class_ids: ["pro"] },
  ], classes)[0].class_names,
  ["Pro", "Amateur"]);
check("an entry from before multi-class carries a single class_id",
  completionRecipients([{ user_id: "u1", class_id: "am" }], classes)[0].class_names, ["Amateur"]);
check("a single-class season names no class at all",
  completionRecipients([{ user_id: "u1" }], [])[0].class_names, []);
check("a class deleted since is simply not named",
  completionRecipients([{ user_id: "u1", class_ids: ["gone"] }], classes)[0].class_names, []);

check("everyone on the roster is told",
  completionRecipients([
    { user_id: "u1", class_ids: ["pro"] },
    { user_id: "u2", class_ids: ["am"] },
    { name: "no account" },
  ], classes).map(r => r.uid), ["u1", "u2"]);

// ── The context each card is built from ────────────────────────────────────
const season = { id: "s1", name: "Season 4", series_id: "sr1", game_id: "g1", status: "completed" };
const series = { id: "sr1", name: "Formula Phoenix", game_id: "g1" };
const game = { id: "g1", name: "iRacing" };
const recipient = { uid: "u1", class_names: ["Pro"], driver_name: "J. May", number: "42" };

const context = completionContext({ season, series, game, recipient });
check("the card carries the names as they were", context, {
  season_id: "s1", season_name: "Season 4",
  series_id: "sr1", series_name: "Formula Phoenix",
  game_id: "g1", game_name: "iRacing",
  class_names: ["Pro"], driver_name: "J. May", number: "42",
});
check("a season whose game was never stamped resolves it through the series",
  completionContext({ season: { ...season, game_id: "" }, series, game, recipient }).game_id, "g1");
check("a deleted series still names something",
  completionContext({ season, series: null, game: null, recipient }).series_name, "Series");
check("as does a nameless season",
  completionContext({ season: { id: "s1" }, series, game, recipient }).season_name, "Season");

// ── 4. What it reads as ────────────────────────────────────────────────────
const card = { kind: "season_completed", context, user_seen_at: null, replies: [] };

check("the card names game › series › season › class",
  messageTitle(card), "Season completed — iRacing › Formula Phoenix › Season 4 › Pro");
check("a driver in two classes gets both",
  messageTitle({ kind: "season_completed", context: { ...context, class_names: ["Pro", "Amateur"] } }),
  "Season completed — iRacing › Formula Phoenix › Season 4 › Pro & Amateur");
check("a single-class season stops at the season",
  messageTitle({ kind: "season_completed", context: { ...context, class_names: [] } }),
  "Season completed — iRacing › Formula Phoenix › Season 4");
check("an unstamped game starts at the series",
  messageTitle({ kind: "season_completed", context: { ...context, game_name: "" } }),
  "Season completed — Formula Phoenix › Season 4 › Pro");
// A card headed "Season completed — " is exactly the blank the board exists to
// avoid, so the path never renders empty.
check("a card with nothing left to name still says something",
  messageTitle({ kind: "season_completed" }), "Season completed — that season");
check("a class_name written singular renders too",
  messageTitle({ kind: "season_completed", context: { season_name: "S4", class_name: "Pro" } }),
  "Season completed — S4 › Pro");

// A season ending is neither a grant nor a refusal — colouring it "bad" would
// make the end of every league year look like something went wrong.
check("a season ending is neither good news nor bad", messageTone(card), "info");
check("it points at the two places the racing still lives",
  messageActions(card), ["standings", "stats"]);

// And both of those pages read the menus at the top of the screen, so the card
// has to carry its own scope or the buttons open THIS season's card on
// WHATEVER season the reader had selected. The context built above is what
// makes that work end to end.
check("the context it posts is enough to open the right standings",
  messageScope(card), { game: "g1", series: "sr1", season: "s1", class: "Pro" });
check("which is a link straight to them",
  scopeHref("/standings", messageScope(card)),
  "/standings?game=g1&series=sr1&season=s1&class=Pro");

// And it's dismissible like every other card: posted unread, so the board draws
// it open with a "Got it" button, and read once the player presses it.
ok("a freshly posted card is unread, so it opens with a Got it", unreadByPlayer(card));
ok("and folds away once dismissed",
  !unreadByPlayer({ ...card, user_seen_at: "2026-06-01T00:00:00Z" }));

console.log(`seasonCompletion: ${n} assertions passed`);
