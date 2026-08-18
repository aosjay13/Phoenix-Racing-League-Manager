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
import { carSelectionSlots, resolveSignupRules, sortRosterByNumber } from "@/lib/carSelection";
import { scopeByLeague } from "@/lib/serverAuth";
import { DENIED, OPEN_STATUSES, PENDING, SIGNUP_KIND } from "@/lib/signupQueue";
import { sortSeasons } from "@/lib/seasonOrder";
import { attachRaceDates, fetchSeasonRaceDates } from "@/lib/seasonOrderServer";

// ── One account, one driver profile PER LEAGUE ─────────────────────────────
//
// A driver profile belongs to exactly one league (`drivers.league_id`), so the
// same person can and should be a different driver in each league they race in:
// "Driver X" in League A and "Driver Y" in League B, each with its own number,
// aliases and race history. The account is the thing that spans leagues; the
// driver is not.
//
// So every lookup here takes the ACTIVE LEAGUE and answers within it. Without
// it, a player would carry League A's profile — and League A's roster, cars and
// sign-ups — into League B's dashboard.
//
// The queries filter in memory rather than adding a second `where`: an account
// holds at most a handful of driver links (one per league it races in), and a
// document written before the containment migration carries no `league_id` at
// all. Those legacy documents still answer, so a league mid-migration keeps
// working — exactly the rule scopeByLeague follows for collections.

// Keep only the rows belonging to one league.
function inLeague(docs, leagueId) {
  return leagueId ? docs.filter(d => d.league_id == null || d.league_id === leagueId) : docs;
}

// The one row for this league: its own if it has one, otherwise a legacy row
// with no league at all, otherwise nothing.
function pickForLeague(docs, leagueId) {
  if (!docs.length) return null;
  if (!leagueId) return docs[0];
  return docs.find(d => d.league_id === leagueId)
    || docs.find(d => d.league_id == null)
    || null;
}

// The driver profile linked to this account IN THIS LEAGUE, or null. (The claim
// flow enforces at most one per league — see /api/claim-requests.)
export async function linkedDriver(uid, leagueId = "") {
  const snap = await db().collection("drivers").where("user_id", "==", uid).get();
  return pickForLeague(snap.docs.map(d => ({ id: d.id, ...d.data() })), leagueId);
}

