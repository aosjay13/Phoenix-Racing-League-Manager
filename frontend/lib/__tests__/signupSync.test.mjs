// A sign-up is the one moment the app learns who somebody is. What it does
// with that has to be safe in both directions:
//
//   1. it must actually SAVE what was typed — onto the driver profile (the
//      platform usernames) and onto the player's own account (the display name
//      and car number it owns), so nobody is asked the same thing twice;
//   2. it must never OVERWRITE something the player chose themselves. A player
//      who set their display name to "Ghost" on their Profile and then signs up
//      as "J. May" for one series keeps "Ghost".
//
// Rule 2 is the one worth a test: it's invisible when it works and infuriating
// when it doesn't, and it can only be checked by reading the account first.
import assert from "node:assert";
import { mergeAliases, normalizeAliases } from "../aliases.js";
import {
  isPlaceholderDisplayName, knownAliasesFor, knownRacingName, userAccountUpdatesFromSignup,
} from "../signupRequest.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const aliasMapOf = list => Object.fromEntries((list || []).filter(a => a.value).map(a => [a.label, a.value]));

// ── Which display names the app made up, and which a player chose ──────────
ok("blank is a placeholder", isPlaceholderDisplayName("", "jane.doe@example.com"));
ok("nothing at all is a placeholder", isPlaceholderDisplayName(null, "jane.doe@example.com"));
ok("the email prefix is what sign-in invents", isPlaceholderDisplayName("jane.doe", "jane.doe@example.com"));
ok("the whole email is too", isPlaceholderDisplayName("jane.doe@example.com", "jane.doe@example.com"));
ok("case doesn't matter", isPlaceholderDisplayName("Jane.Doe", "jane.doe@example.com"));
ok('the "Driver" fallback is a placeholder', isPlaceholderDisplayName("Driver", "jane.doe@example.com"));
ok("a chosen name is NOT a placeholder", !isPlaceholderDisplayName("Ghost", "jane.doe@example.com"));
ok("a name that merely contains the email prefix is theirs",
  !isPlaceholderDisplayName("jane.doe the second", "jane.doe@example.com"));
// With no email on file there's nothing to have been derived from, so any
// non-empty name is treated as the player's own.
ok("a name with no email to compare against is theirs", !isPlaceholderDisplayName("Ghost", ""));
ok("blank is still a placeholder with no email", isPlaceholderDisplayName("", ""));

// ── What a sign-up writes to the account ──────────────────────────────────
check("a fresh account takes the racing name and number",
  userAccountUpdatesFromSignup({
    profile: { display_name: "jane.doe", email: "jane.doe@example.com", number: null },
    name: "J. May", number: "42",
  }),
  { display_name: "J. May", number: "42" });

check("a name the player chose is never touched",
  userAccountUpdatesFromSignup({
    profile: { display_name: "Ghost", email: "jane.doe@example.com", number: null },
    name: "J. May", number: "42",
  }),
  { number: "42" });

check("a number the player set is never changed",
  userAccountUpdatesFromSignup({
    profile: { display_name: "jane.doe", email: "jane.doe@example.com", number: "7" },
    name: "J. May", number: "42",
  }),
  { display_name: "J. May" });

check("an account that answered both is left entirely alone",
  userAccountUpdatesFromSignup({
    profile: { display_name: "Ghost", email: "jane.doe@example.com", number: "7" },
    name: "J. May", number: "42",
  }),
  {});

// A season that doesn't run car numbers submits none — that must not blank the
// one the account already has, nor write an empty string.
check("a sign-up with no number writes no number",
  userAccountUpdatesFromSignup({
    profile: { display_name: "jane.doe", email: "jane.doe@example.com", number: "7" },
    name: "J. May", number: "",
  }),
  { display_name: "J. May" });
check("no number and no name means no write at all",
  userAccountUpdatesFromSignup({
    profile: { display_name: "Ghost", email: "j@e.com", number: "7" }, name: "", number: "",
  }),
  {});
check("a brand-new account with nothing on it",
  userAccountUpdatesFromSignup({ profile: {}, name: "J. May", number: "" }),
  { display_name: "J. May" });
check("called with nothing doesn't throw", userAccountUpdatesFromSignup(), {});

// Stored at the same lengths the entry and driver routes use, so a sign-up
// can't put a value on the account that those routes would have refused.
check("the racing name is capped at 60",
  userAccountUpdatesFromSignup({ profile: {}, name: "x".repeat(80) }).display_name.length, 60);
check("the number is capped at 3",
  userAccountUpdatesFromSignup({ profile: {}, number: "1234", name: "" }).number, "123");
