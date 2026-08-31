// Turning a raw bundle into the lookups the scoring code asks for.
//
// Every function the API routes used to await — fetchSeasonClasses,
// fetchTemplatesById, fetchSeriesForSeason, loadTeamIndex, fetchDriverNames —
// was a Firestore read wrapped around a pure rule. The rules already live in
// dependency-free modules (lib/classFilter.js, lib/pointsTemplates.js,
// lib/teams.js, lib/driverNames.js); this module supplies the other half from
// documents already in hand, so the same rules run in a browser with no
// firebase-admin anywhere near it.
//
// Nothing here reaches the network. Given a bundle from /api/raw it is all
// synchronous, which is what lets the compute modules run inside a useMemo.

import { buildTeamIndex } from "@/lib/teams";
import { normalizedBuiltinTemplates, NONE_TEMPLATE } from "@/lib/pointsTemplates";
import {
  contextNames, iracingGameIds, isIracingGameId, isIracingIdentity, racesOnlyIracing,
} from "@/lib/iracingPrivacy";

// A raw bundle with nothing in it — what a screen holds before its fetch lands,
// so the compute below can run against it rather than every caller guarding.
export const EMPTY_BUNDLE = Object.freeze({
  scope: "league", league_id: null, game_id: null, series_id: null, season_id: null,
  seasons: [], series: [], games: [], tracks: [], classes: [], races: [], entries: [], results: [],
  teams: [], team_seasons: [], drivers: [], account_names: {}, points_templates: [],
  time_trials: [], time_trial_entries: [],
});

function groupBy(rows, key) {
  const out = {};
  for (const row of rows) (out[row[key]] ||= []).push(row);
  return out;
}

// A result document as the scoring code expects it. Firestore ids are the one
// thing the raw endpoint adds that the old routes didn't carry into scoring
// (they read `d.data()`), and a stray `id` on a result would ride the spread in
// aggregate rows. Dropped here, once, rather than guarded at every use.
export function bareResults(results = []) {
  return results.map(({ id, ...rest }) => rest);
}

// Every points system a session can name, keyed by id: the builtins (pure code,
// already in the bundle the browser downloaded), the "none" pseudo-template,
// and the league's own saved templates on top. The client-side twin of
// fetchTemplatesById.
export function templatesById(bundle) {
  return {
    ...Object.fromEntries(normalizedBuiltinTemplates().map(t => [t.id, t])),
    [NONE_TEMPLATE.id]: NONE_TEMPLATE,
    ...Object.fromEntries((bundle.points_templates || []).map(({ id, ...data }) => [id, data])),
  };
}

// Which games each driver has actually RACED in, from the bundle's own entries.
//
// Asked for one reason: a driver who races in iRacing and nowhere else has no
// second identity to protect, so their real name is simply their name and the
// privacy rules step aside for them (see racesOnlyIracing in
// lib/iracingPrivacy.js). It is a question about results rather than about the
// profile, which is why it is answered here and not in the pure module.
//
// Cached per bundle: every table on a screen resolves names, and the bundle
// object is held across renders (see useRawBundle), so this walks the entries
// once per fetch rather than once per table.
const gamesRacedCache = new WeakMap();

export function driverGameIds(bundle) {
  if (!bundle || typeof bundle !== "object") return {};
  const cached = gamesRacedCache.get(bundle);
  if (cached) return cached;
  const gameOfSeason = Object.fromEntries((bundle.seasons || []).map(s => [s.id, s.game_id || ""]));
  const out = {};
  for (const e of bundle.entries || []) {
    const gameId = gameOfSeason[e.season_id];
    if (!e.driver_id || !gameId) continue;
    (out[e.driver_id] ||= new Set()).add(gameId);
  }
  gamesRacedCache.set(bundle, out);
  return out;
}

// Name resolution over the drivers in the bundle — the twin of
// fetchNameResolver, reading `account_names` where the server read the `users`
// collection.
//
// Every answer is context-aware: an iRacing real name is resolved only for an
// iRacing game (or for a driver who races in nothing else), and every other
// context gets the generic display name or gamertag with the iRacing one
// nowhere in it. The rules live in lib/iracingPrivacy.js; this supplies them
// with the league's games and the games each driver has raced in.
// Held per bundle, like the games-raced map above: the roster, the standings
// and the results grid each ask this per ROW, and rebuilding the driver index
// on every question turns a 500-driver league into a quarter of a million
// lookups per render.
const resolverCache = new WeakMap();

