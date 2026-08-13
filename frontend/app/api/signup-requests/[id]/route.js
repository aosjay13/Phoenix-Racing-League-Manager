import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser } from "@/lib/serverAuth";
import { APPROVED, DENIED, PENDING, WITHDRAWN } from "@/lib/signupQueue";

export const dynamic = "force-dynamic";

// A player withdrawing their OWN pending request before an admin gets to it —
// "actually, never mind". Two things make this worth having rather than leaving
// every request for an admin to deny: the car number a request is holding is
// freed for somebody else the moment it's withdrawn, and a request nobody wants
// any more shouldn't be sitting in the approvals queue inflating the badge.
//
// Ownership is the whole of the check: the row must belong to the CALLER'S
// account, so there is no way to withdraw somebody else's. An admin resolving a
// request goes through /api/admin/signup-requests/[id] instead — this route
// deliberately gives no one power over anybody else's row, not even staff.
//
// The row is marked `withdrawn` rather than deleted, so an admin looking at why
// somebody never made the roster can still see that they asked and took it back.
export const DELETE = withUser(async (request, { params }, user) => {
  const ref = db().collection("signup_requests").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const req = doc.data();
  if (req.uid !== user.uid) {
    return NextResponse.json({ error: "That isn't your request." }, { status: 403 });
  }
  if (req.status !== PENDING) {
    return NextResponse.json(
      { error: "That request has already been resolved." },
      { status: 400 },
    );
  }

  await ref.update({
    status: WITHDRAWN,
    resolved_at: new Date().toISOString(),
    resolved_by: user.uid,
  });
  return NextResponse.json({ ok: true, id: params.id, status: WITHDRAWN });
});

// A player marking a RESOLVED sign-up as read — a denial ("I've seen why, let
// me try again") or an approval ("yes, I've read the welcome").
//
// It's an explicit action rather than something opening the screen does, and
// the reason is the same one the roster's additions panel has: a notice that
// clears itself before it has been taken in is worse than none. Until this is
// called, the denial sits at the top of their Sign-ups screen and that season
// is held back from their join list, so the reason is read before the form is
// filled in a second time.
//
// Nothing else about the row changes: it stays denied, with the admin's reason,
// as the record of what happened. Ownership is the whole of the check — the row
// must belong to the CALLER.
export const PATCH = withUser(async (request, { params }, user) => {
  const ref = db().collection("signup_requests").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const req = doc.data();
  if (req.uid !== user.uid) {
    return NextResponse.json({ error: "That isn't your request." }, { status: 403 });
  }
  if (req.status !== DENIED && req.status !== APPROVED) {
    return NextResponse.json(
      { error: "There's nothing to acknowledge on that request." },
      { status: 400 },
    );
  }

  // Already acknowledged is a no-op, not an error: two tabs open, one button
  // pressed twice, same outcome either way.
  if (!req.player_seen_at) await ref.update({ player_seen_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, id: params.id, acknowledged: true });
});
