import { db } from "@/lib/firebase";

// Whether this installation makes people verify their email before they may use
// it — and, crucially, a way to turn that OFF without a redeploy.
//
// ── Why this is a setting and not a constant ───────────────────────────────
//
// The verification wall is the hardest gate in the app: an unverified account
// is refused by every API route and shown nothing but the "check your inbox"
// screen. That is the right default, and it is entirely safe right up until the
// moment email delivery stops working — at which point it locks out the whole
// league at once, including every new signup, with no way back in through the
// app itself. Email being the one dependency the app cannot test for itself
// makes that a question of when rather than whether.
//
// So the requirement lives in a document an Owner can flip in seconds, rather
// than in an environment variable that needs a rebuild and a deploy to change.
// When email is working it stays on. When it isn't, the league keeps racing.
//
// The env var is the DEFAULT, not the answer: REQUIRE_EMAIL_VERIFICATION=false
// stands an installation up with the wall off, and the stored setting overrides
// it either way once somebody has touched the switch.

export const AUTH_SETTINGS_COLLECTION = "app_settings";
export const AUTH_SETTINGS_DOC = "auth";

// Verification is required unless something explicitly says otherwise.
export function defaultRequireVerification() {
  return String(process.env.REQUIRE_EMAIL_VERIFICATION ?? "").trim().toLowerCase() !== "false";
}

// Coerce a stored document into the answer. Anything other than an explicit
// `false` reads as "required", so a half-written or hand-edited document can
// never accidentally take the wall down.
export function requireVerificationFrom(data, fallback) {
  if (!data || typeof data !== "object") return fallback;
  const value = data.require_email_verification;
  if (value === false) return false;
  if (value === true) return true;
  return fallback;
}

// Read within a request, memoized briefly. Every authenticated route asks this,
// so it must not be a Firestore read per call — but a league that has just
// switched the wall off needs it to take effect now, not in five minutes.
const TTL_MS = 15_000;
let cache = { value: null, at: 0 };

export async function requireEmailVerification() {
  const now = Date.now();
  if (cache.value !== null && now - cache.at < TTL_MS) return cache.value;
  let value = defaultRequireVerification();
  try {
    const doc = await db().collection(AUTH_SETTINGS_COLLECTION).doc(AUTH_SETTINGS_DOC).get();
    value = requireVerificationFrom(doc.exists ? doc.data() : null, value);
  } catch (err) {
    // Unreadable settings must not lock anybody out OR let everybody in
    // unexpectedly — fall back to whatever this deployment was configured with.
    console.error("Couldn't read auth settings; using the configured default", err);
  }
  cache = { value, at: now };
  return value;
}

// Called by the route that writes the setting so the switch is felt on the very
// next request rather than up to a TTL later.
export function forgetAuthSettings() {
  cache = { value: null, at: 0 };
}

export async function setRequireEmailVerification(required, { actorUid = null } = {}) {
  await db().collection(AUTH_SETTINGS_COLLECTION).doc(AUTH_SETTINGS_DOC).set({
    require_email_verification: !!required,
    updated_at: new Date().toISOString(),
    updated_by: actorUid,
  }, { merge: true });
  forgetAuthSettings();
  return !!required;
}
