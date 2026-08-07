import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withUser } from "@/lib/serverAuth";
import { linkedDriver, pendingClaim } from "@/lib/carSelectionServer";

export const dynamic = "force-dynamic";

// A user creates a BRAND NEW driver profile for themselves and links it to
// their account in one step — the "I'm not on the roster yet" half of the
// driver-linking gate on the Series Information screen. Claiming an existing
// profile still goes through admin approval (/api/claim-requests): that one
// hands over somebody else's race history, so it needs a human. Creating a new
// identity hands over nothing, so a new player can get themselves signed up and
// their car locked in without waiting on an admin.
//
// The trade the feature request makes: if the league already had a driver under
// this person's name, an admin folds the two together afterwards with
// Drivers ▸ Merge, and every result comes across. To keep that rare, an exact
// name match is refused here and the claim flow is offered instead.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Enter the name you race under." }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "That name is too long (60 characters max)." }, { status: 400 });

  const [existing, pending] = await Promise.all([linkedDriver(user.uid), pendingClaim(user.uid)]);
  if (existing) {
    return NextResponse.json(
      { error: `Your account is already linked to “${existing.name}”. Unclaim it first to change profiles.` },
      { status: 400 },
    );
  }
  if (pending) {
    return NextResponse.json(
      { error: `You've already asked to claim “${pending.driver_name}”. An admin will review it — you can't create a second profile in the meantime.` },
      { status: 409 },
    );
  }

  // An exact name match is almost always the same person, and creating a
  // duplicate would split their history in two — point them at the claim flow.
  const pool = await db().collection("drivers").get();
  const wanted = name.toLowerCase();
  const clash = pool.docs.find(d => String(d.data().name || "").trim().toLowerCase() === wanted);
  if (clash) {
    return NextResponse.json({
      error: `There's already a driver called “${clash.data().name}”. If that's you, claim that profile instead so your race history comes with it.`,
      code: "driver-exists",
      driver_id: clash.id,
    }, { status: 409 });
  }

  const leagueId = getRequestLeagueId(request);
  const doc = {
    name,
    user_id: user.uid,
    notes: "",
    created_at: new Date().toISOString(),
    created_by: user.uid,
    // Flags a profile the player made for themselves, so an admin reviewing the
    // driver list knows which ones may still need merging into an existing one.
    self_created: true,
    ...(leagueId ? { league_id: leagueId } : {}),
  };
  const ref = await db().collection("drivers").add(doc);
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});

// A user unclaims (unlinks) whichever driver profile is linked to their own
// account, returning it to the unclaimed pool. Their past race results stay on
// record — only the account↔driver link (drivers.user_id) is cleared.
export const DELETE = withUser(async (request, ctx, user) => {
  const snap = await db().collection("drivers").where("user_id", "==", user.uid).get();
  if (snap.empty) {
    return NextResponse.json({ error: "No driver profile is linked to your account." }, { status: 400 });
  }
  const batch = db().batch();
  snap.docs.forEach(d => batch.update(d.ref, { user_id: null }));
  await batch.commit();
  return NextResponse.json({ ok: true, unlinked: snap.docs.map(d => d.id) });
});
