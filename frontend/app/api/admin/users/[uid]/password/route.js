import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { isEnvAdmin, legacyLeagueId, withOwner } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";
import { MIN_PASSWORD_LENGTH } from "@/lib/authFlows";

export const dynamic = "force-dynamic";

// Owner-only: set a player's password directly.
//
// The Firebase Admin SDK's updateUser(uid, { password }) writes the credential
// itself — no email, no link, no waiting. It is the answer to the support
// request every league gets ("I can't get in") on an installation where the
// emailed reset never arrives, and it takes effect the moment it returns.
//
// ── Why Owner, and why only within their own league ────────────────────────
//
// Setting somebody's password is taking their account. Every other staff power
// in this app edits league DATA; this one hands over an identity, so it sits
// with the one role that already owns the league outright, and only for people
// who actually race in it. withOwner resolves against the ACTIVE league (roles
// are per league — see lib/leagueRoles.js), so the Owner of League A cannot
// touch somebody who only races in League B.
//
// Two accounts it refuses outright:
//
//   • YOUR OWN. My Account asks for the current password first, deliberately, so
//     a session left open on a shared computer can't be turned into a takeover.
//     Allowing an Owner to set their own password here would route straight
//     around that.
//   • A PERMANENT (ADMIN_EMAILS) OWNER. That account is the installation's
//     escape hatch — the thing that still works when every role map is wrong.
//     One Owner being able to seize it would defeat the point of having it.
//
// ── Zero account loss ──────────────────────────────────────────────────────
//
// Only the Firebase Auth credential changes. `league_roles`, the linked driver
// profile, roster entries, results, the display name — none of them are named
// anywhere in this file. The single Firestore write is one audit field.
export const POST = withOwner(async (request, { params }, owner, role, leagueId) => {
  const { uid } = params;
  const body = await request.json().catch(() => ({}));
  const newPassword = String(body.password ?? "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    }, { status: 400 });
  }
  if (uid === owner.uid) {
    return NextResponse.json({
      error: "Use My Account to change your own password — it asks for your current one first, "
        + "which is what stops an open session being turned into a takeover.",
    }, { status: 400 });
  }

  const [userDoc, authRecord] = await Promise.all([
    db().collection("users").doc(uid).get(),
    adminAuth().getUser(uid).catch(() => null),
  ]);
  if (!authRecord) {
    return NextResponse.json(
      { error: "That account no longer exists in Firebase Auth." },
      { status: 404 },
    );
  }
  const data = userDoc.exists ? userDoc.data() : null;

  if (isEnvAdmin(authRecord.email)) {
    return NextResponse.json({
      error: "That account is a permanent Owner (set via ADMIN_EMAILS) — the installation's "
        + "escape hatch. Its password can't be set from here.",
    }, { status: 403 });
  }

  // Members of THIS league only. The screen this is reached from is already
  // scoped, but the route is addressed by uid so the check belongs here too.
  if (leagueId) {
    const legacy = await legacyLeagueId();
    if (!data || !isLeagueMember(data, leagueId, { legacyLeagueId: legacy })) {
      return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
    }
  }

  try {
    await adminAuth().updateUser(uid, { password: newPassword });
  } catch (err) {
    console.error("admin set-password: updateUser failed", err);
    return NextResponse.json({
      error: `Couldn't set the password: ${err?.code || err?.message || "unknown error"}`,
    }, { status: 502 });
  }

  // Their other sessions stop being refreshable. Somebody whose password an
  // Owner had to set is either locked out (so has no session to lose) or has an
  // account somebody else may be holding — both point the same way.
  await adminAuth().revokeRefreshTokens(uid)
    .catch(err => console.error("admin set-password: couldn't revoke old sessions", err));

  // The audit trail, and the ONLY thing written to Firestore. Recorded because
  // "somebody else set this password" is a fact about an account that should
  // outlive the toast that announced it.
  if (userDoc.exists) {
    await userDoc.ref.set({
      password_set_by_owner: {
        uid: owner.uid, at: new Date().toISOString(), league_id: leagueId || null,
      },
    }, { merge: true }).catch(err => console.error("admin set-password: audit write failed", err));
  }

  return NextResponse.json({
    ok: true,
    uid,
    email: authRecord.email || data?.email || null,
    display_name: data?.display_name || authRecord.displayName || null,
  });
});
