// The decisions behind sign-up, sign-in and password management, kept apart
// from the Firebase calls that carry them out.
//
// Everything here is pure, so the rules that are easy to get quietly wrong —
// which league a new account joins, what a failure is allowed to reveal, when a
// password change may proceed — can be unit-tested without a browser or a
// Firebase project. `app/login/page.js`, `app/account/page.js` and
// `components/UserAccountsManager.jsx` supply the SDK calls around them.

// ── Which league does a new account join? ───────────────────────────────────
//
// An authentication account is global; standing in a league is not (see
// lib/leagueRoles.js). So signing up has to say WHICH league the new account is
// joining, and the honest answer is "the one they were looking at when they
// pressed the button".
//
// Three sources, in priority order, because they answer three different
// questions:
//
//   1. The URL (`?league=…`). Someone who followed a league's own sign-up link
//      is telling us explicitly, and that must beat anything the browser
//      remembers from a previous visit.
//   2. The active league in LeagueProvider — the switcher's current answer,
//      which is what the rest of the page is showing.
//   3. localStorage, the same value api() stamps as X-League-Id. The fallback
//      for the moment before the league list has resolved.
//
// An empty string at every level means "no league selected" — a pre-migration
// install with no leagues at all. That is not an error: the account is created
// and joins nothing, exactly as it would have before leagues existed.
export function signupLeagueId({ urlLeague, activeLeague, storedLeague } = {}) {
  for (const candidate of [urlLeague, activeLeague, storedLeague]) {
    const id = String(candidate ?? "").trim();
    if (id) return id;
  }
  return "";
}

// ── What a failure is allowed to say ───────────────────────────────────────
//
// Firebase error codes are precise and, on the sign-in path, too precise: told
// apart, "no such account" and "wrong password" turn the login form into a
// tool for discovering who has an account here. So on that path the two
// collapse into one message.
//
// The password-RESET path is the deliberate exception, and resetOutcome below
// explains why: an answer vague enough to protect the account list is also
// vague enough to hide an outage, and this one was hiding one.
//
// `context` narrows the wording — the same code means different things when
// changing a password than when signing in.
const GENERIC = "Something went wrong. Try again.";

