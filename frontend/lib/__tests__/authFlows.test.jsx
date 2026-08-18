// Sign-up, sign-in and password management.
//
// Three of these rules are the kind that fail silently and expensively:
//
//   1. WHICH LEAGUE a new account joins. Standing in a league is per-league
//      data (lib/leagueRoles.js), so a sign-up that resolves the wrong league —
//      or none — leaves a player invisible to the very league whose page they
//      joined from, with nothing on screen to say so.
//   2. WHAT A FAILURE REVEALS. Told apart, "no such account" and "wrong
//      password" turn a login form into a tool for finding out who has an
//      account here, and a reset form into one for checking an address. Both
//      have to stay deliberately vague, and "deliberately vague" is exactly the
//      sort of thing a later tidy-up helpfully undoes.
//   3. WHEN A PASSWORD CHANGE MAY PROCEED. The form's disabled state and its
//      submit handler ask the same question; if they ever disagree, one of them
//      is wrong.
//
// So all three are pinned here, along with a render assertion on the password
// card — the same guard the League Setup suite has, because a component's
// imports are only resolved when it mounts.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordChangeCard } from "@/components/PasswordChangeCard";
import {
  MIN_PASSWORD_LENGTH, PASSWORD_PROVIDER, RESET_NEUTRAL_MESSAGE, RESET_SENT_MESSAGE,
  firebaseErrorDetail, friendlyAuthError, hasPasswordSignIn, isRecentLoginRequired,
  isUnknownAccount, passwordChangeError, resetOutcome, signupLeagueId,
} from "@/lib/authFlows";
import { FIREBASE_CONFIG_VARS, missingFirebaseConfig } from "@/lib/firebaseClient";
import { defaultRequireVerification, requireVerificationFrom } from "@/lib/authSettings";
import { preferredLeagueId } from "@/components/LeagueProvider";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

const A = "leagueAAA111";
const B = "leagueBBB222";
const C = "leagueCCC333";

// A Firebase error, in the shape the SDK actually throws.
const fbErr = code => ({ code, message: `Firebase: Error (${code}).` });

// ── 1. Which league a new account joins ────────────────────────────────────

check("a league named in the URL wins",
  signupLeagueId({ urlLeague: A, activeLeague: B, storedLeague: C }), A);
check("without a URL, the switcher's league answers",
  signupLeagueId({ activeLeague: B, storedLeague: C }), B);
check("without either, the stored league answers",
  signupLeagueId({ storedLeague: C }), C);
check("nothing anywhere is a blank, not a crash", signupLeagueId(), "");
check("no arguments at all is still a blank", signupLeagueId({}), "");

// The URL param can legitimately be "" — an explicit "All …" from a scope link
// (see lib/scopeLink.js). That is not a league, so it must fall through rather
// than being taken as one and written into somebody's role map.
check("an explicit All-… in the URL falls through to the active league",
  signupLeagueId({ urlLeague: "", activeLeague: B }), B);
check("whitespace is not a league id", signupLeagueId({ urlLeague: "   ", activeLeague: B }), B);
// null / undefined from a provider that hasn't resolved yet.
check("an unresolved league falls through",
  signupLeagueId({ urlLeague: null, activeLeague: undefined, storedLeague: C }), C);

// ── 2. What a failure is allowed to reveal ─────────────────────────────────

// THE enumeration guard: both of these must produce the SAME sentence, or the
// form tells an attacker which addresses have accounts.
const wrongPassword = friendlyAuthError(fbErr("auth/wrong-password"), "signin");
const noSuchUser = friendlyAuthError(fbErr("auth/user-not-found"), "signin");
check("a wrong password and an unknown account read identically", wrongPassword, noSuchUser);
ok("…and neither of them names the account", !/exist|found|registered/i.test(wrongPassword));
// The modern code Firebase returns for both.
check("the modern combined code reads the same too",
  friendlyAuthError(fbErr("auth/invalid-credential"), "signin"), wrongPassword);

