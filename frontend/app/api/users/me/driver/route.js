import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withUser } from "@/lib/serverAuth";
import { normalizeAliases } from "@/lib/aliases";
import { linkedDriver } from "@/lib/carSelectionServer";

export const dynamic = "force-dynamic";

// There is deliberately no POST here. A player cannot create a driver profile:
// asking for one files a pending request (POST /api/claim-requests with
// kind "new_driver") and only an admin approving it creates anything. Adding a
// driver to the league is never automated.

// The caller's own driver profile, trimmed to the part they may edit. Answers
// with driver: null rather than a 403 when there isn't one — "you haven't got a
// profile yet" is a normal state for a new player, and the screen reading this
// (Profile ▸ Connected Accounts) explains how to get one rather than treating
// it as an error.
export const GET = withUser(async (request, ctx, user, leagueId) => {
  const driver = await linkedDriver(user.uid, leagueId);
  return NextResponse.json({
    driver: driver
      ? { id: driver.id, name: driver.name || "Driver", aliases: normalizeAliases(driver.aliases) }
      : null,
  });
});

// A player edits the Aliases / Connected Accounts on THEIR OWN driver profile —
// the platform usernames the Smart Importer matches results against, and the
// iRacing customer ID a league needs to send them an invite. Keeping these
// current is the driver's own job, and it's the only field of the profile they
// may write: name, display names and notes stay admin-only (see
// /api/drivers/[id]), since those decide how the whole league sees them.
//
// The profile written is the one linked to the caller's account, resolved from
// the account rather than taken from the request, so there is no way to edit
// somebody else's.
export const PATCH = withUser(async (request, ctx, user, leagueId) => {
  const body = await request.json().catch(() => ({}));
  if (body.aliases === undefined) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const driver = await linkedDriver(user.uid, leagueId);
  if (!driver) {
    return NextResponse.json(
      { error: "No driver profile is linked to your account.", code: "no-driver" },
      { status: 403 },
    );
  }

  const aliases = normalizeAliases(body.aliases);
  await db().collection("drivers").doc(driver.id).update({ aliases });
  return NextResponse.json({ id: driver.id, aliases });
});

// A user unclaims (unlinks) whichever driver profile is linked to their own
// account, returning it to the unclaimed pool. Their past race results stay on
// record — only the account↔driver link (drivers.user_id) is cleared.
export const DELETE = withUser(async (request, ctx, user, leagueId) => {
  const snap = await db().collection("drivers").where("user_id", "==", user.uid).get();
  // Only the profile they race as IN THIS LEAGUE. Unclaiming here is a decision
  // about this league; the driver profile this same account holds in another one
  // is none of this screen's business and must survive untouched.
  const mine = snap.docs.filter(d => docInLeague(d.data(), leagueId));
  if (!mine.length) {
    return NextResponse.json({ error: "No driver profile is linked to your account in this league." }, { status: 400 });
  }
  const batch = db().batch();
  mine.forEach(d => batch.update(d.ref, { user_id: null }));
  await batch.commit();
  return NextResponse.json({ ok: true, unlinked: mine.map(d => d.id) });
});
