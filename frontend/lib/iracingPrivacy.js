// Keeping an iRacing real name inside iRacing.
//
// iRacing makes every member race under their legal name — "First Last", no
// gamertags. Nowhere else does. So a driver who runs an iRacing series on
// Tuesday and a BeamNG series on Thursday has, through no choice of their own,
// their real name sitting in this league's database next to the handle they
// actually want to be known by.
//
// Left alone, that name leaks: entries carry a denormalized copy of whatever
// the driver's overall name is (see lib/driverSync.js), so the moment their
// profile name IS the iRacing one, it turns up on a BeamNG roster, an AMS2
// standings table, a placement sheet and the global directory. None of those
// have any business showing it. It is a personal-safety problem, not a
// cosmetic one.
//
// The rule this module implements is simple to state:
//
//   A name that identifies a driver ON IRACING may be rendered only in an
//   iRacing context. Everywhere else the app shows their generic display name
//   or gamertag, and shows nothing of the iRacing one.
//
// It is a PRESENTATION rule and nothing more. No document is rewritten, no
// alias is deleted, nothing is unlinked: one human is still one driver
// profile, with one set of stats aggregated across every game they race. This
// module only ever answers "which of the names we already hold may be printed
// here?".
//
// Pure, so the browser's compute modules (lib/rawIndex.js), the server's
// resolvers (lib/driverNamesServer.js) and the API routes all reach the same
// verdict, and so it can be tested without a database — see
// lib/__tests__/iracingPrivacy.test.mjs.

import { normalizeAliases } from "@/lib/aliases";
import { gameNameFor, normalizeGameNames, overallNameFor } from "@/lib/driverNames";
import { compactName } from "@/lib/nameKey";
import { IRACING_NAME_LABEL, isIracingGame } from "@/lib/signupRequest";

// What a driver is called when every name we hold for them is an iRacing one.
// Rare — it takes a profile that has never been given a display name, a
// gamertag or an account — but the answer to "we have nothing safe to show"
// has to be a name, not the real one, and not a blank cell.
export const PRIVATE_NAME = "Driver";

// ── Which games are iRacing ────────────────────────────────────────────────
//
// A league names its own games, so this is decided the same way every other
// iRacing rule in the app is: by the game's NAME, punctuation and case
// ignored, so "iRacing", "i-Racing" and "IRACING" are one game (see
// isIracingGame in lib/signupRequest.js). Accepts a list of game documents or
// the { id: name } map the server-side helpers pass around.
export function iracingGameIds(games) {
  const out = new Set();
  if (!games) return out;
  const rows = Array.isArray(games)
    ? games.map(g => [g?.id, g?.name])
    : Object.entries(games);
  for (const [id, name] of rows) if (id && isIracingGame(name)) out.add(String(id));
  return out;
}

// Is this the id of an iRacing game? A null/blank game id is a league-wide
// context — every game at once — which is emphatically NOT an iRacing one.
export function isIracingGameId(gameId, iracingIds) {
  return !!gameId && !!iracingIds && iracingIds.has(String(gameId));
}

// Is this alias label an iRacing one? Covers the two the sign-up form collects
// ("iRacing Name", "iRacing ID#") and anything else an admin adds with iRacing
// in the label, since a field an admin called "iRacing Team Name" holds an
// iRacing identity whether or not this app shipped the label.
function isIracingLabel(label) {
  return isIracingGame(label);
}

// ── What counts as an iRacing identity ─────────────────────────────────────

// Every string this league holds that identifies the driver on iRacing: the
// aliases labelled for iRacing, any alias mapped to an iRacing game, and the
// per-game display name they've been given for one. These are the values that
// may not appear outside an iRacing context.
//
// The customer ID rides along with the name. It is not a name and will never
// be mistaken for one, but it points at the same person on the same service,
// so it is governed by the same rule rather than a second one.
export function iracingIdentityValues(driver, iracingIds = new Set()) {
  const out = [];
  const push = value => {
    const v = String(value ?? "").trim();
    if (v) out.push(v);
  };
  for (const a of normalizeAliases(driver?.aliases)) {
    if (isIracingLabel(a.label) || isIracingGameId(a.game_id, iracingIds)) push(a.value);
  }
  for (const g of normalizeGameNames(driver?.game_names)) {
    if (isIracingGameId(g.game_id, iracingIds)) push(g.name);
  }
  return [...new Set(out)];
}

// The same set as comparison keys, which is how a candidate name is tested:
// "Ryan Maynard" must be recognised as the iRacing name when the profile spells
// it "ryan  maynard".
function hiddenKeys(driver, iracingIds) {
  return new Set(iracingIdentityValues(driver, iracingIds).map(compactName).filter(Boolean));
}

// Would showing this name expose the driver's iRacing identity? The question
// every fallback path in the app has to ask before printing a stored string —
// a roster entry's denormalized name, a queue row's name, a search hit.
export function isIracingIdentity(driver, value, iracingIds = new Set()) {
  const key = compactName(value);
  return !!key && hiddenKeys(driver, iracingIds).has(key);
}

// The driver's iRacing name itself — what an iRacing table, and only an
// iRacing table, shows. Resolved the same way any other per-game name is (see
// gameNameFor), falling back to the "iRacing Name" alias for a driver whose
// sign-up filled that in without anybody mapping it to the game.
export function iracingNameFor(driver, iracingIds = new Set()) {
  for (const id of iracingIds) {
    const name = gameNameFor(driver, id);
    if (name) return name;
  }
  const key = compactName(IRACING_NAME_LABEL);
  const hit = normalizeAliases(driver?.aliases).find(a => a.value && compactName(a.label) === key);
  return hit ? hit.value : null;
}

