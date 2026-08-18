import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { MIN_PASSWORD_LENGTH } from "@/lib/authFlows";
import {
  RECOVERY_FIELD, attemptStatus, clearedAttempts, hasRecoveryPassphrase,
  recordFailure, retryAfterText, verifyPassphrase,
} from "@/lib/recoveryServer";

export const dynamic = "force-dynamic";

// Reset your own password, in the app, with no email anywhere.
//
// The caller proves who they are with their RECOVERY PASSPHRASE — a secret they
// set on My Account beforehand (see /api/users/me/recovery) — and the Admin SDK
// writes the new password straight onto the Firebase Auth record. Nothing is
// sent, nothing is clicked, nothing depends on an inbox.
//
// ── What this route is, honestly ───────────────────────────────────────────
//
// It is a second password that can set the first one. That is a real trade: it
// removes the email dependency, and in exchange the account is now as strong as
// the weaker of two secrets rather than one secret plus control of an inbox. It
// is worth it here because the inbox link was not working at all, and a reset
// path that never fires protects nothing.
//
// What makes it defensible rather than reckless:
//
//   • THE CHALLENGE IS A SECRET. Not a display name, not a driver name, not
//     anything this app publishes — see the note in lib/recoveryServer.js. A
//     check against public information would be an open door to every account.
//   • GUESSING COSTS SOMETHING. Five wrong tries locks the recovery path for
//     fifteen minutes. Ordinary sign-in is untouched, so this can annoy somebody
//     but never lock them out.
//   • IT SAYS NOTHING IT DOESN'T HAVE TO. One message covers "no such account",
//     "no passphrase set" and "wrong passphrase", so the form can't be used to
//     find out who races here or who has recovery armed.
//   • ONLY THE CREDENTIAL CHANGES. league_roles, the linked driver profile, the
//     display name, every roster entry — all untouched. The single Firestore
//     write is the guess counter being cleared.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const passphrase = String(body.passphrase ?? "");
  const newPassword = String(body.new_password ?? "");

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({
      error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    }, { status: 400 });
  }

  // The one refusal this route ever gives for a failed identity check. Three
  // different causes, one sentence — see the note above.
  const REFUSED = "That email and recovery passphrase don't match. If you've never set a recovery "
    + "passphrase, ask a league Owner to set your password for you.";
  const refuse = () => NextResponse.json({ error: REFUSED, code: "recovery-failed" }, { status: 403 });

  const record = await adminAuth().getUserByEmail(email).catch(() => null);
  if (!record) return refuse();

  const ref = db().collection("users").doc(record.uid);
  const doc = await ref.get();
  const data = doc.exists ? doc.data() : null;
  if (!hasRecoveryPassphrase(data)) return refuse();

  const stored = data[RECOVERY_FIELD];

  // Locked out from guessing? Said plainly, because unlike the refusal above
  // this one is about the REQUEST rather than the account, and somebody sitting
  // through a cooling-off period needs to know that's what is happening.
  const status = attemptStatus(stored);
  if (status.locked) {
    return NextResponse.json({
      error: `Too many incorrect attempts. Try again in ${retryAfterText(status.retryAfterMs)}, `
        + "or ask a league Owner to set your password for you.",
      code: "recovery-locked",
    }, { status: 429 });
  }

  if (!verifyPassphrase(passphrase, stored)) {
    const failure = recordFailure(stored);
    // Best-effort: a counter that fails to write must not turn a wrong guess
    // into a successful reset, and the refusal below happens either way.
    await ref.set({ [RECOVERY_FIELD]: { attempts: failure.attempts } }, { merge: true })
      .catch(err => console.error("recovery: couldn't record a failed attempt", err));
    if (failure.locked) {
      return NextResponse.json({
        error: `That's ${failure.attempts.count} incorrect attempts — recovery is locked for `
          + `${retryAfterText(15 * 60 * 1000)}. Ask a league Owner to set your password instead.`,
        code: "recovery-locked",
      }, { status: 429 });
    }
    return refuse();
  }

  // ── Proven. Set the password and nothing else. ───────────────────────────
  try {
    await adminAuth().updateUser(record.uid, { password: newPassword });
  } catch (err) {
    console.error("reset-password: updateUser failed", err);
    return NextResponse.json({
      error: `Couldn't set the new password: ${err?.code || err?.message || "unknown error"}`,
    }, { status: 502 });
  }

  // Somebody who has just proved themselves and set a new password should be the
  // only one holding the account, so any other session's refresh token stops
  // working. Best-effort: failing to revoke must not undo a successful reset.
  await adminAuth().revokeRefreshTokens(record.uid)
    .catch(err => console.error("reset-password: couldn't revoke old sessions", err));

  // The ONLY Firestore write on the success path, and it touches one field:
  // the guess counter, cleared. Roles, driver links and profile are untouched
  // by construction — nothing here names them.
  await ref.set({
    [RECOVERY_FIELD]: { attempts: clearedAttempts() },
    password_reset_at: new Date().toISOString(),
  }, { merge: true }).catch(err => console.error("recovery: couldn't clear attempts", err));

  return NextResponse.json({ ok: true, email: record.email || email });
}
