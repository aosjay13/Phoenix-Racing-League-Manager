// The shape of a raw scope bundle, and the reads that fill one.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Vercel Fluid bills Active CPU — time a serverless function spends actually
// executing. Scoring a league is not a small computation (points templates,
// drop weeks, per-class championships, session flags, bonuses, team roll-ups,
// an Elo replay), and running it on the read path meant every visitor who
// opened a table spent the league's CPU allowance on maths their own browser
// was idle enough to do.
//
// So the server no longer does it. A raw bundle is exactly what its name says:
// the uncalculated documents for a scope, mapped out of Firestore and handed
// over as JSON. Nothing here maps, reduces, sorts or scores anything — the one
// narrowing that happens is `account_names` (below), and that is a privacy
// requirement rather than a calculation. Everything that used to be computed
// here now runs in the browser, in a useMemo, over this bundle. See
// lib/standingsCompute.js, lib/statsCompute.js, lib/teamStatsCompute.js,
// lib/skillRatingsCompute.js and lib/scheduleCompute.js — those modules are the
// SAME code the routes used to run, moved rather than rewritten, which is what
// keeps a client-computed table identical to the one the server used to send.
//
// ── The one thing to be careful about ─────────────────────────────────────
//
// Raw means big. One season of a 28-driver, 20-round championship is roughly
// 2,200 result documents; a league's whole history is that times the number of
// seasons it has raced. Ask for the narrowest scope that answers the question —
// `season` for a championship table, `game`/`series` for their own tables, and
// `league` only for the all-time views that genuinely span everything.

import { db } from "@/lib/firebase";
import { scopeByLeague } from "@/lib/serverAuth";

export const RAW_SCOPES = Object.freeze(["league", "game", "series", "season", "race"]);

// Pools that only one screen wants, asked for by name (`?include=time_trials`).
// Time trials live in their own two collections and are read per session, so
// bundling them unconditionally would put dozens of queries on every
// championship table for the sake of the one page that shows hot laps.
export const RAW_INCLUDES = Object.freeze(["time_trials"]);

const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// Which seasons a scope covers. This is a Firestore query, not a filter over
// documents already in memory — the point is to never read what the scope
// doesn't cover.
async function seasonsInScope(scope, { leagueId, gameId, seriesId, seasonId }) {
  if (scope === "season") {
    const doc = await db().collection("seasons").doc(seasonId).get();
    return doc.exists ? [{ id: doc.id, ...doc.data() }] : [];
  }
  let q = db().collection("seasons");
  if (scope === "game") q = q.where("game_id", "==", gameId);
  else if (scope === "series") q = q.where("series_id", "==", seriesId);
  // A single season is addressed by id and is league-correct on its own; the
  // multi-season scopes are constrained so one league's history never bleeds
  // into another's tables.
  return docsOf(await scopeByLeague(q, leagueId).get());
}

// Everything hanging off a set of seasons: their calendar, their roster, their
// results, their classes. Read per season because that is how the documents are
// indexed (`season_id`), and because a league with more history than a single
// `in` clause can hold still has to work.
async function perSeasonDocs(seasonIds) {
  const out = { races: [], entries: [], results: [], classes: [] };
  const per = await Promise.all(seasonIds.map(async id => {
    const [races, entries, results, classes] = await Promise.all([
      db().collection("races").where("season_id", "==", id).get(),
      db().collection("entries").where("season_id", "==", id).get(),
      db().collection("results").where("season_id", "==", id).get(),
      db().collection("classes").where("season_id", "==", id).get(),
    ]);
    return { races, entries, results, classes };
  }));
  for (const p of per) {
    out.races.push(...docsOf(p.races));
    out.entries.push(...docsOf(p.entries));
    out.results.push(...docsOf(p.results));
    out.classes.push(...docsOf(p.classes));
  }
  return out;
}

// Display names for the accounts linked to the drivers in scope.
//
// The ONLY projection in this module, and it is deliberate: a `users` document
// carries an email address, a role map, recovery state and signup preferences,
// none of which has any business in a browser that only wants to know what to
// print in a table. Name resolution needs exactly one field (see
// lib/driverNames.js), so exactly one field travels.
async function accountNamesFor(drivers) {
  const uids = [...new Set(drivers.map(d => d.user_id).filter(Boolean))];
  if (!uids.length) return {};
  const docs = await Promise.all(uids.map(uid => db().collection("users").doc(uid).get()));
  const out = {};
  for (const u of docs) if (u.exists) out[u.id] = String(u.data().display_name ?? "").trim();
  return out;
}

