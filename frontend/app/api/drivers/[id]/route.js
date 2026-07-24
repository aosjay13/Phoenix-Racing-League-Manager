import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS, coerceField } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { syncEntryNamesForDriver } from "@/lib/driverSync";
import { buildCareerProfile } from "@/lib/careerStatsServer";
import { computeGameSkillRatings } from "@/lib/skillRatingServer";
import { SR_BASELINE } from "@/lib/skillRating";
import { normalizeAliases } from "@/lib/aliases";

const routes = makeDocRoutes(SPECS.drivers);
export const DELETE = routes.DELETE;

// PATCH a pool driver. Mirrors the generic doc-update, then — when the name (or
// the linked account, which supplies the display name) changes — cascades the
// current name onto every roster entry that resolves to this driver, so the
// rename shows up everywhere old results are displayed. Only the denormalized
// entry.name is touched; no results/stats/profiles are mutated (zero data loss).
export const PATCH = withAdmin(async (request, { params }) => {
  const body = await request.json();
  const updates = {};
  for (const [name, opts] of Object.entries(SPECS.drivers.fields)) {
    if (body[name] !== undefined) {
      const coerced = coerceField(opts, body[name]);
      if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
      updates[name] = coerced.value;
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  const ref = db().collection("drivers").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await ref.update(updates);

  let entries_synced;
  if (updates.name !== undefined || updates.user_id !== undefined) {
    // Name sync is a display convenience — never fail the edit over it.
    try {
      entries_synced = await syncEntryNamesForDriver(params.id, { ...doc.data(), ...updates });
    } catch (err) {
      console.error("Driver name sync failed", err);
    }
  }
  return NextResponse.json({ id: params.id, ...doc.data(), ...updates, ...(entries_synced != null ? { entries_synced } : {}) });
});

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

  // Publicly-displayed connected-account aliases (Discord/PSN/Xbox/…), each
  // optionally mapped to a game. Decorate every mapped alias with its game name
  // so the profile can label it without a second round trip. Only aliases that
  // carry an actual username are shown.
  let aliases = normalizeAliases(driver?.aliases).filter(a => a.value);
  if (aliases.some(a => a.game_id)) {
    const gamesSnap = await db().collection("games").get();
    const gameNameById = Object.fromEntries(gamesSnap.docs.map(d => [d.id, d.data().name]));
    aliases = aliases.map(a => ({ ...a, game_name: a.game_id ? (gameNameById[a.game_id] ?? null) : null }));
  } else {
    aliases = aliases.map(a => ({ ...a, game_name: null }));
  }

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
    aliases,
    former_names: Array.isArray(driver?.merged_names) ? driver.merged_names : [],
    profile,
    ...career,
  });
}
