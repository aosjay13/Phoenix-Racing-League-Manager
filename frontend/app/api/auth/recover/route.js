import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { forgetLegacyLeague, legacyLeagueId } from "@/lib/serverAuth";
import {
  LEAGUE_ROLES_FIELD, isLeagueKey, leagueRolePatch, normalizeLeagueRoles,
} from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// ── The failsafe ───────────────────────────────────────────────────────────
//
// Every other way into this app depends on email working. Signing up needs a
// verification link; a forgotten password needs a reset link; being let in by an
// Owner needs an Owner who is already in. When mail delivery stops, all three
// fail at once and the app has no door left — including for the person who runs
// it.
//
// This is that door. It is opened by a secret the operator sets in their hosting
// environment (OWNER_RECOVERY_CODE), which is a thing they can always reach: it
// needs no inbox, no console, and no working email of any kind. Presenting the
// code with an email address will:
//
//   1. mark that Firebase Auth account email-verified, and
//   2. make it Owner of the legacy (oldest) league — the standing that carries
//      application-Owner powers, and therefore the one that gets you everywhere
//      else through the ordinary UI once you are back in.
//
// ── The rules that keep it safe ────────────────────────────────────────────
//
// • OFF BY DEFAULT. With no OWNER_RECOVERY_CODE set the route refuses
//   everything, so an installation that never configures one has no extra
//   surface at all. It is not a backdoor that ships enabled.
// • A LONG SECRET, compared without leaking its length. Same shape as
//   BACKUP_CRON_SECRET (lib/backupAuth.js), which this deliberately mirrors —
//   short codes are refused outright rather than trusted.
// • IT GRANTS, IT NEVER TAKES. Nothing is deleted, no other account is touched,
//   and an account that already holds a higher standing keeps it.
// • THE OPERATOR SHOULD UNSET IT afterwards. Said in the response, because a
//   recovery code left lying around is a permanent Owner grant to whoever finds
//   the environment.

const MIN_CODE_LENGTH = 16;

export function recoveryCode() {
  return String(process.env.OWNER_RECOVERY_CODE || "").trim();
}

// Constant-time-ish comparison so a wrong code can't be narrowed down by
// timing. Differing lengths are already a mismatch.
function secretsMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Is the failsafe available on this installation? Public, and answers only
// "is there a code configured" — never the code, and nothing about any account.
// The /recover screen reads it so it can explain what to do instead when the
// operator hasn't set one, rather than presenting a form that cannot work.
export async function GET() {
  const code = recoveryCode();
  return NextResponse.json({
    available: code.length >= MIN_CODE_LENGTH,
    // Told apart so the screen can say "set one" versus "the one you set is too
    // short to be safe" — two different fixes.
    configured: code.length > 0,
    min_length: MIN_CODE_LENGTH,
  });
}

export async function POST(request) {
  const expected = recoveryCode();
  if (expected.length < MIN_CODE_LENGTH) {
    return NextResponse.json({
      error: expected
        ? `OWNER_RECOVERY_CODE is set but shorter than ${MIN_CODE_LENGTH} characters, so recovery is disabled. Set a longer one and redeploy.`
        : "Owner recovery isn't enabled on this installation. Set OWNER_RECOVERY_CODE in the hosting environment and redeploy.",
      code: "recovery-disabled",
    }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const supplied = String(body.code || "").trim();

  if (!secretsMatch(supplied, expected)) {
    // One message for a wrong code and for a code of the wrong length, so the
    // response says nothing about the real one.
    return NextResponse.json({ error: "That recovery code isn't right." }, { status: 403 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email address of the account to recover." }, { status: 400 });
  }

  // Past this point the caller holds the operator's secret, so naming whether an
  // account exists costs nothing they don't already have — and "no such account"
  // is the single most useful thing to be told when a recovery isn't working.
  let record;
  try {
    record = await adminAuth().getUserByEmail(email);
  } catch (err) {
    const code = String(err?.code || "");
    if (code.includes("user-not-found")) {
      return NextResponse.json({
        error: `No account exists with the email ${email}. Create the account first (sign up normally), then run recovery again.`,
        code: "user-not-found",
      }, { status: 404 });
    }
    console.error("recover: getUserByEmail failed", err);
    return NextResponse.json({
      error: `Couldn't look that account up: ${err?.code || err?.message || "unknown error"}`,
    }, { status: 502 });
  }

  const steps = [];

  // 1. Through the verification wall.
  if (!record.emailVerified) {
    await adminAuth().updateUser(record.uid, { emailVerified: true });
    steps.push("marked the email verified");
  }

  // 2. Owner of the league that matters.
  //
  //    Only the LEGACY (oldest) league, and deliberately only that one. It is
  //    what decides application-Owner powers — backups, the containment
  //    migration — so it is the standing that gets you everywhere else through
  //    the ordinary UI once you are back in.
  //
  //    The request does NOT get to name a league. An id from the body would be
  //    written straight in as a Firestore map key, so it would have to be
  //    validated against both the key rules and the leagues collection before it
  //    could be trusted — and there is nothing to gain: a recovered Owner can
  //    grant themselves anything else from Admin ▸ User Accounts a moment later.
  const legacy = await legacyLeagueId();
  const targets = isLeagueKey(legacy) ? [legacy] : [];

  const ref = db().collection("users").doc(record.uid);
  const doc = await ref.get();
  const existing = doc.exists ? doc.data() : null;

  if (!doc.exists) {
    // No profile at all yet — build the one their first verified visit would
    // have written, so the roster and every role lookup can see them.
    await ref.set({
      display_name: record.displayName || email.split("@")[0] || "Owner",
      email: record.email || email,
      photo_url: record.photoURL || null,
      bio: "",
      country: "",
      number: null,
      role: "owner",
      [LEAGUE_ROLES_FIELD]: Object.fromEntries(targets.map(id => [id, "owner"])),
      signup_pending: false,
      created_at: new Date().toISOString(),
      recovered_at: new Date().toISOString(),
    });
    steps.push("created the account profile");
    if (targets.length) steps.push(`made it Owner of ${targets.length} league${targets.length === 1 ? "" : "s"}`);
  } else {
    const map = normalizeLeagueRoles(existing[LEAGUE_ROLES_FIELD]);
    const granted = targets.filter(id => map[id] !== "owner");
    for (const id of granted) {
      const patch = leagueRolePatch(id, "owner");
      if (patch) await ref.set(patch, { merge: true });
    }
    // The legacy global field too, which is what an un-migrated installation
    // still reads — recovery has to work before the containment migration has
    // ever been run.
    if (existing.role !== "owner") {
      await ref.update({ role: "owner", recovered_at: new Date().toISOString() });
      steps.push("set the account's role to Owner");
    }
    if (granted.length) {
      steps.push(`made it Owner of ${granted.length} league${granted.length === 1 ? "" : "s"}`);
    }
  }

  // A recovery that created the first league's owner may also have been run on
  // an installation whose league list has since changed.
  forgetLegacyLeague();

  return NextResponse.json({
    ok: true,
    email: record.email || email,
    uid: record.uid,
    // Named so the screen can show exactly what was done, rather than a bare
    // "success" that leaves somebody wondering whether to try again.
    steps: steps.length ? steps : ["nothing to do — that account was already a verified Owner"],
    reminder: "Sign in normally now. Then remove OWNER_RECOVERY_CODE from your hosting environment "
      + "and redeploy — a recovery code left in place is a permanent way for anyone who finds it to "
      + "make themselves an Owner.",
  });
}
