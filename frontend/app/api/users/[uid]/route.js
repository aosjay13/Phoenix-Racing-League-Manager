import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { buildCareerProfile } from "@/lib/careerStatsServer";

// Public profile + career stats, grouped per game (and all games combined).
export async function GET(request, { params }) {
  const uid = params.uid;
  const userDoc = await db().collection("users").doc(uid).get();
  if (!userDoc.exists) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const { email, role, ...publicProfile } = userDoc.data();

  // Include the linked pool driver so entries carrying only a driver_id
  // (no user_id) still count toward this account's stats.
  const poolSnap = await db().collection("drivers").where("user_id", "==", uid).limit(1).get();
  const driverId = poolSnap.empty ? null : poolSnap.docs[0].id;

  const career = await buildCareerProfile({ driverId, userId: uid });

  return NextResponse.json({
    uid,
    driver_id: driverId,
    linked: true,
    profile: publicProfile,
    ...career,
  });
}
