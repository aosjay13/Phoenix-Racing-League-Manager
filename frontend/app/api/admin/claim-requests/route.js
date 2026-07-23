import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Admin-only: the queue of pending driver-profile claim requests awaiting
// approval, powering the Admin ▸ User Accounts review panel and the sidebar
// alert badge. Approve/deny happens at /api/admin/claim-requests/[id].
export const GET = withAdmin(async () => {
  const snap = await db().collection("claim_requests").where("status", "==", "pending").get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return NextResponse.json(rows);
});