// Fetch one scope's raw documents. No scoring, no sorting, no aggregation —
// the sorts below are the ones Firestore itself cannot express (`classes` is
// ordered the way the dropdowns show it, which the class rules depend on), and
// they are ordering, not arithmetic.
export async function fetchRawBundle(leagueId, { scope, gameId = "", seriesId = "", seasonId = "", raceId = "", include = [] }) {
  if (!RAW_SCOPES.includes(scope)) return { status: 400, body: { error: "invalid scope" } };
  const wanted = new Set((Array.isArray(include) ? include : String(include).split(","))
    .map(s => s.trim()).filter(Boolean));
  for (const name of wanted) {
    if (!RAW_INCLUDES.includes(name)) return { status: 400, body: { error: `unknown include: ${name}` } };
  }
  if (scope === "game" && !gameId) return { status: 400, body: { error: "game_id required" } };
  if (scope === "series" && !seriesId) return { status: 400, body: { error: "series_id required" } };
  if (scope === "season" && !seasonId) return { status: 400, body: { error: "season_id required" } };
  if (scope === "race" && !raceId) return { status: 400, body: { error: "race_id required" } };

  // A race scope is a season scope reached through one of its events: the event
  // page is addressed by race id, and its results grid, its points and its
  // roster all belong to the season around it. Resolving it here is one extra
  // document read and saves the screen a round trip to learn which season it is
  // looking at.
  let resolvedSeasonId = seasonId;
  if (scope === "race") {
    const raceDoc = await db().collection("races").doc(raceId).get();
    if (!raceDoc.exists) return { status: 404, body: { error: "Event not found" } };
    resolvedSeasonId = raceDoc.data().season_id || "";
    if (!resolvedSeasonId) return { status: 404, body: { error: "Event not found" } };
  }

  const seasons = await seasonsInScope(scope === "race" ? "season" : scope,
    { leagueId, gameId, seriesId, seasonId: resolvedSeasonId });
  if ((scope === "season" || scope === "race") && !seasons.length) {
    return { status: 404, body: { error: scope === "race" ? "Event not found" : "Season not found" } };
  }

  const [perSeason, teamsSnap, mappingsSnap, driversSnap, templatesSnap, gamesSnap, tracksSnap, seriesDocs] = await Promise.all([
    perSeasonDocs(seasons.map(s => s.id)),
    scopeByLeague(db().collection("teams"), leagueId).get(),
    scopeByLeague(db().collection("team_seasons"), leagueId).get(),
    scopeByLeague(db().collection("drivers"), leagueId).get(),
    db().collection("points_templates").get(),
    db().collection("games").get(),
    // The global venue pool. Races reference a track by id, and a driver's
    // per-venue record (and a track's own page) resolves today's name and logo
    // through it rather than the name frozen into an old race row.
    scopeByLeague(db().collection("tracks"), leagueId).get(),
    // Every series the seasons in scope belong to — the top of the points chain
    // (series → season → class → session), so a season that overrides nothing
    // still scores on its series' structure.
    (async () => {
      const ids = [...new Set(seasons.map(s => s.series_id).filter(Boolean))];
      const docs = await Promise.all(ids.map(id => db().collection("series").doc(id).get()));
      return docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
    })(),
  ]);

  // Opt-in pools, read only when asked for.
  const trials = wanted.has("time_trials")
    ? docsOf(await scopeByLeague(db().collection("time_trials"), leagueId).get())
    : [];
  const trialEntries = trials.length
    ? (await Promise.all(trials.map(t =>
        db().collection("time_trial_entries").where("time_trial_id", "==", t.id).get())))
      .flatMap(docsOf)
    : [];

  const drivers = docsOf(driversSnap);
  const classes = perSeason.classes.sort((a, b) =>
    (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
    String(a.name || "").localeCompare(String(b.name || "")));

  return { status: 200, body: {
    scope,
    league_id: leagueId || null,
    game_id: gameId || null,
    series_id: seriesId || null,
    season_id: resolvedSeasonId || null,
    race_id: raceId || null,
    seasons,
    series: seriesDocs,
    games: docsOf(gamesSnap),
    tracks: docsOf(tracksSnap),
    classes,
    races: perSeason.races,
    entries: perSeason.entries,
    results: perSeason.results,
    teams: docsOf(teamsSnap),
    team_seasons: docsOf(mappingsSnap),
    drivers,
    account_names: await accountNamesFor(drivers),
    // Hot laps set in a Time Trial. Present only when asked for — see
    // RAW_INCLUDES — and empty otherwise, which is what every screen but the
    // venue page sees.
    time_trials: trials,
    time_trial_entries: trialEntries,
    // Stored templates only. The builtin points systems are pure code
    // (lib/pointsTemplates.js) and the browser already has them, so sending
    // them would be shipping constants over the wire.
    points_templates: docsOf(templatesSnap),
  } };
}