// Sign-UP is different, and deliberately so: "that email is taken" is something
// the person needs to hear to get past the form, and they have just proved they
// can receive mail at it anyway.
ok("sign-up does say when an email is already taken",
  /already exists/i.test(friendlyAuthError(fbErr("auth/email-already-in-use"), "signup")));
check("a weak password says the actual rule",
  friendlyAuthError(fbErr("auth/weak-password"), "signup"),
  "Password must be at least 6 characters.");

// Rate limiting and connectivity read the same in every context — they are
// about the request, not the account.
for (const context of ["signin", "signup", "reset", "password", "verify"]) {
  ok(`${context}: rate limiting is said plainly`,
    /too many/i.test(friendlyAuthError(fbErr("auth/too-many-requests"), context)));
}
ok("a dead connection says so rather than blaming the password",
  /connection/i.test(friendlyAuthError(fbErr("auth/network-request-failed"), "signin")));
// The verification wall only ever sends emails, so it says so.
ok("the verification wall counts emails, not attempts",
  /emails sent/i.test(friendlyAuthError(fbErr("auth/too-many-requests"), "verify")));

// The password-change context has its own vocabulary.
ok("changing a password names the current-password field when it's wrong",
  /current password/i.test(friendlyAuthError(fbErr("auth/wrong-password"), "password")));
ok("a stale session asks for a fresh sign-in",
  /sign in again/i.test(friendlyAuthError(fbErr("auth/requires-recent-login"), "password")));
ok("requires-recent-login is recognised as its own case",
  isRecentLoginRequired(fbErr("auth/requires-recent-login")));
ok("…and an ordinary wrong password is not",
  !isRecentLoginRequired(fbErr("auth/wrong-password")));
ok("nothing at all isn't a recent-login problem", !isRecentLoginRequired(null));

// Anything unrecognised still says something rather than nothing.
ok("an unknown failure still produces a sentence",
  friendlyAuthError(new Error("kaboom"), "signin").length > 0);
ok("a thrown nothing still produces a sentence",
  friendlyAuthError(undefined, "signin").length > 0);

// ── The reset form, in both of its modes ───────────────────────────────────
//
// The default is DIAGNOSTIC: say exactly what Firebase said. That is the mode
// this app runs in, because the alternative — an answer vague enough to protect
// the account list — is also vague enough to hide a total delivery outage, and
// it did. The enumeration-safe mode is kept, and kept tested, so it can be
// turned back on with one flag once delivery is trusted again.

// A send Firebase accepted. The wording has one job beyond saying "sent": the
// most common "it didn't arrive" is that it did, into spam.
check("an accepted send reports success", resetOutcome(null), { ok: true, message: RESET_SENT_MESSAGE });
ok("…and the success message names the spam folder", /spam/i.test(RESET_SENT_MESSAGE));
ok("…and says plainly that it was sent", /sent/i.test(RESET_SENT_MESSAGE));

// THE bug this release fixes: an address with no account used to be reported as
// a success, so the single most common cause of "nothing happened" was
// indistinguishable from working. It is now an error that names itself.
const unknown = resetOutcome(fbErr("auth/user-not-found"));
ok("an unknown address is an error, not a silent success", unknown.ok === false);
ok("…and it says which Firebase code it was", /auth\/user-not-found/.test(unknown.message));
ok("…and tells the person what to do about it", /spelling|create an account/i.test(unknown.message));

// Every other failure carries the raw code through to the screen, so a report of
// "it didn't work" can say which failure it was.
for (const code of ["auth/invalid-email", "auth/too-many-requests", "auth/invalid-api-key",
  "auth/network-request-failed", "auth/operation-not-allowed"]) {
  const out = resetOutcome(fbErr(code));
  ok(`${code} is reported as a real error`, out.ok === false);
  ok(`${code} appears verbatim in what the user is shown`, out.message.includes(code));
}

