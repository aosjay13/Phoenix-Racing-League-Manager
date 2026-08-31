// Scope-aware roster directory, computed in the browser.
//
// This is the code that used to run inside GET /api/roster, moved rather than
// rewritten. It is a smaller read than the stats tables, but it is the same
// shape of work — walk every season in scope, fold each driver's entries into
// one identity, resolve their name and team — and it ran on a serverless
// function every time somebody opened the roster or switched a dropdown.
//
//   scope=season  → drivers in one season (car numbers shown)
//   scope=series  → drivers across a series; number = latest season's entry number
//   scope=game    → drivers across every series in a game; number omitted (multiple)
//   scope=league  → every driver, everywhere; number omitted
//
// Identity: every entry should carry a `driver_id` pointing at the global
// `drivers` collection — that's the real identity, since the same person can run
// a different display name (alias) per series/game. Entries are unified by
// driver_id when present, falling back to linked account (user_id) or lowercased
// name for older entries written before this existed. Each driver also carries
// `series_entries`, a map of seriesId → the driver's latest entry in that series
// (including that series' own alias name and number), which powers the
// per-series alias/number editor.

import { entryClassIds, orderClassIds } from "@/lib/classFilter";
import { applySeasonTeams } from "@/lib/teams";
import { driverNames, hiddenName, indexBundle } from "@/lib/rawIndex";

