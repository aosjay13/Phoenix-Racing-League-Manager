import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withRole } from "@/lib/serverAuth";
import { ROLE_LEVEL } from "@/lib/roles";
import { PENDING } from "@/lib/signupQueue";

export const dynamic = "force-dynamic";

// How many sign-ups are sitting in the Pending state across the whole active
// league — the number in the red badge beside the sidebar's Approvals link.
//
// Kept separate from GET /api/admin/signup-requests (which returns the requests
// themselves) for two reasons:
//
//   • it answers with a COUNT, so the badge polls without pulling every pending
//     request — including the player emails and account ids on them — into a
//     browser every minute, and
//   • it's gated at MODERATOR and above rather than at "any staff". A
//     Statistician can read the league's numbers but doesn't work the approvals
//     queue, so the badge (and this call) isn't theirs. Anyone below that — a
//     player, or a signed-out visitor — gets a 403 and no count at all.
export const GET = withRole(ROLE_LEVEL.moderator, async (request) => {
  const query = scopeByLeague(
    db().collection("signup_requests").where("status", "==", PENDING),
    getRequestLeagueId(request),
  );

  // Firestore's aggregation query returns the tally without reading the docs.
  // Falling back to a plain read keeps the badge working against an emulator or
  // an older backend that doesn't serve count().
  let pending;
  try {
    pending = (await query.count().get()).data().count;
  } catch {
    pending = (await query.get()).size;
  }
  return NextResponse.json({ pending });
});