// The raw detail formatter, which is what makes the above true.
ok("the detail carries code and message together",
  firebaseErrorDetail(fbErr("auth/invalid-email")).includes("auth/invalid-email"));
check("an error with no code at all still says something",
  firebaseErrorDetail(new Error("boom")), "boom");
check("a thrown nothing still says something", firebaseErrorDetail(null), "Unknown error");
ok("an unknown account is recognised", isUnknownAccount(fbErr("auth/user-not-found")));
ok("…and a malformed address is not", !isUnknownAccount(fbErr("auth/invalid-email")));

// ── The enumeration-safe mode still works ──────────────────────────────────
//
// Kept tested so turning it back on is a one-flag change and not a rewrite.
const safe = { revealDetail: false };
check("safe mode reports an unknown address as a success",
  resetOutcome(fbErr("auth/user-not-found"), safe), { ok: true, message: RESET_NEUTRAL_MESSAGE });
ok("…and the neutral message promises nothing about the account existing",
  /if that email has an account/i.test(RESET_NEUTRAL_MESSAGE));
ok("safe mode still surfaces a malformed address",
  resetOutcome(fbErr("auth/invalid-email"), safe).ok === false);
ok("safe mode leaks no raw code",
  !resetOutcome(fbErr("auth/invalid-email"), safe).message.includes("auth/"));

// ── A build missing its Firebase variables says so ─────────────────────────
//
// The other way a reset "silently fails": NEXT_PUBLIC_* values are inlined at
// BUILD time, so a deploy built without them ships a bundle that cannot talk to
// Firebase at all — and every symptom shows up as a failure of whatever the
// visitor was doing. The test environment has none of them set, which is exactly
// the broken-deploy case.
check("every client variable Auth needs is named",
  Object.values(FIREBASE_CONFIG_VARS).sort(),
  ["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"]);
ok("a build with no config reports every variable by its env-var name",
  missingFirebaseConfig().every(v => v.startsWith("NEXT_PUBLIC_FIREBASE_")));
ok("…and reports all three when none are set", missingFirebaseConfig().length === 3);

// ── 3. When a password change may proceed ──────────────────────────────────

const good = { current: "old-secret", next: "brand-new-one", confirm: "brand-new-one" };
check("a complete, consistent form is accepted", passwordChangeError(good), null);
check("no form at all is refused rather than crashing",
  passwordChangeError(), "Enter your current password.");

ok("the current password is required",
  passwordChangeError({ ...good, current: "" }) === "Enter your current password.");
ok("a new password is required",
  passwordChangeError({ ...good, next: "", confirm: "" }) === "Enter a new password.");
