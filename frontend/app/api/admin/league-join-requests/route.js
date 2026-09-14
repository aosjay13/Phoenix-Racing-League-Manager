import { NextResponse } from "next/server";
import { JOIN_APPROVED, JOIN_DENIED, JOIN_PENDING } from "@/lib/leagueJoin";
import { joinRequestsInScope, withJoinApprover } from "@/lib/leagueJoinServer";

export const dynamic = "force-dynamic";

// How many decided rows the history view will look at. The queue is the job;
// the history is only there so an admin can see what they just did.
const RECENT_LIMIT = 100;

const LISTABLE = [JOIN_PENDING, JOIN_APPROVED, JOIN_DENIED];

// The league join queue, scoped to the leagues THIS ACCOUNT RUNS.
//
// The permission rule is the whole point of the route, so it is worth saying
// plainly: a Moderator/Admin/Owner of League A sees people asking to join
// League A and nobody else. Switching the league menu doesn't widen it and
// doesn't narrow it — the scope comes from the account's own role map, never
// from the league on screen (see joinApprovalScope). The application Owner is
// the single exception and sees every league's queue, because somebody has to
// be able to unstick a league whose own staff have gone quiet.
//
//   (none)            → pending requests, oldest first
//   ?status=approved  → recently approved, newest first
//   ?status=denied    → recently denied, newest first
export const GET = withJoinApprover(async (request, ctx, user, scope) => {
  const asked = new URL(request.url).searchParams.get("status");
  const status = LISTABLE.includes(asked) ? asked : JOIN_PENDING;

  const rows = await joinRequestsInScope(scope, status);
  if (status === JOIN_PENDING) {
    return NextResponse.json(rows.map(r => ({ ...r, can_decide: true })));
  }
  // Newest first for the decided lists: what changed most recently is the point.
  rows.sort((a, b) => String(b.resolved_at || "").localeCompare(String(a.resolved_at || "")));
  return NextResponse.json(rows.slice(0, RECENT_LIMIT));
});
