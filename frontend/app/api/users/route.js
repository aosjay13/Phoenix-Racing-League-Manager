import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, legacyLeagueId } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";
import { publicUserFields } from "@/lib/userPrivacy";

export const dynamic = "force-dynamic";

// Public player directory for the ACTIVE LEAGUE (no emails, no roles exposed).
//
// Scoped like everything else: an account with no standing in this league is
// not one of this league's players, and listing it here would leak the
// membership of every other league on the installation. An unscoped request
// (no league selected, e.g. before the containment migration) still answers
// with everyone, which is what it always did.
export async function GET(request) {
  const leagueId = getRequestLeagueId(request);
  const [snap, legacy] = await Promise.all([
    db().collection("users").get(),
    leagueId ? legacyLeagueId() : Promise.resolve(null),
  ]);
  const users = snap.docs
    .filter(d => !leagueId || isLeagueMember(d.data(), leagueId, { legacyLeagueId: legacy }))
    // Stripped through one shared list rather than a destructure per route —
    // see lib/userPrivacy.js for why that matters.
    .map(d => ({ uid: d.id, ...publicUserFields(d.data()) }));
  users.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  return NextResponse.json(users);
}
