// "Not Interested" and "Clear Notification" — what a player has said about each
// season they could join, and what the Sign-ups badge does about it.
//
// The badge is the reason any of this exists. It counts what is waiting on the
// player, which is right — but a league running six series means a permanent
// red 6 for somebody who races one of them, and a number that never reaches
// zero is a number people stop reading. Once that happens the badge no longer
// works for the sign-up they DO care about.
//
// What has to hold:
//
//   1. BOTH ANSWERS SILENCE THE BADGE. That's the whole point of the pair.
//   2. ONLY ONE OF THEM HIDES THE SERIES. If "clear the notification" also took
//      it out of the list, the two buttons would do the same thing and one of
//      them would be a lie.
//   3. NOTHING IS EVER LOST. A season put aside is still joinable, still
//      findable, and one press from coming back — otherwise "Not Interested" is
//      a decision nobody sensible would make.
//   4. A STRAY VALUE CANNOT HIDE A SERIES. Anything that isn't one of the two
//      answers means "no answer": failing open is the only safe direction, or a
//      bad write silently removes a league's season from everyone's screen.
import assert from "node:assert";
import {
  HIDDEN, MUTED, NORMAL, badgeSeasons, countsOnBadge, isHidden, isMuted, muteButtonLabel,
  muteButtonTitle, normalizePrefs, notInterestedTitle, partitionJoinable, seasonPref, withPref,
} from "../signupPrefs.js";
import {
  nothingToJoinHeadline, nothingToJoinReason, signupBadgeCount, signupBadgeTitle, signupOverview,
} from "../signupFlow.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const season = (id, over = {}) => ({
  season_id: id, season_name: `Season ${id}`, series_id: `sr-${id}`, series_name: `Series ${id}`,
  game_name: "iRacing", rules: {}, roster: [], pending: [], classes: [], ...over,
});

// ── Reading an answer ──────────────────────────────────────────────────────
check("no answer at all", seasonPref({}, "a"), NORMAL);
check("no map at all", seasonPref(null, "a"), NORMAL);
check("muted", seasonPref({ a: MUTED }, "a"), MUTED);
check("hidden", seasonPref({ a: HIDDEN }, "a"), HIDDEN);
ok("isMuted", isMuted({ a: MUTED }, "a") && !isMuted({ a: HIDDEN }, "a"));
ok("isHidden", isHidden({ a: HIDDEN }, "a") && !isHidden({ a: MUTED }, "a"));

// ── 4. A stray value cannot hide a series ──────────────────────────────────
check("an unknown value is no answer", seasonPref({ a: "deleted" }, "a"), NORMAL);
check("nor is a truthy object", seasonPref({ a: { hidden: true } }, "a"), NORMAL);
check("nor a boolean", seasonPref({ a: true }, "a"), NORMAL);
ok("so it still shows", !isHidden({ a: "wat" }, "a"));
ok("and still counts", countsOnBadge({ a: "wat" }, "a"));
check("and normalising drops it", normalizePrefs({ a: "wat", b: HIDDEN }), { b: HIDDEN });
check("a non-object normalises to nothing", normalizePrefs("nope"), {});
check("so does null", normalizePrefs(null), {});
check("empty keys are dropped", normalizePrefs({ "": HIDDEN }), {});

// ── 1. Both answers silence the badge ──────────────────────────────────────
ok("an unanswered season counts", countsOnBadge({}, "a"));
ok("a muted one doesn't", !countsOnBadge({ a: MUTED }, "a"));
ok("a hidden one doesn't", !countsOnBadge({ a: HIDDEN }, "a"));

const three = [season("a"), season("b"), season("c")];
check("only the unanswered ones badge",
  badgeSeasons(three, { a: MUTED, b: HIDDEN }).map(s => s.season_id), ["c"]);
check("all of them when nothing has been said",
  badgeSeasons(three, {}).map(s => s.season_id), ["a", "b", "c"]);
check("none when every one has been answered",
  badgeSeasons(three, { a: MUTED, b: HIDDEN, c: MUTED }), []);

// ── 2. Only one of them hides the series ───────────────────────────────────
const split = partitionJoinable(three, { a: MUTED, b: HIDDEN });
check("muted stays in the list", split.shown.map(s => s.season_id), ["a", "c"]);
check("hidden is the only one taken out", split.notInterested.map(s => s.season_id), ["b"]);
check("nothing answered, nothing put aside", partitionJoinable(three, {}).notInterested, []);
check("an empty list", partitionJoinable(), { shown: [], notInterested: [] });

