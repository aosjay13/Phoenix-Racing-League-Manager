import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, legacyLeagueId } from "@/lib/serverAuth";
import { isLeagueMember } from "@/lib/leagueRoles";
import { linkedDriver } from "@/lib/carSelectionServer";
import { buildCareerProfile } from "@/lib/careerStatsServer";

// Public profile + career stats FOR THE ACTIVE LEAGUE, grouped per game (and
// all games combined).
//
// Two things are scoped, and both matter:
//
//   • The account has to be a member of this league at all. A player of League A
//     has no profile page inside League B — answering one would publish who is
//     in which league to anybody who could guess a uid.
//   • The driver profile and the career built from it are this league's. The
//     same account races as a different driver in each league it belongs to, and
//     a career page that blended the two would credit League B with wins scored
//     in League A.
export async function GET(request, { params }) {
  const uid = params.uid;
  const leagueId = getRequestLeagueId(request);
  const userDoc = await db().collection("users").doc(uid).get();
  if (!userDoc.exists) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  if (leagueId && !isLeagueMember(userDoc.data(), leagueId, { legacyLeagueId: await legacyLeagueId() })) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }
  const { email, role, league_roles, ...publicProfile } = userDoc.data();

  // Include the linked pool driver so entries carrying only a driver_id
  // (no user_id) still count toward this account's stats — the profile they
  // race as in THIS league.
  const driver = await linkedDriver(uid, leagueId);

  const career = await buildCareerProfile({ driverId: driver?.id || null, userId: uid, leagueId });

  return NextResponse.json({
    uid,
    driver_id: driver?.id || null,
    linked: true,
    profile: publicProfile,
    ...career,
  });
}
