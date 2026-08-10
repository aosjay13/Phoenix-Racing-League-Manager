// Firestore reads behind the car lock-in / series sign-up routes, on top of the
// pure rules in lib/carSelection.js — the same split as classFilter/classServer.
//
// Everything a player does here is done AS the driver profile linked to their
// account, never as a driver id they send us: linkedDriver() below resolves the
// caller's own profile from drivers.user_id, and every write is keyed off that.
// That's the whole of the ownership check — a request simply has no way to name
// someone else's driver.

import { db } from "@/lib/firebase";
import { entryClassIds, orderClassIds } from "@/lib/classFilter";
import { carSelectionSlots, sortRosterByNumber } from "@/lib/carSelection";
import { scopeByLeague } from "@/lib/serverAuth";

// The one driver profile linked to this account, or null. (The claim flow
// enforces at most one — see /api/claim-requests.)
export async function linkedDriver(uid) {
  const snap = await db().collection("drivers").where("user_id", "==", uid).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// This account's open (pending) driver-claim request, or null — a user waiting
// on an admin can't sign up yet, and should be told that rather than being
// offered the claim screen again.
export async function pendingClaim(uid) {
  const snap = await db().collection("claim_requests")
    .where("uid", "==", uid).where("status", "==", "pending").limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// A season plus everything the lock-in rules need to resolve against it.
export async function seasonContext(seasonId) {
  const doc = await db().collection("seasons").doc(seasonId).get();
  if (!doc.exists) return null;
  const season = { id: doc.id, ...doc.data() };
  const [seriesDoc, classesSnap] = await Promise.all([
    season.series_id
      ? db().collection("series").doc(season.series_id).get()
      : Promise.resolve(null),
    db().collection("classes").where("season_id", "==", seasonId).get(),
  ]);
  const series = seriesDoc?.exists ? { id: seriesDoc.id, ...seriesDoc.data() } : null;
  const classes = classesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
  return { season, series, classes, slots: carSelectionSlots({ series, season, classes }) };
}

// Every roster entry in a season, with each driver's classes put into the
// season's display order so "primary class" means the same thing here as it
// does everywhere else.
export async function seasonEntries(seasonId, classes = []) {
  const snap = await db().collection("entries").where("season_id", "==", seasonId).get();
  return snap.docs.map(d => {
    const entry = { id: d.id, ...d.data() };
    const class_ids = orderClassIds(entryClassIds(entry), classes);
    return { ...entry, class_ids, class_id: class_ids[0] || "" };
  });
}

// The public (non-admin) roster of several seasons at once, as
// { [seasonId]: [{ number, name, class_ids }] } in car-number order.
//
// This is what a driver signing up reads to find a free number, so it carries
// the name each driver races under in THAT series (entries.name) rather than
// resolving profile names — the per-series alias is the right label here, and
// it keeps the read to one query per season.
export async function rostersForSeasons(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return {};
  const snaps = await Promise.all(
    ids.map(id => db().collection("entries").where("season_id", "==", id).get()));
  return Object.fromEntries(ids.map((id, i) => [
    id,
    sortRosterByNumber(snaps[i].docs.map(d => {
      const entry = d.data();
      return {
        number: entry.number ?? null,
        name: entry.name || "Driver",
        class_ids: entryClassIds(entry),
      };
    })),
  ]));
}

// The pending sign-ups of several seasons at once, as
// { [seasonId]: [{ id, name, number, car, manufacturer, class_names, uid }] }.
// Feeds the sign-up form's "already requested" list — a number somebody is
// waiting on shouldn't be offered to the next player as if it were free.
export async function pendingForSeasons(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return {};
  const snaps = await Promise.all(ids.map(id =>
    db().collection("signup_requests")
      .where("season_id", "==", id).where("status", "==", "pending").get()));
  return Object.fromEntries(ids.map((id, i) => [
    id,
    snaps[i].docs.map(d => {
      const r = d.data();
      return {
        id: d.id,
        uid: r.uid,
        driver_id: r.driver_id ?? null,
        name: r.name || r.driver_name || "Driver",
        number: r.number ?? null,
        car: r.car || "",
        manufacturer: r.manufacturer || "",
        class_names: r.class_names || [],
      };
    }),
  ]));
}

// Every entry this driver holds anywhere, by both routes into an entry (the
// driver profile, and the older direct account link). Deduped by entry id.
export async function entriesForDriver({ driverId, uid }) {
  const queries = [];
  if (driverId) queries.push(db().collection("entries").where("driver_id", "==", driverId).get());
  if (uid) queries.push(db().collection("entries").where("user_id", "==", uid).get());
  if (!queries.length) return [];
  const snaps = await Promise.all(queries);
  const byId = new Map();
  for (const snap of snaps) {
    for (const d of snap.docs) byId.set(d.id, { id: d.id, ...d.data() });
  }
  return [...byId.values()];
}

// The league's seasons, their series and their games, plus every class grouped
// by season — one pass, for the "my series / open sign-ups" screen which spans
// the whole league rather than one season.
export async function leagueSeasonIndex(leagueId) {
  const seasonsSnap = await scopeByLeague(db().collection("seasons"), leagueId).get();
  const seasons = seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!seasons.length) return { seasons: [], seriesById: {}, gamesById: {}, classesBySeason: {} };

  const seriesIds = [...new Set(seasons.map(s => s.series_id).filter(Boolean))];
  const gameIds = [...new Set(seasons.map(s => s.game_id).filter(Boolean))];
  const [seriesDocs, gameDocs, classesSnap] = await Promise.all([
    Promise.all(seriesIds.map(id => db().collection("series").doc(id).get())),
    Promise.all(gameIds.map(id => db().collection("games").doc(id).get())),
    // One read filtered in memory, like /api/classes: a league's class list is
    // small and Firestore caps an `in` query at 30 values.
    db().collection("classes").get(),
  ]);

  const seasonIdSet = new Set(seasons.map(s => s.id));
  const classesBySeason = {};
  for (const d of classesSnap.docs) {
    const cls = { id: d.id, ...d.data() };
    if (!seasonIdSet.has(cls.season_id)) continue;
    (classesBySeason[cls.season_id] ??= []).push(cls);
  }
  for (const list of Object.values(classesBySeason)) {
    list.sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
  }

  return {
    seasons,
    seriesById: Object.fromEntries(seriesDocs.filter(d => d.exists).map(d => [d.id, { id: d.id, ...d.data() }])),
    gamesById: Object.fromEntries(gameDocs.filter(d => d.exists).map(d => [d.id, { id: d.id, ...d.data() }])),
    classesBySeason,
  };
}

// Newest first, by creation order — the same ordering the season dropdown uses,
// reversed, so the season someone is racing now is at the top of their list.
export function newestFirst(seasons) {
  return [...seasons].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
