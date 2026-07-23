import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { buildCareerProfile } from "@/lib/careerStatsServer";
import { ratingForGame } from "@/lib/skillRating";

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
  // per game the driver has raced in (from career.by_game), each with the
  // driver's current SR in that game and their most-recent trend. A game with a
  // stored rating is "ranked"; one they've raced but that never moved SR shows
  // the 1500 baseline as unranked. Sorted strongest-first.
  const ratingsMap = (driver && driver.skillRatings && typeof driver.skillRatings === "object") ? driver.skillRatings : {};
  const skill_ratings_by_game = (career.by_game || []).map(g => ({
    game_id: g.game_id,
    game_name: g.game_name,
    game_logo_url: g.game_logo_url ?? null,
    rating: ratingForGame(ratingsMap, g.game_id),
    ranked: Object.prototype.hasOwnProperty.call(ratingsMap, g.game_id),
    last_delta: (career.sr_trend_by_game && career.sr_trend_by_game[g.game_id]) ?? null,
  })).sort((a, b) => b.rating - a.rating);

  const { sr_trend_by_game, ...careerPublic } = career;

  return NextResponse.json({
    driver_id: driverId,
    uid: linkedUserId,
    linked: !!(linkedUserId && account),
    // Raw per-game map ({ game_id: rating }) kept for any consumer that needs a
    // direct lookup; the profile UI uses skill_ratings_by_game below.
    skill_ratings: ratingsMap,
    skill_ratings_by_game,
    profile,
    ...careerPublic,
  });
}