// Every driver profile linked to this account, across every league — the one
// question that is deliberately NOT scoped, because it is what tells an admin
// whether deleting an account would take another league's driver with it.
export async function linkedDriversAllLeagues(uid) {
  const snap = await db().collection("drivers").where("user_id", "==", uid).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// This account's open (pending) driver-claim request IN THIS LEAGUE, or null —
// a user waiting on an admin can't sign up yet, and should be told that rather
// than being offered the claim screen again. Waiting on League A's admin is no
// reason to be blocked in League B, hence the scope.
export async function pendingClaim(uid, leagueId = "") {
  const snap = await db().collection("claim_requests")
    .where("uid", "==", uid).where("status", "==", "pending").get();
  return pickForLeague(snap.docs.map(d => ({ id: d.id, ...d.data() })), leagueId);
}

// ── Reading the in-flight queue ────────────────────────────────────────────
//
// Every "who is still in flight?" read goes through these two, and both fetch
// one status at a time and merge, rather than asking for `status in [...]` in a
// single query.
//
// That is deliberate, and it is about not breaking a running league. The single
// `in` form is one query instead of two and almost certainly works — but
// "almost certainly" is doing real work in that sentence: an `in` filter beside
// an equality filter is the shape Firestore is most likely to answer with
// FAILED_PRECONDITION and a link to create a composite index, and there is no
// way to find that out except in production. These paths are the sign-up form's
// roster peek, its number check and the whole of /api/users/me/series, so
// getting it wrong doesn't degrade a feature, it takes sign-ups down for
// everybody. Two queries of a shape this app has always run cost one extra
// round trip on a path that already makes several, and cannot fail that way.
async function requestsByStatus(field, value, statuses = OPEN_STATUSES) {
  const snaps = await Promise.all(statuses.map(status =>
    db().collection("signup_requests")
      .where(field, "==", value).where("status", "==", status).get()));
  return snaps.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

// One season's in-flight requests — pending decisions AND registrations
// approved into a placement session. Both still spend a car number and both
// still stop their owner filing a second sign-up.
export function openRequestsForSeason(seasonId) {
  return requestsByStatus("season_id", seasonId);
}

// Every sign-up this ACCOUNT has waiting on an admin, across every season.
//
// Read for the platform usernames they carry: until an approval creates the
// driver profile, a first-time player's answers live here and nowhere else, and
// the sign-up form seeds itself from them so nobody is asked the same thing
// twice in one sitting. See knownAliasesFor in lib/signupRequest.js.
// Scoped to the active league: an answer this account gave on a League A
// sign-up is not something League B's form should be pre-filling itself with.
export async function pendingRequestsForUser(uid, { leagueId = "" } = {}) {
  if (!uid) return [];
  return inLeague(await requestsByStatus("uid", uid), leagueId);
}

// Sign-ups of this account's that an admin turned down.
//
// Read so the player can be told WHY, on the screen and by email — a denial
// nobody hears about is indistinguishable from a sign-up that vanished, and
// they re-submit the identical form. Capped because this only ever feeds a
// notice: the whole history stays in the collection.
export async function deniedRequestsForUser(uid, { leagueId = "", limit = 20 } = {}) {
  if (!uid) return [];
  const snap = await db().collection("signup_requests")
    .where("uid", "==", uid).where("status", "==", DENIED).get();
  return inLeague(snap.docs.map(d => ({ id: d.id, ...d.data() })), leagueId)
    .sort((a, b) => String(b.resolved_at || "").localeCompare(String(a.resolved_at || "")))
    .slice(0, limit);
}

// A season plus everything the sign-up rules need to resolve against it.
//
// The GAME is part of that: it's the top of the game → series → season → class
// requirement chain (a league can say "everything in iRacing needs a car
// number" once), and it carries the platform identities every sign-up under it
// must give. Resolving a season without its game would silently drop both, so
// it's loaded here rather than by each caller.
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
  // A season written before it stamped its own game_id resolves through its
  // series, the same fallback every other screen uses.
  const gameId = season.game_id || series?.game_id || "";
  const gameDoc = gameId ? await db().collection("games").doc(gameId).get() : null;
  const game = gameDoc?.exists ? { id: gameDoc.id, ...gameDoc.data() } : null;
  const classes = classesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
  return { season, series, game, classes, slots: carSelectionSlots({ game, series, season, classes }) };
}

// Which of these queued requests sit behind a PLACEMENTS gate, as of right now
// — `{ [requestId]: true|false }`, for the "Awaiting Placement" flag on the
// admin queue.
//
// Resolved live rather than read off the stored `placements_required`, for the
// same reason approval re-checks the number and the car: a queue is exactly
// where stale data comes from. An admin who ticks "Placements Required" on a
// series today needs the drivers already waiting in it flagged too — those rows
// were stamped before the tick, and they're precisely the ones most likely to
// be let through by mistake. The stamped value is kept as the fallback, so a
// season that has since been deleted still reports what the player was told.
//
// One context load per DISTINCT season, not per row: a league-wide queue is
// mostly several people waiting on the same handful of seasons.
//
// `loadContext` is the season lookup, injected so the decision above it can be
// tested without a database — the same seam `assignRowToBucket` uses for its
// class lookup in lib/placements.js. Callers pass nothing.
//
// `strict` changes what a FAILED lookup means, and the two callers genuinely
// want opposite things:
//
//   the queue (default)  never fail a screen over this. The rows still have to
//                        render, so a season that won't load falls back to what
//                        its row was stamped with, and the worst case is a badge
//                        that's out of date.
//   the approval (strict) refuse rather than guess. Falling back to the stamp
//                        there would seat a driver whose series was gated AFTER
//                        they signed up — stamped `false`, gated now — which is
//                        precisely the case the live resolution exists for, and
//                        putting somebody on a grid they haven't raced for is
//                        not a failure mode worth trading for one retry.
export async function placementsRequiredFor(
  rows = [], { loadContext = seasonContext, strict = false } = {},
) {
  const seasonIds = [...new Set(rows.map(r => r?.season_id).filter(Boolean))];
  const contexts = new Map();
  await Promise.all(seasonIds.map(async id => {
    try {
      contexts.set(id, await loadContext(id));
    } catch (err) {
      if (strict) throw err;
      console.error("Placements gate lookup failed", id, err);
      contexts.set(id, null);
    }
  }));

  const out = {};
  for (const row of rows) {
    const context = contexts.get(row?.season_id) || null;
    if (!context) {
      out[row.id] = !!row?.placements_required;
      continue;
    }
    const { season, series, game, classes } = context;
    // Against the class they asked for, so a gated Pro class inside an ungated
    // season flags — and an ungated class inside a gated season doesn't.
    //
    // The FIRST class on the request answers for it, which is what POST
    // /api/signup-requests resolved against when it stamped the row. Matching on
    // "whichever of the season's classes this row mentions" instead would walk
    // them in the season's display order, so a driver in two classes could be
    // flagged against a different one than they were told about.
    const firstClassId = String((row?.class_ids || [])[0] ?? "");
    const cls = classes.find(c => c.id === firstClassId) || null;
    out[row.id] = resolveSignupRules({ game, series, season, cls }).require_placements;
  }
  return out;
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
        // The car they hold, so the sign-up form can show what everyone is
        // running AND count it against a capped car's limit. Without this the
        // form counted only the sign-ups still queued, so a car filled by
        // drivers already on the roster looked wide open — and the "· 2
        // already" hint beside each car never had anything to show.
        // `selected_cars` is the per-class shape a season whose classes run
        // their own lists writes; both are carried so carCounts sees all of it.
        car: entry.selected_car || "",
        selected_car: entry.selected_car || "",
        ...(entry.selected_cars ? { selected_cars: entry.selected_cars } : {}),
      };
    })),
  ]));
}