// ── 3. Nothing is ever lost ────────────────────────────────────────────────
check("setting an answer", withPref({}, "a", HIDDEN), { a: HIDDEN });
check("changing it", withPref({ a: HIDDEN }, "a", MUTED), { a: MUTED });
// Clearing REMOVES the key rather than storing an empty string, so "I'm
// interested after all" leaves no trace at all.
check("clearing it", withPref({ a: HIDDEN }, "a", NORMAL), {});
check("clearing one leaves the others", withPref({ a: HIDDEN, b: MUTED }, "a", NORMAL), { b: MUTED });
check("an unknown value clears rather than stores", withPref({ a: HIDDEN }, "a", "wat"), {});
check("no season id changes nothing", withPref({ a: HIDDEN }, "", HIDDEN), { a: HIDDEN });
check("it never mutates the map it was given",
  (() => { const p = { a: HIDDEN }; withPref(p, "b", MUTED); return p; })(), { a: HIDDEN });

// ── The button that flips ──────────────────────────────────────────────────
// A player who silences something must be able to un-silence it in the place
// they silenced it, or the button is a trap.
check("unanswered", muteButtonLabel({}, "a"), "Clear Notification");
check("muted flips to the undo", muteButtonLabel({ a: MUTED }, "a"), "Notify me again");
check("hidden isn't muted, so it reads as the mute", muteButtonLabel({ a: HIDDEN }, "a"), "Clear Notification");
ok("the tooltip explains the badge either way",
  muteButtonTitle({}, "a").includes("badge") && muteButtonTitle({ a: MUTED }, "a").includes("badge"));

check("no heading for an empty aside", notInterestedTitle([]), "");
check("one", notInterestedTitle([season("a")]), "1 series you said you're not interested in");
check("two", notInterestedTitle(three), "3 series you said you're not interested in");

// ── Through the screen's own overview and badge ────────────────────────────
const payload = (over = {}) => ({
  driver: { id: "d1", name: "J. May" },
  open_signups: three,
  my_seasons: [],
  closed_signups: 0,
  signup_prefs: {},
  ...over,
});

check("nothing answered: everything counts", signupBadgeCount(payload()), 3);
check("clearing one drops the badge by one",
  signupBadgeCount(payload({ signup_prefs: { a: MUTED } })), 2);
check("so does not-interested",
  signupBadgeCount(payload({ signup_prefs: { a: HIDDEN } })), 2);
check("answering all three clears it",
  signupBadgeCount(payload({ signup_prefs: { a: MUTED, b: HIDDEN, c: MUTED } })), 0);
check("and the tooltip says so",
  signupBadgeTitle(payload({ signup_prefs: { a: MUTED, b: HIDDEN, c: MUTED } })),
  "Nothing waiting on you right now");
check("a stray value can't silence anything",
  signupBadgeCount(payload({ signup_prefs: { a: "wat", b: "", c: null } })), 3);

// A car still to choose is a season they have ALREADY joined — a genuinely
// outstanding job, not an invitation — so silencing invitations must not
// silence that.
const withCar = payload({
  signup_prefs: { a: HIDDEN, b: HIDDEN, c: HIDDEN },
  my_seasons: [{ season_id: "z", open: true, needs_pick: true }],
});
check("a car to choose still counts", signupBadgeCount(withCar), 1);
ok("and is named in the tooltip", signupBadgeTitle(withCar).includes("car"));

const o = signupOverview(payload({ signup_prefs: { b: HIDDEN } }));
check("the screen's list drops it", o.joinable.map(s => s.season_id), ["a", "c"]);
check("the aside picks it up", o.notInterested.map(s => s.season_id), ["b"]);
check("and the whole list is still there to reopen it from",
  o.allJoinable.map(s => s.season_id), ["a", "b", "c"]);
check("the prefs ride along", o.prefs, { b: HIDDEN });

// An empty list has to say WHICH thing happened. A league with three seasons
// running, all put aside, must not be described as a league with nothing on.
const allAside = signupOverview(payload({ signup_prefs: { a: HIDDEN, b: HIDDEN, c: HIDDEN } }));
check("the list is empty", allAside.joinable, []);
check("but the headline doesn't claim the league is empty",
  nothingToJoinHeadline(allAside), "Nothing left in your list.");
ok("and the reason points at the section they're in",
  nothingToJoinReason(allAside).includes("not interested"));
ok("naming how many", nothingToJoinReason(allAside).includes("All 3 open seasons"));
ok("one reads as one",
  nothingToJoinReason(signupOverview(payload({ open_signups: [season("a")], signup_prefs: { a: HIDDEN } })))
    .includes("The one season that's open is"));
// And the old reasons still win when nothing has been put aside.
ok("a genuinely empty league still says so",
  nothingToJoinReason(signupOverview(payload({ open_signups: [] })))
    .includes("no seasons open at the moment"));

console.log(`signupPrefs: ${n} assertions passed`);
