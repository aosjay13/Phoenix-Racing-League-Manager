import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { isEnvAdmin, legacyLeagueId, withOwner } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";
import { queueEmail } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Owner-only: send a player a password reset link.
//
// The job this does is small and the reason it exists is not. A league runs on
// people who race once a week, and "I can't get in" is the single most common
// thing an Owner is asked. Without this the only answer is the Firebase console
// — a place most league owners have no business being, and where the buttons
// next to the one they want delete accounts.
//
// ── Why Owner and not any staff ────────────────────────────────────────────
//
// A reset link is a way into somebody else's account. Every other staff power
// in this app edits league DATA; this one touches a person's credentials, so it
// sits with the one role that already owns the league outright. withOwner
// resolves that against the ACTIVE league (roles are per league — see
// lib/leagueRoles.js), so the Owner of League A cannot reset the password of
// somebody who only races in League B.
//
// ── What actually gets sent ────────────────────────────────────────────────
//
// Firebase mints the link (generatePasswordResetLink) but does not deliver it —
// delivery is the app's own mail path, the same queue every other notification
// in this league goes through (lib/mailer.js, consumed by the Trigger Email
// extension). That means a league with email set up gets a real email, and a
// league without one gets a queued document and an honest answer, exactly as it
// does for a denied sign-up.
//
// The link itself is never returned to the caller. It is a credential in a
// string, and the person who asked for it is not the person it is for.
export const POST = withOwner(async (request, { params }, owner, role, leagueId) => {
  const { uid } = params;

  const userDoc = await db().collection("users").doc(uid).get();
  const authRecord = await adminAuth().getUser(uid).catch(() => null);
  if (!userDoc.exists && !authRecord) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const data = userDoc.exists ? userDoc.data() : null;
  // The FIREBASE AUTH record's address, not the profile document's, and the
  // order matters. generatePasswordResetLink resolves whatever address it is
  // given to whichever account owns it — so if the two ever disagree (an address
  // changed in the Firebase console, a restored backup carrying an older
  // profile), reading the profile copy would mint a reset for somebody else's
  // account and mail it to them. Auth is the only record that is authoritative
  // about how an account signs in; the profile copy is a denormalized mirror.
  const email = authRecord?.email || data?.email || null;
  if (!email) {
    return NextResponse.json(
      { error: "That account has no email address on file, so there's nowhere to send a reset link." },
      { status: 400 },
    );
  }

  // Members of THIS league only. The roster this button appears on is already
  // scoped, but the route is addressed by uid, so the check belongs here too.
  // Env-var Owners are members of every league by definition.
  if (leagueId && !isEnvAdmin(email)) {
    const legacy = await legacyLeagueId();
    if (!data || !isLeagueMember(data, leagueId, { legacyLeagueId: legacy })) {
      return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
    }
  }

  let link;
  try {
    link = await adminAuth().generatePasswordResetLink(email);
  } catch (err) {
    console.error("generatePasswordResetLink failed", err);
    const code = String(err?.code || err?.message || "");
    if (code.includes("user-not-found")) {
      return NextResponse.json(
        { error: "Firebase has no sign-in account for that email address." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't create a reset link. Check the Firebase service account's permissions." },
      { status: 502 },
    );
  }

  const leagueName = leagueId
    ? (await db().collection("leagues").doc(leagueId).get().catch(() => null))?.data()?.name || "your racing league"
    : "your racing league";
  const who = data?.display_name || authRecord?.displayName || "driver";

  const queued = await queueEmail({
    to: email,
    subject: `Reset your ${leagueName} password`,
    text: [
      `Hi ${who},`,
      "",
      `A league admin has asked us to send you a link to set a new password for ${leagueName}.`,
      "",
      link,
      "",
      "If you weren't expecting this you can ignore this email — your password stays as it is until the link is used.",
    ].join("\n"),
    kind: "password_reset",
    meta: { uid, league_id: leagueId || null, requested_by: owner.uid },
  });

  return NextResponse.json({
    ok: true,
    uid,
    email,
    // False when there was no address to queue to or the write failed. The
    // dashboard says so rather than claiming an email went out.
    queued: !!queued,
  });
});