// The IN-FLIGHT requests of several seasons at once, keyed by season id. Carries
// BOTH kinds — sign-ups and car-number changes — because both spend a number:
// whether somebody is asking to join on #24 or asking to move to #24, offering
// it to the next player as free just makes work for the admin resolving them.
// `kind` is what tells them apart downstream (see lib/signupQueue.js).
//
// "In flight" is wider than "in the admin's queue": a registration approved for
// placements has been acknowledged but seats nobody, so its number is still
// spoken for and its owner still can't file a second sign-up. `status` rides
// along so a caller can tell "waiting on a decision" from "waiting on a
// session" — see OPEN_STATUSES in lib/signupQueue.js.
export async function pendingForSeasons(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return {};
  const perSeason = await Promise.all(ids.map(openRequestsForSeason));
  return Object.fromEntries(ids.map((id, i) => [
    id,
    perSeason[i].map(r => {
      return {
        id: r.id,
        // Which kind of request this is — a sign-up ("let me in") or a number
        // change ("move my number"). Everything downstream branches on it: the
        // roster peek must not render a number change as another person waiting
        // to join, but its number IS spoken for. See lib/signupQueue.js.
        kind: r.kind || SIGNUP_KIND,
        status: r.status || PENDING,
        uid: r.uid,
        driver_id: r.driver_id ?? null,
        entry_id: r.entry_id ?? null,
        name: r.name || r.driver_name || "Driver",
        number: r.number ?? null,
        current_number: r.current_number ?? null,
        reason: r.reason || "",
        car: r.car || "",
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
  const rawSeasons = seasonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!rawSeasons.length) return { seasons: [], seriesById: {}, gamesById: {}, classesBySeason: {} };
  // Carry each season's race dates, so this screen orders its seasons by when
  // they raced exactly like the dropdowns do — see newestFirst below.
  const seasons = attachRaceDates(rawSeasons, await fetchSeasonRaceDates(rawSeasons.map(s => s.id)));

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

// Newest first — the same ordering the season dropdown uses (by the race dates
// on the schedule, with any hand-set order winning; see lib/seasonOrder.js), so
// the season someone is racing now is at the top of their list. Feed it seasons
// that have been through attachRaceDates, as leagueSeasonIndex does.
export function newestFirst(seasons) {
  return sortSeasons(seasons);
}