export function nameResolver(bundle) {
  const cached = resolverCache.get(bundle);
  if (cached) return cached;
  const byId = Object.fromEntries((bundle.drivers || []).map(d => [d.id, d]));
  const accountName = bundle.account_names || {};
  const iracingIds = iracingGameIds(bundle.games || []);
  const racedIn = driverGameIds(bundle);

  const namesFor = (id, gameId) => {
    const d = byId[id];
    if (!d) return { overall: null, game: null, display: null };
    return contextNames(d, {
      gameId,
      iracingIds,
      accountName: d.user_id ? accountName[d.user_id] : null,
      iracingOnly: racesOnlyIracing([...(racedIn[id] || [])], iracingIds),
    });
  };

  const resolver = {
    ids: Object.keys(byId),
    namesFor,
    overall: id => namesFor(id, null).overall,
    forGame: (id, gameId) => namesFor(id, gameId).game,
    display: (id, gameId) => namesFor(id, gameId).display,
    // Would printing this stored string expose the driver's iRacing name in
    // this context? What the roster asks before falling back to the name
    // denormalized onto an entry.
    hides: (id, value, gameId) =>
      !!byId[id]
      && !isIracingGameId(gameId, iracingIds)
      && !racesOnlyIracing([...(racedIn[id] || [])], iracingIds)
      && isIracingIdentity(byId[id], value, iracingIds),
  };
  // A bundle is an immutable snapshot from /api/raw, so its answers are too.
  if (bundle && typeof bundle === "object") resolverCache.set(bundle, resolver);
  return resolver;
}

// { [driverId]: { overall, game, display } } for a set of drivers — the twin of
// fetchDriverNames. Restricted to the ids asked for, exactly as the server was:
// it only ever resolved the drivers a table was about to render.
//
// `display` and `overall` are never blank for a driver the bundle knows, so a
// caller's `names[id]?.display || row.name` fallback can never reach past this
// to a stored name that is not safe to show here.
export function driverNames(bundle, driverIds, gameId = null) {
  const r = nameResolver(bundle);
  const wanted = new Set((driverIds || []).filter(Boolean));
  const out = {};
  for (const id of r.ids) {
    if (!wanted.has(id)) continue;
    out[id] = r.namesFor(id, gameId);
  }
  return out;
}

// Is this stored name one the driver's profile marks as an iRacing one, in a
// context that may not show it? For the places that fall back to a name written
// onto a document (a roster entry's per-series alias) rather than resolved.
export function hiddenName(bundle, driverId, value, gameId = null) {
  return nameResolver(bundle).hides(driverId, value, gameId);
}

// The whole index a set of screens needs, derived once. Callers hold this
// across renders (see useRawBundle) so a re-render re-uses the team index and
// the per-season grouping instead of rebuilding them.
export function indexBundle(bundle = EMPTY_BUNDLE) {
  const seasons = bundle.seasons || [];
  const classesBySeason = groupBy(bundle.classes || [], "season_id");
  const racesBySeason = groupBy(bundle.races || [], "season_id");
  const entriesBySeason = groupBy(bundle.entries || [], "season_id");
  const resultsBySeason = groupBy(bundle.results || [], "season_id");
  const seriesById = Object.fromEntries((bundle.series || []).map(s => [s.id, s]));

  return {
    bundle,
    seasons,
    seriesById,
    gameNameById: Object.fromEntries((bundle.games || []).map(g => [g.id, g.name || "Game"])),
    gameById: Object.fromEntries((bundle.games || []).map(g => [g.id, g])),
    trackById: Object.fromEntries((bundle.tracks || []).map(t => [t.id, t])),
    seasonById: Object.fromEntries(seasons.map(s => [s.id, s])),
    // The team picture for the league, built once — the twin of loadTeamIndex.
    teamIndex: buildTeamIndex({
      teams: bundle.teams || [],
      teamSeasons: bundle.team_seasons || [],
      drivers: bundle.drivers || [],
    }),
    templatesById: templatesById(bundle),
    // Per season, in the shape the season loops want. `classes` arrive from the
    // endpoint already in dropdown order, so a season's slice keeps it.
    classesFor: id => classesBySeason[id] || [],
    racesFor: id => racesBySeason[id] || [],
    entriesFor: id => entriesBySeason[id] || [],
    resultsFor: id => resultsBySeason[id] || [],
    seriesFor: season => (season?.series_id ? seriesById[season.series_id] ?? null : null),
  };
}

// The game a scope belongs to, or null for a league-wide (all games) scope —
// the twin of gameIdForScope, answered from the bundle rather than by reading
// the series or season back.
export function gameIdForBundle(bundle, { scope, gameId = null, seriesId = null, seasonId = null } = {}) {
  if (scope === "game") return gameId || bundle.game_id || null;
  if (scope === "series") {
    const id = seriesId || bundle.series_id;
    return (bundle.series || []).find(s => s.id === id)?.game_id || null;
  }
  if (scope === "season") {
    const id = seasonId || bundle.season_id;
    return (bundle.seasons || []).find(s => s.id === id)?.game_id || null;
  }
  return null;
}
