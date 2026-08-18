import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";
import { MIN_RECOVERY_LENGTH } from "@/lib/authFlows";
import {
  RECOVERY_FIELD, clearedAttempts, hasRecoveryPassphrase, hashPassphrase,
} from "@/lib/recoveryServer";

export const dynamic = "force-dynamic";

// The account's own recovery passphrase — set it, replace it, remove it.
//
// This is what makes an email-free password reset possible without handing the
// league away: the "forgot my password" form (POST /api/auth/reset-password)
// checks this and nothing else, so it is only ever as strong as what is stored
// here. See lib/recoveryServer.js for why it is a real secret rather than a
// driver name.
//
// The passphrase itself is never returned by anything. GET answers only whether
// one is set and when it was last changed, which is what the Account screen
// needs to say "you're covered" or "you have no way back in if you forget your
// password".

export const GET = withUser(async (request, ctx, user) => {
  const doc = await db().collection("users").doc(user.uid).get();
  const data = doc.exists ? doc.data() : null;
  return NextResponse.json({
    configured: hasRecoveryPassphrase(data),
    updated_at: data?.[RECOVERY_FIELD]?.updated_at || null,
    min_length: MIN_RECOVERY_LENGTH,
  });
});

// Setting one requires being signed in, which is the whole security model here:
// you can only arm the recovery path for an account you are already holding. A
// stolen session could set one, but a stolen session can change the password
// outright, so this adds no new reach.
export const PUT = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const passphrase = String(body.passphrase ?? "");

  if (passphrase.trim().length < MIN_RECOVERY_LENGTH) {
    return NextResponse.json({
      error: `Recovery passphrase must be at least ${MIN_RECOVERY_LENGTH} characters.`,
    }, { status: 400 });
  }

  const ref = db().collection("users").doc(user.uid);
  if (!(await ref.get()).exists) {
    return NextResponse.json(
      { error: "Your profile hasn't finished setting itself up yet. Reload and try again." },
      { status: 409 },
    );
  }

  // Stored salted and hashed, with the guess counter reset — a new passphrase
  // starts with a clean slate rather than inheriting the old one's failures.
  await ref.set({
    [RECOVERY_FIELD]: { ...hashPassphrase(passphrase.trim()), attempts: clearedAttempts() },
  }, { merge: true });

  return NextResponse.json({ ok: true, configured: true });
});

// Removing it closes the email-free reset path for this account. Offered
// because a secret you no longer trust should be removable, and because an
// account that would rather rely on an Owner should be able to say so.
export const DELETE = withUser(async (request, ctx, user) => {
  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  if (!doc.exists || !hasRecoveryPassphrase(doc.data())) {
    return NextResponse.json({ ok: true, configured: false });
  }
  // The whole field goes, rather than being blanked — a half-present record is
  // the sort of thing a later reader mistakes for "configured".
  await ref.update({ [RECOVERY_FIELD]: null });
  return NextResponse.json({ ok: true, configured: false });
});