export function friendlyAuthError(err, context = "signin") {
  const code = String(err?.code || err?.message || "");

  // Rate limiting reads the same everywhere and is worth saying plainly, so
  // nobody keeps hammering a button that is already refusing them.
  if (code.includes("too-many-requests")) {
    // The verification wall's only action is sending an email, so "attempts"
    // would be describing something the person can't see.
    return context === "verify"
      ? "Too many emails sent. Wait a minute, then try again."
      : "Too many attempts. Wait a minute, then try again.";
  }
  if (code.includes("network-request-failed")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (code.includes("invalid-email")) return "That doesn't look like an email address.";

  if (context === "signup") {
    if (code.includes("email-already-in-use")) return "An account with that email already exists.";
    if (code.includes("weak-password")) return "Password must be at least 6 characters.";
    if (code.includes("operation-not-allowed")) return "Email sign-up isn't enabled for this league yet.";
  }

  if (context === "signin") {
    // Deliberately one message for both. See the note above.
    if (code.includes("invalid-credential") || code.includes("wrong-password")
      || code.includes("user-not-found") || code.includes("invalid-login-credentials")) {
      return "Email or password is incorrect.";
    }
    if (code.includes("user-disabled")) return "That account has been disabled. Contact a league admin.";
  }

  if (context === "password") {
    if (code.includes("requires-recent-login")) {
      return "For your security, sign in again before changing your password.";
    }
    if (code.includes("invalid-credential") || code.includes("wrong-password")
      || code.includes("invalid-login-credentials")) {
      return "That current password isn't right.";
    }
    if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  }

  return err?.message || GENERIC;
}

// Firebase asks for a fresh sign-in before a password change on a session that
// has been open a while. It is not a failure the user caused, and it has a
// specific remedy — re-enter the current password — so callers tell it apart
// from everything else.
export function isRecentLoginRequired(err) {
  return String(err?.code || err?.message || "").includes("requires-recent-login");
}

// ── The password-reset answer ──────────────────────────────────────────────
//
// This block holds two behaviours, one flag apart, and the reason is worth
// stating plainly.
//
// There is a genuine tension. Reporting an unknown address as an error tells
// anyone with the form whether a given email has an account — the form becomes
// an address checker. Reporting it as a success hides that, which is what
// Firebase's own email-enumeration protection does when a project has it turned
// on. So the safe answer is the vague one.
//
// But the vague answer is also indistinguishable from an outage. When a reset
// email is not arriving, "if that email has an account, a link is on its way" is
// exactly what a working system, a mistyped address, a missing API key and an
// undelivered email all say — which is how a broken deploy stayed invisible long
// enough to be reported as "nothing happens".
//
//   revealDetail: true   (the default) — say exactly what Firebase said, code
//                        and all. What you want while delivery is in doubt.
//   revealDetail: false  — the neutral answer, for turning enumeration
//                          protection back on once it is working.
//
// Both are tested. Flipping the default below is the whole change.

// Shown when Firebase accepted the request. It names the spam folder on
// purpose: by far the most common "it didn't send" is that it did.
export const RESET_SENT_MESSAGE =
  "Password reset email sent! Please check your inbox and your spam/junk folder.";

// The enumeration-safe wording, used when revealDetail is off.
export const RESET_NEUTRAL_MESSAGE =
  "If that email has an account, a password reset link is on its way. Check your inbox and spam.";

// The raw Firebase code and message, formatted to be read off a screen and
// pasted into a bug report. `auth/user-not-found`, `auth/invalid-email`,
// `auth/invalid-api-key` and friends are the entire point — mapping these to
// prose is what made the failure impossible to diagnose from the outside.
export function firebaseErrorDetail(err) {
  const code = String(err?.code || "").trim();
  const message = String(err?.message || "").trim();
  if (code && message) return `${code} — ${message}`;
  return code || message || "Unknown error";
}

// Did Firebase say this address has no account? Called out on its own because
// it is the answer that most often looks like an outage and isn't: nothing was
// sent because there was nobody to send to.
export function isUnknownAccount(err) {
  return String(err?.code || err?.message || "").includes("user-not-found");
}

export function resetOutcome(err, { revealDetail = true } = {}) {
  if (!err) return { ok: true, message: RESET_SENT_MESSAGE };

  if (!revealDetail) {
    // Enumeration-safe: an unknown address is reported exactly like a known one.
    if (isUnknownAccount(err)) return { ok: true, message: RESET_NEUTRAL_MESSAGE };
    return { ok: false, message: friendlyAuthError(err, "reset") };
  }

  if (isUnknownAccount(err)) {
    return {
      ok: false,
      code: "auth/user-not-found",
      message: "No account exists with that email address, so no reset email was sent. "
        + "Check the spelling, or create an account instead. (auth/user-not-found)",
    };
  }
  return {
    ok: false,
    code: err?.code || null,
    // The plain sentence AND the raw code, in that order: the first is for the
    // person trying to sign in, the second for whoever they send the screenshot
    // to.
    message: `${friendlyAuthError(err, "reset")} (${firebaseErrorDetail(err)})`,
  };
}

// ── Changing a password ────────────────────────────────────────────────────

// Firebase's own floor. Stated here so the form can refuse a too-short password
// before making a round trip, and say the same thing the server would.
export const MIN_PASSWORD_LENGTH = 6;

// Everything that has to be true before a change is worth attempting. Returns
// an error string, or null when the form is good. Checked in one place so the
// button's disabled state and the submit handler can never disagree.
export function passwordChangeError({ current = "", next = "", confirm = "" } = {}) {
  if (!current) return "Enter your current password.";
  if (!next) return "Enter a new password.";
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (next !== confirm) return "The new passwords don't match.";
  if (next === current) return "That's the password you already have. Pick a different one.";
  return null;
}

// Does this account sign in with a password at all? An account created through
// a federated provider (or a future magic-link flow) has nothing here to
// change, and telling them so beats a Firebase error they can't act on.
export const PASSWORD_PROVIDER = "password";

export function hasPasswordSignIn(user) {
  const providers = user?.providerData;
  if (!Array.isArray(providers) || !providers.length) return true;   // unknown: let them try
  return providers.some(p => p?.providerId === PASSWORD_PROVIDER);
}
