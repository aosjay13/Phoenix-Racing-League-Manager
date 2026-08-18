import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { isEnvAdmin, legacyLeagueId, withOwner } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// Owner-only: mark somebody's email verified by hand.
//
// This is the answer to the failure mode the verification wall creates. The wall
// refuses every account whose email Firebase has not confirmed, and the only
// thing that normally confirms it is an email — so the day delivery stops, every
// account in the league is locked out simultaneously and nothing inside the app
// can let them back in.
//
// adminAuth().updateUser(uid, { emailVerified: true }) is the one function that
// resolves that without an inbox. It sets the same flag the emailed link would
// have set, so nothing downstream has to know the difference: the token's
// email_verified claim flips on the account's next refresh and every gate in the
// app opens normally.
//
// ── Why Owner and not any staff ────────────────────────────────────────────
//
// Verification is the app's proof that the person holds the address they signed
// up with. Setting it by hand asserts that proof on somebody else's behalf, and
// that belongs to the person who owns the league rather than to everyone with a
// staff badge. withOwner resolves against the ACTIVE league, so an Owner of
// League A cannot vouch for somebody who only races in League B.
export const POST = withOwner(async (request, { params }, owner, role, leagueId) => {
  const { uid } = params;

  const [userDoc, authRecord] = await Promise.all([
    db().collection("users").doc(uid).get(),
    adminAuth().getUser(uid).catch(() => null),
  ]);
  if (!authRecord) {
    return NextResponse.json(
      { error: "That account no longer exists in Firebase Auth, so there is nothing to verify." },
      { status: 404 },
    );
  }
  const data = userDoc.exists ? userDoc.data() : null;

  // Members of THIS league only. The roster this button appears on is already
  // scoped, but the route is addressed by uid so the check belongs here too.
  if (leagueId && !isEnvAdmin(authRecord.email)) {
    const legacy = await legacyLeagueId();
    if (!data || !isLeagueMember(data, leagueId, { legacyLeagueId: legacy })) {
      return NextResponse.json({ error: "That account isn't a member of this league." }, { status: 403 });
    }
  }

  if (authRecord.emailVerified) {
    return NextResponse.json({ ok: true, uid, email: authRecord.email, already: true });
  }

  try {
    await adminAuth().updateUser(uid, { emailVerified: true });
  } catch (err) {
    console.error("updateUser(emailVerified) failed", err);
    return NextResponse.json(
      { error: `Couldn't mark that account verified: ${err?.code || err?.message || "unknown error"}` },
      { status: 502 },
    );
  }

  // Recorded on the profile so the roster can say this was vouched for rather
  // than confirmed by email — the two are not the same claim, and an Owner
  // looking at the list later deserves to know which one they are seeing.
  if (userDoc.exists) {
    await userDoc.ref.set({
      verified_by_owner: { uid: owner.uid, at: new Date().toISOString(), league_id: leagueId || null },
      // They are through the door now, whatever route they took, so the
      // "signed up but never got in" flag no longer describes them.
      signup_pending: false,
    }, { merge: true });
  }

  return NextResponse.json({ ok: true, uid, email: authRecord.email, already: false });
});
