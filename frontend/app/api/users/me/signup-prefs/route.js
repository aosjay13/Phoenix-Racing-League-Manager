import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";
import { HIDDEN, MUTED, NORMAL, normalizePrefs, withPref } from "@/lib/signupPrefs";

export const dynamic = "force-dynamic";

// "Not Interested" / "Clear Notification" on the Sign-ups screen — what a
// player has said about each season they could join.
//
// It is stored on their OWN account document, under `signup_prefs`, for two
// reasons: the account is already read by /api/users/me/series (so this costs
// nothing extra to return), and it keeps the answer where it belongs — this is
// a display preference of one person's, not a fact about the season. No admin
// sees it, nothing about the sign-up itself changes, and a season put aside can
// still be joined the moment they change their mind.
//
// The caller is the whole of the check: the write is aimed at `user.uid` and
// nothing in the request can point it anywhere else, so there is no way to
// silence somebody else's notifications.
export const PUT = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  const state = body.state;

  if (!seasonId) {
    return NextResponse.json({ error: "Which season?" }, { status: 400 });
  }
  // NORMAL is how a preference is CLEARED ("I'm interested after all"), so it's
  // a valid state rather than a missing one.
  if (state !== MUTED && state !== HIDDEN && state !== NORMAL) {
    return NextResponse.json({ error: "Unknown state" }, { status: 400 });
  }

  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  if (!doc.exists) {
    return NextResponse.json({ error: "No account to save this against." }, { status: 404 });
  }

  // Read-modify-write rather than a dotted field update: a season id is not
  // guaranteed to be a legal Firestore field path, and normalising the whole
  // map on the way through is what keeps a stray value from ever hiding a
  // series permanently.
  const signup_prefs = withPref(normalizePrefs(doc.data().signup_prefs), seasonId, state);
  await ref.update({ signup_prefs });

  return NextResponse.json({ ok: true, season_id: seasonId, state, signup_prefs });
});
