import { NextResponse } from "next/server";
import { makeDocRoutes, SPECS, coerceField } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { docInLeague, getRequestLeagueId, getRequestUser, isAdmin, withAdmin } from "@/lib/serverAuth";
import { linkedDriver } from "@/lib/carSelectionServer";
import { syncEntryNamesForDriver } from "@/lib/driverSync";
import { normalizeAliases } from "@/lib/aliases";
import { publicUserFields } from "@/lib/userPrivacy";
import { normalizeGameNames } from "@/lib/driverNames";
import {
  iracingGameIds, iracingIdentityValues, iracingNameFor, isIracingIdentity, publicNameFor,
} from "@/lib/iracingPrivacy";

const routes = makeDocRoutes(SPECS.drivers);
export const DELETE = routes.DELETE;

// PATCH a pool driver. Mirrors the generic doc-update, then — when the name (or
// the linked account, which supplies the display name) changes — cascades the
// current name onto every roster entry that resolves to this driver, so the
// rename shows up everywhere old results are displayed. Only the denormalized
// entry.name is touched; no results/stats/profiles are mutated (zero data loss).
export const PATCH = withAdmin(async (request, { params }, user, role, patchLeagueId) => {
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
  // Display-name fields are stored clean: the overall override trimmed (blank =
  // "no override", falling back to the linked account / pool name), and the
  // per-game names stripped of half-filled and duplicate rows.
  if (updates.display_name !== undefined) updates.display_name = String(updates.display_name ?? "").trim();
  if (updates.game_names !== undefined) updates.game_names = normalizeGameNames(updates.game_names);

  const ref = db().collection("drivers").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A driver belongs to exactly one league, so editing one — including
  // re-pointing its `user_id` link — is this league's staff's job alone.
  if (!docInLeague(doc.data(), patchLeagueId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await ref.update(updates);

  let entries_synced;
  // The overall display name is denormalized onto roster entries, so a change
  // to it cascades exactly like a rename does. (Per-game names are resolved at
  // read time and never touch stored entries.)
  if (updates.name !== undefined || updates.user_id !== undefined || updates.display_name !== undefined) {
    // Name sync is a display convenience — never fail the edit over it.
    try {
      entries_synced = await syncEntryNamesForDriver(params.id, { ...doc.data(), ...updates });
    } catch (err) {
      console.error("Driver name sync failed", err);
    }
  }
  return NextResponse.json({ id: params.id, ...doc.data(), ...updates, ...(entries_synced != null ? { entries_synced } : {}) });
});

// Who a driver IS — and nothing about how they race.
//
// `id` is a global driver-pool id, but for backward compatibility with links
// that still pass a Firebase account uid, we fall back to resolving that uid
// to its pool driver. This means every racer has a reachable profile, whether
// or not they've made an account.
//
// The career itself — every game, venue, race and championship, plus the
// per-game Skill Ratings — is NOT computed here any more. It used to be, and it
// made this the most expensive route in the app by a factor of two: a profile
// view replayed every season the driver had raced and then the whole Elo
// timeline of every game they had appeared in, which on four years of history is
// north of fifty thousand documents decoded per visit. The browser does it now,
// off the same raw league bundle the Stats and Records screens use (see
// lib/careerCompute.js).
//
// What is left is the half a browser genuinely cannot do for itself: resolving
// the identity, and reading the linked account through publicUserFields so that
// an email address, a role map and recovery state stay on the server where they
// belong. Those are a handful of document reads and no arithmetic.
export async function GET(request, { params }) {
  const id = params.id;
  const leagueId = getRequestLeagueId(request);

  let driverId = null;
  let driver = null;
  let linkedUserId = null;

  const driverDoc = await db().collection("drivers").doc(id).get();
  if (driverDoc.exists) {
    // A driver belongs to exactly one league; asking for one from another
    // league's page is a miss, not a profile.
    if (!docInLeague(driverDoc.data(), leagueId)) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }
    driverId = id;
    driver = driverDoc.data();
    linkedUserId = driver.user_id || null;
  } else {
    // Maybe `id` is an account uid (older profile links) — in which case the
    // profile shown is the one that account races as HERE.
    const userDoc = await db().collection("users").doc(id).get();
    if (!userDoc.exists) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    linkedUserId = id;
    const mine = await linkedDriver(id, leagueId);
    if (mine) {
      driverId = mine.id;
      driver = mine;
    }
  }

  // Merge the linked account's public profile (photo, bio, country, number)
  // over the pool driver's bare name.
  let account = null;
  if (linkedUserId) {
    const u = await db().collection("users").doc(linkedUserId).get();
    if (u.exists) account = publicUserFields(u.data());
  }

  // Staff see the profile whole. Deciding who a driver IS — linking an account,
  // merging a duplicate, checking that the name a result imported under belongs
  // to this person — is an admin's job, and none of it can be done through a
  // name the page has taken out. So an admin viewer gets the iRacing name and
  // the former names as stored; everyone else gets the protected view.
  const viewer = await getRequestUser(request);
  const staff = !!viewer && await isAdmin(viewer, leagueId);

  // Which of this league's games are iRacing, so the one name this profile may
  // not lead with can be told apart from every other name it holds.
  const gamesSnap = await db().collection("games").get();
  const games = gamesSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
  const gameNameById = Object.fromEntries(games.map(g => [g.id, g.name]));
  const iracingIds = iracingGameIds(games);

  // The overall display name — and here it is deliberately NOT the raw one.
  //
  // iRacing makes its members race under their legal name, so for a driver who
  // also races anything else, that name heading their global profile is exactly
  // the exposure this app has to prevent. So the header gets the generic name
  // (the admin-set display name, the linked account's, a gamertag), the iRacing
  // one travels separately as `iracing_name`, and the browser — which knows
  // from their results whether iRacing is the ONLY game they play — decides
  // whether the header may show it after all. See app/drivers/[uid].
  const profile = {
    display_name: publicNameFor(driver, { accountName: account?.display_name, iracingIds }) || "Unknown Driver",
    // Their name on iRacing, for the profile's iRacing section — and for the
    // header when they race nowhere else, since then it is simply their name.
    iracing_name: iracingNameFor(driver, iracingIds),
    photo_url: account?.photo_url ?? null,
    country: account?.country ?? null,
    bio: account?.bio ?? null,
    number: account?.number ?? null,
  };

  // Publicly-displayed connected-account aliases (Discord/PSN/Xbox/…), each
  // optionally mapped to a game. Decorate every mapped alias with its game name
  // so the profile can label it without a second round trip. Only aliases that
  // carry an actual username are shown.
  //
  // Each one also says whether it is an IRACING identity — the real name, the
  // customer id — because those belong in the profile's iRacing section and
  // nowhere else on the page (see the Aliases list in app/drivers/[uid]).
  const hidden = new Set(iracingIdentityValues(driver, iracingIds));
  const aliases = normalizeAliases(driver?.aliases)
    .filter(a => a.value)
    .map(a => ({
      ...a,
      game_name: a.game_id ? (gameNameById[a.game_id] ?? null) : null,
      iracing: hidden.has(a.value),
    }));

  return NextResponse.json({
    driver_id: driverId,
    uid: linkedUserId,
    linked: !!(linkedUserId && account),
    aliases,
    // Names a merge folded into this profile. A duplicate created by an iRacing
    // results import carries the real name, and "Also known as" sits in the
    // header — so any former name that is the iRacing one is dropped here
    // rather than published beside the generic one.
    former_names: (Array.isArray(driver?.merged_names) ? driver.merged_names : [])
      .filter(n => staff || !isIracingIdentity(driver, n, iracingIds)),
    // The per-game display names, so the career breakdown the client computes
    // can label each game with the name this driver races under THERE ("racing
    // as Ryanbirdman") rather than repeating the overall one.
    game_names: normalizeGameNames(driver?.game_names),
    // The games that make this profile's iRacing name showable, so the browser
    // can answer "is iRacing all they play?" the same way the server would.
    iracing_game_ids: [...iracingIds],
    // Whether this response was built for a staff viewer, so the page knows the
    // iRacing name it is holding may be shown outright rather than kept to
    // iRacing's own section.
    viewer_is_admin: staff,
    profile,
  });
}
