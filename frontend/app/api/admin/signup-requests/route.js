import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { PENDING } from "@/lib/signupQueue";

export const dynamic = "force-dynamic";

// Admin-only: the queue of players waiting to be let onto a roster, powering
// the Pending Sign-ups panel on Drivers ▸ Roster & Teams. Approve/deny happens
// at /api/admin/signup-requests/[id].
//
//   ?season_id=…   → one season's queue (what the roster screen asks for)
//   (none)         → every pending sign-up in the active league
export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");

  let query = db().collection("signup_requests").where("status", "==", PENDING);
  if (seasonId) query = query.where("season_id", "==", seasonId);
  else query = scopeByLeague(query, getRequestLeagueId(request));

  const snap = await query.get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Oldest first: whoever has been waiting longest is dealt with first.
  rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return NextResponse.json(rows);
});