ok("a mistyped confirmation is refused",
  /don't match/i.test(passwordChangeError({ ...good, confirm: "something-else" })));
ok("re-using the same password is refused",
  /already have/i.test(passwordChangeError({ current: "same-one", next: "same-one", confirm: "same-one" })));

// The length floor, on both sides of the boundary — this is the check the
// browser's own minLength attribute duplicates, and the two must agree.
const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
const exact = "y".repeat(MIN_PASSWORD_LENGTH);
ok("one character under the floor is refused",
  /at least/i.test(passwordChangeError({ current: "old", next: short, confirm: short })));
check("exactly the floor is accepted",
  passwordChangeError({ current: "old", next: exact, confirm: exact }), null);

// ── Accounts with no password to change ────────────────────────────────────

ok("an email/password account can change its password",
  hasPasswordSignIn({ providerData: [{ providerId: PASSWORD_PROVIDER }] }));
ok("a federated-only account cannot",
  !hasPasswordSignIn({ providerData: [{ providerId: "google.com" }] }));
ok("an account with both can",
  hasPasswordSignIn({ providerData: [{ providerId: "google.com" }, { providerId: PASSWORD_PROVIDER }] }));
// Unknown is not the same as "no". A user object we can't read must not have
// the form hidden from it — better to let them try and see a real error.
ok("an unreadable account is given the benefit of the doubt", hasPasswordSignIn(null));
ok("an empty provider list is too", hasPasswordSignIn({ providerData: [] }));

// ── 4. The verification wall, and the switch that takes it down ────────────
//
// The wall refuses every account Firebase hasn't confirmed, and the only thing
// that normally confirms one is an email — so when delivery stops it locks out
// the whole league at once, including everybody who could otherwise fix it.
// These are the rules that decide whether it stands.

check("verification is required by default", requireVerificationFrom(null, true), true);
check("a missing document leaves the default alone", requireVerificationFrom(undefined, true), true);
check("an explicit false takes the wall down", requireVerificationFrom({ require_email_verification: false }, true), false);
check("an explicit true puts it back", requireVerificationFrom({ require_email_verification: true }, false), true);
// Anything OTHER than an explicit boolean must not move the wall. A half-written
// or hand-edited document taking the gate down for the whole installation is
// exactly the accident this guards against.
for (const junk of [{}, { require_email_verification: "false" }, { require_email_verification: 0 },
  { require_email_verification: null }, "nonsense", 42]) {
  check(`${JSON.stringify(junk)} leaves the wall standing`, requireVerificationFrom(junk, true), true);
  check(`${JSON.stringify(junk)} also leaves it down if that was the default`,
    requireVerificationFrom(junk, false), false);
}

check("the env default is 'required' unless something says otherwise",
  defaultRequireVerification(), true);

// ── 5. Which league an account opens on ────────────────────────────────────
//
// Roles are per league, so opening on the wrong one shows an Owner an app with
// every admin control missing and nothing on screen explaining why. It reads
// exactly like a permissions bug, and it was reported as one. The rule: open on
// a league this account actually holds standing in, preferring the strongest.

const leagues = [{ id: A, name: "Alpha" }, { id: B, name: "Bravo" }, { id: C, name: "Charlie" }];

check("an account opens on the league it owns",
  preferredLeagueId(leagues, { [B]: "owner" }), B);
check("staff standing beats a plain membership",
  preferredLeagueId(leagues, { [A]: "player", [C]: "admin" }), C);
check("the strongest role wins between two staff standings",
  preferredLeagueId(leagues, { [A]: "moderator", [B]: "owner" }), B);
check("a single membership is used even when it's only Player",
  preferredLeagueId(leagues, { [C]: "player" }), C);
// No standing anywhere → null, so the caller falls back to the oldest league
// rather than being handed a league that doesn't exist.
check("no standing anywhere defers to the caller", preferredLeagueId(leagues, {}), null);
check("no role map at all defers to the caller", preferredLeagueId(leagues, null), null);
check("no leagues at all defers to the caller", preferredLeagueId([], { [A]: "owner" }), null);
check("a role naming a league that no longer exists is ignored",
  preferredLeagueId(leagues, { "deletedLeague": "owner" }), null);
// A signed-out visitor has no roles; the caller's list[0] fallback applies.
check("a signed-out visitor defers to the caller", preferredLeagueId(leagues, undefined), null);

// ── 6. The card mounts ─────────────────────────────────────────────────────
//
// Mounted with no providers, so useAuth falls back to its signed-out default.
// Enough to prove every import resolves and the form renders — the failure this
// catches is a missing import, which throws only at render time and takes the
// whole page down behind the error boundary.
n += 1;
let html;
try {
  html = renderToStaticMarkup(<PasswordChangeCard />);
} catch (err) {
  assert.fail(`PasswordChangeCard failed to mount: ${err.message}`);
}
ok("the card renders its three password fields",
  (html.match(/type="password"/g) || []).length === 3);
ok("it asks for the current password first", html.indexOf("Current Password") < html.indexOf("New Password"));
ok("the submit button starts disabled on an empty form", /disabled=""/.test(html));

console.log(`authFlows: ${n} checks passed`);
