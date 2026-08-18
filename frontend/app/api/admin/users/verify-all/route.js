import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { legacyLeagueId, withOwner } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// Owner-only: mark every unverified member of THIS LEAGUE as verified, in one
// go.
//
// The per-account button next door is the right tool for one person who says
// the email never came. This one is for the situation that button was written
// during: mail delivery has stopped, and the entire league — every returning
// racer and every new signup — is sitting behind the verification wall at once.
// Clicking through them one at a time is not a recovery plan.
//
// It is scoped to the league's own members, so an Owner cannot vouch for the
// whole installation from one league's dashboard. Accounts already verified are
// skipped rather than rewritten.
export const POST = withOwner(async (request, ctx, owner, role, leagueId) => {
  if (!leagueId) {
    return NextResponse.json(
      { error: "No active league, so there is no membership list to work from." },
      { status: 400 },
    );
  }

  const [usersSnap, legacy] = await Promise.all([
    db().collection("users").get(),
    legacyLeagueId(),
  ]);
  const members = usersSnap.docs.filter(d =>
    isLeagueMember(d.data(), leagueId, { legacyLeagueId: legacy }));

  const verified = [];
  const failed = [];
  // One Auth read + write per account. A league's roster is tens of people, not
  // thousands, and doing it sequentially keeps a partial run comprehensible —
  // whatever succeeded is already applied, and re-running skips it.
  for (const doc of members) {
    try {
      const record = await adminAuth().getUser(doc.id).catch(() => null);
      if (!record || record.emailVerified) continue;
      await adminAuth().updateUser(doc.id, { emailVerified: true });
      await doc.ref.set({
        verified_by_owner: { uid: owner.uid, at: new Date().toISOString(), league_id: leagueId },
        signup_pending: false,
      }, { merge: true });
      verified.push(record.email || doc.id);
    } catch (err) {
      console.error("verify-all failed for", doc.id, err);
      failed.push(doc.data()?.email || doc.id);
    }
  }

  return NextResponse.json({
    ok: true,
    verified: verified.length,
    failed: failed.length,
    // Named so the toast can say who didn't take, rather than only how many.
    failed_emails: failed.slice(0, 10),
  });
});
