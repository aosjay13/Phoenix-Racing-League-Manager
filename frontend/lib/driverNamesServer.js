import { db } from "@/lib/firebase";
import { gameNameFor, overallNameFor } from "@/lib/driverNames";

// Server-side name resolution: the database half of lib/driverNames.js, which
// holds the pure rules. Kept apart so the edit modal (a client component) can
// import those rules without pulling firebase-admin into the browser bundle.

// Load a set of pool drivers (plus any linked accounts) once, and hand back a
// resolver that can answer for ANY game — for pages like a venue's history,
// where each row belongs to a different game.
//
//   r.overall(driverId)             → their overall display name
//   r.forGame(driverId, gameId)     → their name in that game, or null
//   r.display(driverId, gameId)     → what to render: the game's name, else overall
export async function fetchNameResolver(driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  const byId = {};
  const accountName = {};

  if (ids.length) {
    const docs = await Promise.all(ids.map(id => db().collection("drivers").doc(id).get()));
    for (const d of docs) if (d.exists) byId[d.id] = { id: d.id, ...d.data() };

    // Linked accounts supply the overall fallback name, so pull the ones we need.
    const userIds = [...new Set(Object.values(byId).map(d => d.user_id).filter(Boolean))];
    if (userIds.length) {
      const users = await Promise.all(userIds.map(uid => db().collection("users").doc(uid).get()));
      for (const u of users) if (u.exists) accountName[u.id] = String(u.data().display_name ?? "").trim();
    }
  }

  const overall = id => {
    const d = byId[id];
    return d ? overallNameFor(d, d.user_id ? accountName[d.user_id] : null) : null;
  };
  const forGame = (id, gameId) => (byId[id] ? gameNameFor(byId[id], gameId) : null);
  return { ids: Object.keys(byId), overall, forGame, display: (id, gameId) => forGame(id, gameId) || overall(id) };
}

// Resolve display names for a set of pool drivers in one round trip.
//
// Returns { [driverId]: { overall, game, display } } where `game` is null
// unless a gameId is passed AND that driver has a name set for it, and
// `display` is the name to actually render in that context (the per-game name
// when there is one, else the overall name).
export async function fetchDriverNames(driverIds, gameId = null) {
  const r = await fetchNameResolver(driverIds);
  const out = {};
  for (const id of r.ids) {
    const game = r.forGame(id, gameId);
    out[id] = { overall: r.overall(id), game, display: game || r.overall(id) };
  }
  return out;
}

// Which game a Game/Series/Season scope belongs to, or null for a league-wide
// (all games) scope — the lookup every scope-aware stats route needs before it
// can ask for per-game names. Accepts the same query params those routes take.
export async function gameIdForScope({ scope, gameId = null, seriesId = null, seasonId = null }) {
  if (scope === "game") return gameId || null;
  if (scope === "series" && seriesId) {
    const doc = await db().collection("series").doc(seriesId).get();
    return doc.exists ? doc.data().game_id || null : null;
  }
  if (scope === "season" && seasonId) {
    const doc = await db().collection("seasons").doc(seasonId).get();
    return doc.exists ? doc.data().game_id || null : null;
  }
  return null;
}