// Refusals kept identical to the ones the route used to send, so a screen
// reports a bad scope the same way. `index` is an indexBundle() of a bundle
// fetched at the matching scope.
export function buildRoster(index, { scope = "league", gameId = "", seriesId = "", seasonId = "" } = {}) {
  if (scope === "season" && !seasonId) return { status: 400, body: { error: "season_id required" } };
  if (scope === "game" && !gameId) return { status: 400, body: { error: "game_id required" } };
  if (scope === "series" && !seriesId) return { status: 400, body: { error: "series_id required" } };
  if (!["league", "game", "series", "season"].includes(scope)) {
    return { status: 400, body: { error: "invalid scope" } };
  }
  if (scope === "season" && !index.seasonById[seasonId]) {
    return { status: 404, body: { error: "Season not found" } };
  }

  // Oldest → newest, so the most recent entry overwrites earlier identity data.
  const seasons = [...index.seasons]
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const showNumber = scope === "season" || scope === "series";
  const teamIndex = index.teamIndex;
  const drivers = {};        // key -> driver bucket
  let editSeasonId = null;   // latest season in scope; the write target for edits

  for (const season of seasons) {
    editSeasonId = season.id;
    const seriesKey = season.series_id || "unknown";
    // The season's classes in their display order (sort_order, then name), so a
    // driver's classes list the same way on every row — see orderClassIds. The
    // bundle already hands them over in that order.
    const seasonClasses = index.classesFor(season.id);
    const className = Object.fromEntries(seasonClasses.map(c => [c.id, c.name]));

    // The team each driver races for THIS season comes from the season's team
    // lineup (see lib/teams.js), falling back to the tag on their entry — the
    // same answer the standings and stats screens resolve.
    const seasonEntries = applySeasonTeams(index.entriesFor(season.id), season.id, teamIndex);

    for (const entry of seasonEntries) {
      const key = entry.driver_id
        ? `d:${entry.driver_id}`
        : entry.user_id
          ? `u:${entry.user_id}`
          : `n:${String(entry.name || "").trim().toLowerCase()}`;
      const bucket = (drivers[key] ??= {
        key,
        name: entry.name,
        driver_id: null,
        user_id: null,
        number: null,
        team_id: null,
        team_name: null,
        class_id: null,
        class_name: null,
        class_ids: [],
        class_names: [],
        entry_id: null,
        entry_ids: [],
        season_id: null,
        series_entries: {},
      });
      // Latest entry seen wins for the driver's display identity (overridden
      // below by the global driver's canonical name in aggregated scopes).
      bucket.name = entry.name;
      bucket.driver_id = entry.driver_id ?? bucket.driver_id;
      bucket.user_id = entry.user_id ?? bucket.user_id;
      bucket.team_id = entry.team_id ?? bucket.team_id;
      bucket.team_name = entry.team_id
        ? teamIndex.teamById(entry.team_id)?.name ?? entry.team ?? bucket.team_name
        : bucket.team_name;
      // Classes are per-season, so the latest season in scope wins — matching
      // how team/number resolve. A driver can race SEVERAL classes, so the row
      // carries all of them; and because the same driver can still hold more
      // than one entry in a season (the old one-entry-per-class workaround),
      // the classes of every such entry are folded in rather than the last one
      // seen silently winning.
      if (bucket.season_id !== season.id) {
        bucket.class_ids = [];
        bucket.entry_ids = [];
      }
      for (const cid of entryClassIds(entry)) {
        if (!bucket.class_ids.includes(cid)) bucket.class_ids.push(cid);
      }
      bucket.class_ids = orderClassIds(bucket.class_ids, seasonClasses);
      bucket.class_names = bucket.class_ids.map(cid => className[cid]).filter(Boolean);
      bucket.class_id = bucket.class_ids[0] || null;
      bucket.class_name = bucket.class_id ? className[bucket.class_id] ?? null : null;
      bucket.entry_id = entry.id;
      if (!bucket.entry_ids.includes(entry.id)) bucket.entry_ids.push(entry.id);
      bucket.season_id = season.id;
      if (entry.number != null) bucket.number = entry.number;
      // Per-series: keep the driver's latest entry for that series, including
      // the alias name they race under there.
      bucket.series_entries[seriesKey] = {
        entry_id: entry.id,
        season_id: season.id,
        driver_id: entry.driver_id ?? null,
        name: entry.name,
        number: entry.number ?? null,
      };
    }
  }

  // Display names, resolved from each driver's profile (see lib/driverNames.js).
  // Every scope here sits under at most one game — season/series through their
  // season docs, `scope=game` through the query — so inside a game the roster
  // shows the name that driver is shown under in THAT game, and league-wide it
  // shows their overall display name.
  //
  // `name` stays the raw editable name (canonical driver name in aggregated
  // scopes, the per-series entry alias in season/series scope) because the
  // roster editor writes it straight back; `display_name` is the one to render.
  // League scope spans every game, so it has no per-game name to apply.
  const scopeGameId =
    scope === "game" ? gameId
      : scope === "league" ? null
        : (seasons.find(s => s.game_id)?.game_id || null);
  const names = driverNames(index.bundle, Object.values(drivers).map(d => d.driver_id), scopeGameId);

  if (!showNumber) {
    // Aggregated scopes: a driver can span series with different entry names,
    // so fall back to their profile name rather than whichever was seen last.
    for (const bucket of Object.values(drivers)) {
      const overall = bucket.driver_id ? names[bucket.driver_id]?.overall : null;
      if (overall) bucket.name = overall;
    }
  }
  for (const bucket of Object.values(drivers)) {
    const n = bucket.driver_id ? names[bucket.driver_id] : null;
    // A per-game name takes over; without one the row keeps the name it already
    // had — the per-series entry alias in a season/series roster, the profile
    // name in an aggregated one.
    //
    // Except when that stored name is the driver's iRacing real name and this
    // roster isn't iRacing's. Entries carry a copy of whatever the driver's
    // overall name was when they were written (see lib/driverSync.js), so on a
    // BeamNG roster that copy is exactly the leak this app must not have: the
    // resolved name — their gamertag, or the generic display name — stands in.
    const stored = bucket.driver_id && hiddenName(index.bundle, bucket.driver_id, bucket.name, scopeGameId)
      ? (n?.display || null)
      : bucket.name;
    bucket.display_name = n?.game || stored;
    bucket.profile_name = n?.overall || stored;
    bucket.game_alias = n?.game ?? null;
  }

  const rows = Object.values(drivers).map(d => ({
    key: d.key,
    name: d.name,
    // What to show: the game's name for this driver when the scope is inside a
    // game, else their overall display name. `profile_name` is always the
    // overall one, so a game roster can note who the on-track name belongs to.
    display_name: d.display_name,
    profile_name: d.profile_name,
    game_alias: d.game_alias,
    driver_id: d.driver_id,
    user_id: d.user_id,
    // Only expose a concrete number when the scope pins it to one series.
    number: showNumber ? d.number : null,
    team_id: d.team_id,
    team_name: d.team_name,
    // Every class this driver races in the latest season in scope, plus the
    // primary one on its own for callers that can only show a single class.
    class_id: d.class_id,
    class_name: d.class_name,
    class_ids: d.class_ids,
    class_names: d.class_names,
    entry_id: d.entry_id,
    // Every entry this driver holds in that season. More than one means they
    // were added once per class before a single entry could carry several —
    // the roster offers to combine them (see /api/admin/entries/combine).
    entry_ids: d.entry_ids,
    season_id: d.season_id,
    series_entries: d.series_entries,
  }));

  return { status: 200, body: {
    show_number: showNumber,
    edit_season_id: editSeasonId,
    seasons_counted: seasons.length,
    rows,
  } };
}

export function rosterFromBundle(bundle, params) {
  return buildRoster(indexBundle(bundle), params);
}