// "0", "01" and "007" are real racing numbers and must survive as typed.
check("a leading-zero number survives",
  userAccountUpdatesFromSignup({ profile: {}, number: "007", name: "" }).number, "007");
check("zero is a number, not an absence",
  userAccountUpdatesFromSignup({ profile: { number: "0" }, number: "42", name: "" }), {});

// ── The driver profile half: merged, never replaced ───────────────────────
// The sign-up form only asks for what the game it's for requires, so writing
// its answers over the profile would drop every platform it didn't ask about.
const saved = normalizeAliases([
  { label: "Discord Name", value: "jane#1" },
  { label: "Steam Username", value: "janesteam" },
]);
const submitted = normalizeAliases([
  { label: "Discord Name", value: "jane#2" },
  { label: "iRacing ID#", value: "998877" },
]);
const merged = mergeAliases(saved, submitted);
const byLabel = Object.fromEntries(merged.map(a => [a.label, a.value]));
check("a new answer wins", byLabel["Discord Name"], "jane#2");
check("a platform this game didn't ask about survives", byLabel["Steam Username"], "janesteam");
check("a platform it did ask about is added", byLabel["iRacing ID#"], "998877");
// A blank submitted value must never erase a saved one.
const withBlank = mergeAliases(saved, normalizeAliases([{ label: "Steam Username", value: "" }]));
check("a blank answer never erases a saved one",
  withBlank.find(a => a.label === "Steam Username")?.value, "janesteam");

// ── What the form can fill in for you, before a profile exists ────────────
// Caught live: a brand-new player signed up for one series, then opened a
// second sign-up ten seconds later and was asked for their Discord name,
// Steam name and iRacing ID all over again — because their answers were on a
// request awaiting approval, and only the driver profile was being read.
const req1 = {
  created_at: "2026-01-01T10:00:00Z",
  aliases: normalizeAliases([
    { label: "Discord Name", value: "first#1" },
    { label: "Steam Username", value: "steamer" },
  ]),
};
const req2 = {
  created_at: "2026-01-02T10:00:00Z",
  aliases: normalizeAliases([{ label: "Discord Name", value: "second#2" }]),
};

const noProfile = aliasMapOf(knownAliasesFor({ driver: null, requests: [req1, req2] }));
check("a player with no profile is still remembered", noProfile["Steam Username"], "steamer");
check("and their most recent answer wins", noProfile["Discord Name"], "second#2");
check("order of arrival doesn't matter, timestamps do",
  aliasMapOf(knownAliasesFor({ driver: null, requests: [req2, req1] }))["Discord Name"], "second#2");

// Once the profile exists it is the record, and beats anything still queued.
const withProfile = aliasMapOf(knownAliasesFor({
  driver: { aliases: normalizeAliases([{ label: "Discord Name", value: "profile#3" }]) },
  requests: [req1, req2],
}));
check("the profile wins once there is one", withProfile["Discord Name"], "profile#3");
check("but never loses what only the requests knew", withProfile["Steam Username"], "steamer");

check("nothing known yet is an empty list", knownAliasesFor({}), []);
check("called with nothing doesn't throw", knownAliasesFor(), []);
// A brand-new player's answers ride on new_driver until approval.
check("a new driver's own answers count",
  aliasMapOf(knownAliasesFor({ requests: [
    { created_at: "2026-01-01", new_driver: { aliases: normalizeAliases([{ label: "Discord Name", value: "newbie#4" }]) } },
  ] }))["Discord Name"],
  "newbie#4");

// The name at the top of the form, remembered the same way.
check("the driver profile's name wins",
  knownRacingName({ driver: { name: "J. May" }, requests: [{ name: "Old Name" }] }), "J. May");
check("otherwise the newest sign-up's name",
  knownRacingName({ requests: [
    { created_at: "2026-01-01", name: "First Try" },
    { created_at: "2026-02-01", name: "Second Try" },
  ] }), "Second Try");
check("a new driver's requested name counts",
  knownRacingName({ requests: [{ created_at: "2026-01-01", new_driver: { name: "Newbie" } }] }), "Newbie");
check("otherwise a display name they chose",
  knownRacingName({ profile: { display_name: "Ghost", email: "jane.doe@example.com" } }), "Ghost");
// Never the placeholder: "jane.doe" is an email address, not a racing name.
check("never the placeholder sign-in invented",
  knownRacingName({ profile: { display_name: "jane.doe", email: "jane.doe@example.com" } }), "");
check("nothing known means an empty box", knownRacingName({}), "");
check("called with nothing doesn't throw", knownRacingName(), "");

console.log(`signupSync: ${n} assertions passed`);