// Does this driver race in iRacing and nowhere else? Their iRacing name is
// then the only name they have, and hiding it would leave the app calling them
// nothing at all — so it is shown, including on their global profile. Takes
// the games they have actually raced in, which is a question about results,
// not about the profile (see driverGameIds in lib/rawIndex.js).
export function racesOnlyIracing(gameIds, iracingIds = new Set()) {
  const ids = [...new Set((gameIds || []).filter(Boolean).map(String))];
  return ids.length > 0 && ids.every(id => iracingIds.has(id));
}

// ── The name to show ───────────────────────────────────────────────────────

// The best name this driver may be shown under when the context is NOT
// iRacing, or null when we hold nothing that isn't an iRacing name.
//
// In order: the name they race under in THIS game (their gamertag there), the
// overall display name an admin set for them, their linked account's name,
// their driver-pool name, and finally any other gamertag on the profile. Every
// step is filtered against the iRacing set, so a driver whose pool name is the
// real name skips it and shows the handle instead.
export function publicNameFor(driver, { accountName = null, gameId = null, iracingIds = new Set() } = {}) {
  if (!driver) return null;
  const hidden = hiddenKeys(driver, iracingIds);
  const allowed = value => {
    const v = String(value ?? "").trim();
    return v && !hidden.has(compactName(v)) ? v : null;
  };

  // The name set for the game being viewed. Skipped for an iRacing game: this
  // function answers the non-iRacing question, and callers ask the iRacing one
  // through gameNameFor directly.
  if (gameId && !isIracingGameId(gameId, iracingIds)) {
    const inGame = allowed(gameNameFor(driver, gameId));
    if (inGame) return inGame;
  }
  for (const candidate of [driver.display_name, accountName, driver.name]) {
    const hit = allowed(candidate);
    if (hit) return hit;
  }
  // Last resort: some other handle they race under. Not the name for this
  // game, but theirs, public, and chosen by them — which their real name isn't.
  for (const g of normalizeGameNames(driver.game_names)) {
    if (isIracingGameId(g.game_id, iracingIds)) continue;
    const hit = allowed(g.name);
    if (hit) return hit;
  }
  for (const a of normalizeAliases(driver.aliases)) {
    if (isIracingLabel(a.label) || isIracingGameId(a.game_id, iracingIds)) continue;
    const hit = allowed(a.value);
    if (hit) return hit;
  }
  return null;
}

// THE resolver. What one driver is called in one context, in the three shapes
// every table in the app renders:
//
//   overall  their profile name — the muted "who that is" line under an
//            on-track name, and the name a league-wide table shows
//   game     the name they race under in this game, or null when they've set
//            none, so a caller can tell "has a separate on-track name" from
//            "doesn't"
//   display  what to actually print
//
// In an iRacing context (a season, series or event belonging to an iRacing
// game — or a driver who races nowhere else) that's the iRacing name, falling
// back to their display name when iRacing hasn't given us one. Anywhere else
// it is the generic name, with the iRacing one absent from all three fields.
export function contextNames(driver, {
  gameId = null, iracingIds = new Set(), accountName = null, iracingOnly = false,
} = {}) {
  if (!driver) return { overall: null, game: null, display: null };

  if (isIracingGameId(gameId, iracingIds) || iracingOnly) {
    // Their iRacing name, however it was recorded: a per-game name set for the
    // game, an alias mapped to it, or the "iRacing Name" a sign-up filled in
    // that nobody ever mapped. Falling back to their display name when iRacing
    // gave us none.
    const game = gameNameFor(driver, gameId) || iracingNameFor(driver, iracingIds);
    const overall = overallNameFor(driver, accountName);
    return { overall: overall || game || PRIVATE_NAME, game, display: game || overall || PRIVATE_NAME };
  }

  // A per-game name mapped to a NON-iRacing game is theirs to show — unless
  // the value is the iRacing name itself, which no mapping makes safe.
  const raw = gameId ? gameNameFor(driver, gameId) : null;
  const game = raw && !isIracingIdentity(driver, raw, iracingIds) ? raw : null;
  const overall = publicNameFor(driver, { accountName, iracingIds });
  return {
    overall: overall || PRIVATE_NAME,
    game,
    display: game || overall || PRIVATE_NAME,
  };
}

// ── Handing a driver document to somebody who may not see the iRacing name ──

// The same driver, with every iRacing identity taken out of it: the aliases,
// the per-game name mapped to iRacing, any former name folded in by a merge,
// and the profile/display name itself when that IS the iRacing name.
//
// For the responses a player or a visitor reads (the public driver directory),
// as opposed to the ones staff work from. It changes nothing in the database —
// the document this is built from is untouched, and every stat, entry and
// reference still hangs off the one driver id.
export function publicDriverDoc(driver, { iracingIds = new Set(), accountName = null } = {}) {
  if (!driver) return driver;
  const hidden = hiddenKeys(driver, iracingIds);
  if (!hidden.size) return driver;
  const shows = value => {
    const v = String(value ?? "").trim();
    return !!v && !hidden.has(compactName(v));
  };
  return {
    ...driver,
    name: shows(driver.name) ? driver.name : (publicNameFor(driver, { accountName, iracingIds }) || PRIVATE_NAME),
    display_name: shows(driver.display_name) ? driver.display_name : "",
    aliases: normalizeAliases(driver.aliases)
      .filter(a => !isIracingLabel(a.label) && !isIracingGameId(a.game_id, iracingIds)),
    game_names: normalizeGameNames(driver.game_names)
      .filter(g => !isIracingGameId(g.game_id, iracingIds)),
    merged_names: (Array.isArray(driver.merged_names) ? driver.merged_names : []).filter(shows),
  };
}
