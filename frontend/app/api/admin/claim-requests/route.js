import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withAdmin } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Admin-only: the queue of pending driver-profile claim requests awaiting
// approval, powering the Admin ▸ User Accounts review panel and the sidebar
// alert badge. Approve/deny happens at /api/admin/claim-requests/[id].
export const GET = withAdmin(async (request, ctx, admin, role, leagueId) => {
  const snap = await db().collection("claim_requests").where("status", "==", "pending").get();
  // This league's queue only. A claim is a request to race in one league, and
  // its admins are the only people who get to answer it.
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => docInLeague(r, leagueId));
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return NextResponse.json(rows);
});
