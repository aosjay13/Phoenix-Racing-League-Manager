import { db } from "@/lib/firebase";
import {
  contextNames, iracingGameIds, isIracingGameId, isIracingIdentity,
} from "@/lib/iracingPrivacy";

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

  // Which of the league's games are iRacing, so a name that iRacing forces to
  // be a real one is resolved for iRacing pages and for nothing else (see
  // lib/iracingPrivacy.js). One read of a collection that holds a handful of
  // documents.
  const gamesSnap = await db().collection("games").get();
  const iracingIds = iracingGameIds(gamesSnap.docs.map(d => ({ id: d.id, name: d.data().name })));

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

  // The server has no cheap way to ask "does this driver race in iRacing and
  // nowhere else?" — that needs their entries, which none of these callers
  // reads — so it never claims they do. The effect is the safe one: a global
  // name resolved here is the generic one. The Driver Profile, which DOES know,
  // makes that call itself (see app/api/drivers/[id]).
  const namesFor = (id, gameId) => {
    const d = byId[id];
    if (!d) return { overall: null, game: null, display: null };
    return contextNames(d, { gameId, iracingIds, accountName: d.user_id ? accountName[d.user_id] : null });
  };
  return {
    ids: Object.keys(byId),
    namesFor,
    overall: id => namesFor(id, null).overall,
    forGame: (id, gameId) => namesFor(id, gameId).game,
    display: (id, gameId) => namesFor(id, gameId).display,
    // Would printing this stored string expose the driver's iRacing name here?
    // For the documents that carry a denormalized copy of a name — a roster
    // entry, a time-trial row — which is left in place and only stood in for
    // when it is one this context may not show.
    hides: (id, value, gameId) =>
      !!byId[id] && !isIracingGameId(gameId, iracingIds) && isIracingIdentity(byId[id], value, iracingIds),
  };
}

// The name to SHOW for each of a set of rows that carry their own stored name
// ({ driver_id, name }), in one game's context. The stored name stands unless
// it is the driver's iRacing one and this game is not iRacing, in which case
// the resolved generic name takes its place. Nothing is written back.
export async function fetchShownNames(rows = [], gameId = null) {
  const r = await fetchNameResolver(rows.map(row => row?.driver_id));
  return rows.map(row => {
    const stored = row?.name ?? "";
    if (!row?.driver_id || !r.hides(row.driver_id, stored, gameId)) return stored;
    return r.display(row.driver_id, gameId) || stored;
  });
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
  for (const id of r.ids) out[id] = r.namesFor(id, gameId);
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
