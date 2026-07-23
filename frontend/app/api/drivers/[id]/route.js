import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { buildCareerProfile } from "@/lib/careerStatsServer";
import { computeGameSkillRatings } from "@/lib/skillRatingServer";
import { SR_BASELINE } from "@/lib/skillRating";

const routes = makeDocRoutes(SPECS.drivers);
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;

// Public profile + career stats for any driver — linked to an account or not.
// `id` is a global driver-pool id, but for backward compatibility with links
// that still pass a Firebase account uid, we fall back to resolving that uid
// to its pool driver. This means every racer has a reachable profile, whether
// or not they've made an account.
export async function GET(request, { params }) {
  const id = params.id;

  let driverId = null;
  let driver = null;
  let linkedUserId = null;

  const driverDoc = await db().collection("drivers").doc(id).get();
  if (driverDoc.exists) {
    driverId = id;
    driver = driverDoc.data();
    linkedUserId = driver.user_id || null;
  } else {
    // Maybe `id` is an account uid (older profile links).
    const userDoc = await db().collection("users").doc(id).get();
    if (!userDoc.exists) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    linkedUserId = id;
    const poolSnap = await db().collection("drivers").where("user_id", "==", id).limit(1).get();
    if (!poolSnap.empty) {
      driverId = poolSnap.docs[0].id;
      driver = poolSnap.docs[0].data();
    }
  }

  // Merge the linked account's public profile (photo, bio, country, number)
  // over the pool driver's bare name.
  let account = null;
  if (linkedUserId) {
    const u = await db().collection("users").doc(linkedUserId).get();
    if (u.exists) { const { email, role, ...pub } = u.data(); account = pub; }
  }

  const profile = {
    display_name: account?.display_name || driver?.name || "Unknown Driver",
    photo_url: account?.photo_url ?? null,
    country: account?.country ?? null,
    bio: account?.bio ?? null,
    number: account?.number ?? null,
  };

  const career = await buildCareerProfile({ driverId, userId: linkedUserId });

  // Per-game Skill Ratings for the profile's "Skill Ratings" section: one entry
  // per game the driver has raced in (from career.by_game). Rating and trend
  // come from the authoritative chronological replay (computeGameSkillRatings),
  // the same source the leaderboard uses — so the two always agree and neither
  // depends on the order results were entered. A game the driver raced but that
  // never moved their SR shows the 1500 baseline as unranked. Sorted strongest-
  // first.
  const games = career.by_game || [];
  const replays = await Promise.all(games.map(g => computeGameSkillRatings(g.game_id)));
  const skill_ratings_by_game = games.map((g, i) => {
    const rec = driverId ? replays[i].ratings[driverId] : null;
    return {
      game_id: g.game_id,
      game_name: g.game_name,
      game_logo_url: g.game_logo_url ?? null,
      rating: rec ? rec.rating : SR_BASELINE,
      ranked: !!rec,
      last_delta: rec ? rec.last_delta : null,
    };
  }).sort((a, b) => b.rating - a.rating);

  return NextResponse.json({
    driver_id: driverId,
    uid: linkedUserId,
    linked: !!(linkedUserId && account),
    skill_ratings_by_game,
    profile,
    ...career,
  });
}
