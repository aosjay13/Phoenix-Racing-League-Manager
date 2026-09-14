import { NextResponse } from "next/server";
import { JOIN_PENDING } from "@/lib/leagueJoin";
import { joinRequestsInScope, withJoinApprover } from "@/lib/leagueJoinServer";

export const dynamic = "force-dynamic";

// The number behind the sidebar's Approvals badge, for the league-join half of
// that queue. Counted through the same scope the list uses, so the badge can
// never promise an admin a job they aren't allowed to see.
//
// Kept as its own route rather than being folded into the sign-up count because
// the two have different permission rules: sign-ups are scoped to the ACTIVE
// league, league joins to the leagues this account runs.
export const GET = withJoinApprover(async (request, ctx, user, scope) => {
  const rows = await joinRequestsInScope(scope, JOIN_PENDING);
  return NextResponse.json({ pending: rows.length, leagues: scope.all ? null : scope.ids.length });
});
