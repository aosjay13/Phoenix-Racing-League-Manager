import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { APPROVED, APPROVED_FOR_PLACEMENTS, PENDING, isNumberChange } from "@/lib/signupQueue";
import { placementsRequiredFor } from "@/lib/carSelectionServer";

export const dynamic = "force-dynamic";

// How many resolved rows the "recently added" feed will look at. It exists to
// answer "who joined a roster while I wasn't looking?", not to be an audit log
// — the whole history lives in the collection either way.
const RECENT_LIMIT = 100;

// Admin-only: the sign-up queue behind the Driver Roster screen. Approve/deny
// happens at /api/admin/signup-requests/[id].
//
//   ?season_id=…        → one season's PENDING queue (the roster panel)
//   (none)              → every pending sign-up in the active league
//   ?status=approved    → recently APPROVED sign-ups, newest first — who has
//                         been added to which roster, which is what the Driver
//                         Roster badge counts and its "recently added" panel
//                         lists. An approval is otherwise invisible: it creates
//                         a roster entry on a screen the admin may not be
//                         looking at, in a season they may not be scoped to.
//   ?status=approved_for_placements
//                       → registrations acknowledged into a placement session
//                         and on no roster, oldest first. This list is not
//                         optional: approving a placement-gated sign-up takes
//                         it out of the queue by design, and without somewhere
//                         to see it afterwards the driver would simply vanish —
//                         off the queue, off the badge, off every roster, with
//                         nothing anywhere saying a session is owed them.
const LISTABLE_STATUSES = [APPROVED, APPROVED_FOR_PLACEMENTS];

export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const asked = searchParams.get("status");
  const status = LISTABLE_STATUSES.includes(asked) ? asked : PENDING;

  let query = db().collection("signup_requests").where("status", "==", status);
  if (seasonId) query = query.where("season_id", "==", seasonId);
  else query = scopeByLeague(query, getRequestLeagueId(request));

  const snap = await query.get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (status === APPROVED) {
    // Newest first: the point is what changed most recently. Sorted here rather
    // than in the query because `resolved_at` has no index and the collection
    // is small enough that ordering it in memory costs nothing.
    rows.sort((a, b) => String(b.resolved_at || "").localeCompare(String(a.resolved_at || "")));
    return NextResponse.json(rows.slice(0, RECENT_LIMIT));
  }

  if (status === APPROVED_FOR_PLACEMENTS) {
    // Oldest first, and uncapped: this is a to-do list, not a feed. Whoever has
    // been waiting longest for a session is the one to put in the next one, and
    // silently truncating it would hide exactly the people it exists to
    // remember. `placements_required` is implied by the status itself, so no
    // season needs re-reading to say so.
    rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    return NextResponse.json(rows.map(r => ({ ...r, placements_required: true })));
  }

  // Oldest first: whoever has been waiting longest is dealt with first.
  rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  // Which of them are waiting on a PLACEMENT rather than just on a decision.
  // Resolved live (see placementsRequiredFor) so a series switched to
  // "Placements Required" this morning flags the people who signed up for it
  // last week — they're the ones who'd otherwise be approved straight onto the
  // roster the gate exists to keep them off. Number changes are a driver
  // already racing, so nothing is being placed.
  const joins = rows.filter(r => !isNumberChange(r));
  const gated = await placementsRequiredFor(joins);
  return NextResponse.json(rows.map(r => ({
    ...r, placements_required: !isNumberChange(r) && !!gated[r.id],
  })));
});
