import { NextResponse } from "next/server";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { messagesForLeague } from "@/lib/messagesServer";

export const dynamic = "force-dynamic";

// The admin's side of the board: every message in this league, so Approvals
// can show the threads a player has replied to and is waiting on.
//
// League-scoped, so one league's staff never read another's conversations.
// Which of these actually need attention is decided by
// adminThreadsNeedingReply in lib/messages.js — the same rule the badge counts
// on, so the number and the list can't disagree.
export const GET = withAdmin(async (request) => {
  return NextResponse.json(await messagesForLeague(getRequestLeagueId(request)));
});
