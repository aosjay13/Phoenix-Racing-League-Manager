import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// The recovery passphrase: a secret a player sets themselves, so they can reset
// their own password IN THE APP with no email involved anywhere.
//
// ── Why a passphrase and not "your driver name" ────────────────────────────
//
// A reset flow is only as strong as the thing it checks. This league publishes
// display names on /api/users, driver names on /api/drivers, and both on every
// standings table and race result — so "prove it's you by naming your driver"
// asks for information anybody can read off the front page. That is not a
// weaker check than a password, it is no check at all: it would let any visitor
// take over any account, the Owner's included, and per-league roles mean that
// is the whole league.
//
// So the second factor is a real secret the account chooses and nobody else is
// ever shown. It is stored the way a password is stored — salted scrypt, never
// reversible, never sent to a client (see lib/userPrivacy.js) — because that is
// exactly what it is: a second password whose only job is to authorise setting
// the first one.
//
// ── Storage ────────────────────────────────────────────────────────────────
//
//   users/{uid}.recovery = {
//     algo: "scrypt", salt, hash, updated_at,
//     attempts: { count, first_at, locked_until },
//   }

export const RECOVERY_FIELD = "recovery";

// scrypt parameters. N=16384 is Node's default cost and is the usual starting
// point for an interactive check — it costs a few tens of milliseconds, which is
// the point: it is what makes offline guessing expensive if the hash ever leaks.
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_COST = 16384;

export function hashPassphrase(passphrase, salt = randomBytes(SALT_BYTES).toString("hex")) {
  const hash = scryptSync(String(passphrase), salt, KEY_LENGTH, { N: SCRYPT_COST }).toString("hex");
  return { algo: "scrypt", salt, hash, updated_at: new Date().toISOString() };
}

// Constant-time comparison, so a near-miss can't be told from a wild guess by
// how long the answer took.
export function verifyPassphrase(passphrase, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  try {
    const candidate = scryptSync(String(passphrase), stored.salt, KEY_LENGTH, { N: SCRYPT_COST });
    const expected = Buffer.from(stored.hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function hasRecoveryPassphrase(data) {
  const rec = data?.[RECOVERY_FIELD];
  return !!(rec && rec.salt && rec.hash);
}

// ── Guessing is the real attack ────────────────────────────────────────────
//
// A passphrase check that anybody may call, unauthenticated, is a password
// oracle unless wrong answers cost something. Five wrong tries inside the
// window locks the account's RECOVERY path (not the account) for a cooling-off
// period; a correct one clears the counter. Signing in normally is untouched
// either way, so a griefer can annoy somebody but never lock them out.
export const MAX_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

// Pure so the rules can be tested without a clock or a database: given what is
// stored and the time now, is this account allowed another try?
export function attemptStatus(stored, now = Date.now()) {
  const a = stored?.attempts;
  if (!a) return { locked: false, count: 0, retryAfterMs: 0 };
  const lockedUntil = Date.parse(a.locked_until || "") || 0;
  if (lockedUntil > now) {
    return { locked: true, count: a.count || 0, retryAfterMs: lockedUntil - now };
  }
  // The window has rolled over: whatever was counted before is history.
  const firstAt = Date.parse(a.first_at || "") || 0;
  if (!firstAt || now - firstAt > ATTEMPT_WINDOW_MS) {
    return { locked: false, count: 0, retryAfterMs: 0 };
  }
  return { locked: false, count: a.count || 0, retryAfterMs: 0 };
}

// The `attempts` object to store after a failure. Returns the new state and
// whether this failure is the one that locks it.
export function recordFailure(stored, now = Date.now()) {
  const status = attemptStatus(stored, now);
  const count = status.count + 1;
  const locked = count >= MAX_ATTEMPTS;
  return {
    attempts: {
      count,
      first_at: status.count === 0
        ? new Date(now).toISOString()
        : (stored?.attempts?.first_at || new Date(now).toISOString()),
      locked_until: locked ? new Date(now + LOCKOUT_MS).toISOString() : null,
    },
    locked,
    remaining: Math.max(0, MAX_ATTEMPTS - count),
  };
}

// Cleared on success, so somebody who mistyped four times and then got it right
// isn't one slip away from a lockout next month.
export function clearedAttempts() {
  return { count: 0, first_at: null, locked_until: null };
}

// "Try again in 12 minutes" — rounded up, because "in 0 minutes" is a lie.
export function retryAfterText(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
