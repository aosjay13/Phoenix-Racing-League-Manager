// In-app password reset: the recovery passphrase, the guess throttle, and the
// rule that keeps the hash off the wire.
//
// This flow replaces an emailed reset link with a second secret, and that is a
// real trade rather than a free win: the account is now as strong as the weaker
// of two secrets instead of one secret plus control of an inbox. It is worth it
// only while three things hold, and all three are the kind that a later change
// undoes without noticing:
//
//   1. THE CHALLENGE IS A SECRET. The obvious cheap version of this feature is
//      "confirm your driver name" — and this app publishes driver names on
//      /api/users, /api/drivers and every standings table. A check against
//      public information is not a weak door, it is an open one, and it would
//      hand over the Owner's account to anyone who can read the front page.
//      Hence a passphrase with a real length floor.
//   2. GUESSING COSTS SOMETHING. An unauthenticated endpoint that says yes or no
//      to a secret is a password oracle unless wrong answers are rationed.
//   3. THE HASH NEVER LEAVES THE SERVER. Four routes hand user documents to
//      browsers by SPREADING them, so a new field is published by default. The
//      strip list is what stops that, and it only works if it is actually used.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryPassphraseCard } from "@/components/RecoveryPassphraseCard";
import {
  MIN_PASSWORD_LENGTH, MIN_RECOVERY_LENGTH, adminSetPasswordError, directResetError,
  recoveryPassphraseError, suggestPassword,
} from "@/lib/authFlows";
import {
  ATTEMPT_WINDOW_MS, LOCKOUT_MS, MAX_ATTEMPTS, RECOVERY_FIELD, attemptStatus, clearedAttempts,
  hasRecoveryPassphrase, hashPassphrase, recordFailure, retryAfterText, verifyPassphrase,
} from "@/lib/recoveryServer";
import {
  PRIVATE_USER_FIELDS, publicUserFields, selfUserFields,
} from "@/lib/userPrivacy";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// ── 1. The passphrase is a real secret ─────────────────────────────────────

ok("the floor is higher than a password's", MIN_RECOVERY_LENGTH > MIN_PASSWORD_LENGTH);

const goodPhrase = "correct horse battery";
check("a long phrase is accepted",
  recoveryPassphraseError({ passphrase: goodPhrase, confirm: goodPhrase }), null);
check("nothing at all is refused", recoveryPassphraseError(), "Enter a recovery passphrase.");
ok("a mistyped confirmation is refused",
  /don't match/i.test(recoveryPassphraseError({ passphrase: goodPhrase, confirm: "something else" })));

// The length floor, on both sides of the boundary. A driver name is typically
// under it, which is the point: the cheap wrong version of this feature can't
// slip through the same validator.
const tooShort = "x".repeat(MIN_RECOVERY_LENGTH - 1);
const exact = "y".repeat(MIN_RECOVERY_LENGTH);
ok("one character under the floor is refused",
  /at least/i.test(recoveryPassphraseError({ passphrase: tooShort, confirm: tooShort })));
check("exactly the floor is accepted",
  recoveryPassphraseError({ passphrase: exact, confirm: exact }), null);
// Padding it out with spaces doesn't count — the stored secret is trimmed.
ok("whitespace doesn't pad a short phrase over the line",
  recoveryPassphraseError({ passphrase: "abc         ", confirm: "abc         " }) !== null);

// ── 2. Hashing and verification ────────────────────────────────────────────

const stored = hashPassphrase(goodPhrase);
ok("the stored record carries a salt", !!stored.salt);
ok("…and a hash", !!stored.hash);
ok("…and the plaintext appears nowhere in it", !JSON.stringify(stored).includes(goodPhrase));
ok("…and records when it was set", !!stored.updated_at);
ok("the right phrase verifies", verifyPassphrase(goodPhrase, stored));
ok("a wrong phrase doesn't", !verifyPassphrase("wrong horse battery", stored));
ok("a near miss doesn't either", !verifyPassphrase(`${goodPhrase} `, stored));
ok("an empty guess doesn't", !verifyPassphrase("", stored));
// Two accounts choosing the same phrase must not produce the same hash, or one
// leaked hash would out every account sharing it.
ok("the same phrase hashes differently for two accounts",
  hashPassphrase(goodPhrase).hash !== hashPassphrase(goodPhrase).hash);
// Nothing to verify against is a refusal, never a crash or a pass.
for (const junk of [null, undefined, {}, { salt: "abc" }, { hash: "abc" }]) {
  ok(`${JSON.stringify(junk)} verifies nothing`, !verifyPassphrase(goodPhrase, junk));
}
ok("an account with a stored record has one configured",
  hasRecoveryPassphrase({ [RECOVERY_FIELD]: stored }));
ok("an account with none doesn't", !hasRecoveryPassphrase({ display_name: "Driver" }));
ok("a half-written record doesn't count as configured",
  !hasRecoveryPassphrase({ [RECOVERY_FIELD]: { salt: "abc" } }));

// ── 3. Guessing costs something ────────────────────────────────────────────

const t0 = 1_700_000_000_000;

check("a fresh account is not locked", attemptStatus(null, t0), { locked: false, count: 0, retryAfterMs: 0 });

// Walk the counter up to the lock, one failure at a time.
let attempts = null;
for (let i = 1; i < MAX_ATTEMPTS; i++) {
  const failure = recordFailure({ attempts }, t0 + i * 1000);
  attempts = failure.attempts;
  ok(`failure ${i} does not lock yet`, !failure.locked);
  ok(`…and says how many tries are left`, failure.remaining === MAX_ATTEMPTS - i);
}
const last = recordFailure({ attempts }, t0 + MAX_ATTEMPTS * 1000);
ok(`failure ${MAX_ATTEMPTS} locks it`, last.locked);
ok("…and stamps when the lock lifts", !!last.attempts.locked_until);
ok("…and leaves no tries", last.remaining === 0);

// While locked, the status says so and how long is left.
const lockedStatus = attemptStatus({ attempts: last.attempts }, t0 + MAX_ATTEMPTS * 1000 + 60_000);
ok("a locked account reports locked", lockedStatus.locked);
ok("…with time remaining", lockedStatus.retryAfterMs > 0);
ok("…that is under the full lockout, since some has elapsed", lockedStatus.retryAfterMs < LOCKOUT_MS);

// Once the lockout expires the account can try again.
const afterLock = attemptStatus({ attempts: last.attempts }, t0 + MAX_ATTEMPTS * 1000 + LOCKOUT_MS + 1);
ok("the lock lifts on its own", !afterLock.locked);
check("…and the counter has rolled over with the window", afterLock.count, 0);

// A slow guesser doesn't accumulate forever: the window rolls.
const stale = { attempts: { count: 3, first_at: new Date(t0).toISOString(), locked_until: null } };
check("failures outside the window are forgotten",
  attemptStatus(stale, t0 + ATTEMPT_WINDOW_MS + 1).count, 0);
check("failures inside it still count", attemptStatus(stale, t0 + 60_000).count, 3);

// Getting it right wipes the slate — four mistypes last month must not leave
// somebody one slip from a lockout.
check("success clears the counter", clearedAttempts(), { count: 0, first_at: null, locked_until: null });
check("a cleared record reads as unlocked",
  attemptStatus({ attempts: clearedAttempts() }, t0), { locked: false, count: 0, retryAfterMs: 0 });

// "in 0 minutes" is a lie, so the floor is one.
check("a few seconds still reads as a minute", retryAfterText(1500), "1 minute");
check("…and minutes are pluralised", retryAfterText(12 * 60_000), "12 minutes");

// ── 4. The hash never leaves the server ────────────────────────────────────

const account = {
  display_name: "J. May", email: "j@example.com", photo_url: null, bio: "Slow but happy",
  role: "owner", league_roles: { leagueA: "owner" },
  signup_pending: false, verified_by_owner: { uid: "x" },
  [RECOVERY_FIELD]: stored,
};

ok("the recovery record is on the private list", PRIVATE_USER_FIELDS.includes(RECOVERY_FIELD));

const own = selfUserFields(account);
ok("the account's own view keeps its profile", own.display_name === "J. May");
ok("…and its standing", !!own.league_roles);
ok("…but NOT the passphrase hash", own[RECOVERY_FIELD] === undefined);

const pub = publicUserFields(account);
ok("a public view keeps the display name", pub.display_name === "J. May");
ok("…and the bio", pub.bio === "Slow but happy");
ok("…but not the email", pub.email === undefined);
ok("…nor the role", pub.role === undefined);
ok("…nor the per-league standing", pub.league_roles === undefined);
ok("…nor the passphrase hash", pub[RECOVERY_FIELD] === undefined);
ok("…nor the account's housekeeping", pub.verified_by_owner === undefined);
// The whole point is that a spread can't republish it: nothing that looks like
// the stored secret survives serialization.
ok("no trace of the salt survives a public view", !JSON.stringify(pub).includes(stored.salt));
ok("no trace of the hash survives a public view", !JSON.stringify(pub).includes(stored.hash));
// Stripping must not mutate the document the caller still holds.
ok("stripping leaves the original alone", account[RECOVERY_FIELD] === stored);
check("nothing at all strips to an empty object", publicUserFields(null), {});

// ── 5. The reset and set-password forms ────────────────────────────────────

const reset = { email: "j@example.com", passphrase: goodPhrase, next: "brand-new-one", confirm: "brand-new-one" };
check("a complete reset form is accepted", directResetError(reset), null);
check("no form at all is refused", directResetError(), "Enter the email address you sign in with.");
ok("an address without an @ is refused", directResetError({ ...reset, email: "nope" }) !== null);
ok("a missing passphrase is refused",
  /recovery passphrase/i.test(directResetError({ ...reset, passphrase: "" })));
ok("a short new password is refused",
  /at least/i.test(directResetError({ ...reset, next: "abc", confirm: "abc" })));
ok("a mistyped confirmation is refused",
  /don't match/i.test(directResetError({ ...reset, confirm: "different" })));

check("an Owner setting a password just needs it typed twice",
  adminSetPasswordError({ next: "brand-new-one", confirm: "brand-new-one" }), null);
ok("…and refuses a short one",
  /at least/i.test(adminSetPasswordError({ next: "abc", confirm: "abc" })));
ok("…and a mismatch", /don't match/i.test(adminSetPasswordError({ next: "aaaaaaaa", confirm: "bbbbbbbb" })));

// The generated password an Owner reads out loud.
const suggested = suggestPassword(16, max => 0);   // deterministic for the test
check("a generated password is the length asked for", suggested.length, 16);
const real = suggestPassword();
ok("a real one clears the password floor", real.length >= MIN_PASSWORD_LENGTH);
ok("…and avoids the characters that get misread aloud", !/[0O1lI]/.test(real));
check("…and is accepted by the form it's generated for",
  adminSetPasswordError({ next: real, confirm: real }), null);

// ── 6. The card mounts ─────────────────────────────────────────────────────
n += 1;
let html;
try {
  html = renderToStaticMarkup(<RecoveryPassphraseCard />);
} catch (err) {
  assert.fail(`RecoveryPassphraseCard failed to mount: ${err.message}`);
}
ok("the card names itself", html.includes("Recovery Passphrase"));
ok("…and says it needs no email", /no email/i.test(html));

console.log(`directReset: ${n} checks passed`);
