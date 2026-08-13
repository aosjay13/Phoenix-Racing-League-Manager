import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { entryClassIds, orderClassIds } from "@/lib/classServer";
import { applySeasonTeams } from "@/lib/teams";
import { loadTeamIndex } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Scope-aware roster directory, mirroring /api/stats.
//   scope=season  → drivers in one season (car numbers shown)
//   scope=series  → drivers across a series; number = latest season's entry number
//   scope=game    → drivers across every series in a game; number omitted (multiple)
//   scope=league  → every driver, everywhere; number omitted
//
// Identity: every entry should carry a `driver_id` pointing at the global
// `drivers` collection (see /api/drivers) — that's the real identity, since
// the same person can run a different display name (alias) per series/game.
// Entries are unified by driver_id when present, falling back to linked
// account (user_id) or lowercased name for older entries written before this
// existed. Each driver also carries `series_entries`, a map of seriesId → the
// driver's latest entry in that series (including that series' own alias
// name and number), which powers the per-series alias/number editor.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  let seasons;
  if (scope === "season") {
    const id = searchParams.get("season_id");
    if (!id) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    seasons = [{ id: doc.id, ...doc.data() }];
  } else {
    let q = db().collection("seasons");
    if (scope === "game") {
      const gameId = searchParams.get("game_id");
      if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
      q = q.where("game_id", "==", gameId);
    } else if (scope === "series") {
      const seriesId = searchParams.get("series_id");
      if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
      q = q.where("series_id", "==", seriesId);
    } else if (scope !== "league") {
      return NextResponse.json({ error: "invalid scope" }, { status: 400 });
    }
    // league scope reads every season, so it must be constrained; game/series
    // are already narrowed by a league-scoped id but we still stamp the filter
    // for defense in depth.
    q = scopeByLeague(q, getRequestLeagueId(request));
    const snap = await q.get();
    seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Oldest → newest, so the most recent entry overwrites earlier identity data.
  seasons.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const showNumber = scope === "season" || scope === "series";
  // Teams for the whole league, read once and asked per season below.
  const teamIndex = await loadTeamIndex({ leagueId: getRequestLeagueId(request) });
  const drivers = {};        // key -> driver bucket
  let editSeasonId = null;   // latest season in scope; the write target for edits

  for (const season of seasons) {
    editSeasonId = season.id;
    const seriesId = season.series_id || "unknown";
    const [entriesSnap, classesSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("classes").where("season_id", "==", season.id).get(),
    ]);
    const className = Object.fromEntries(classesSnap.docs.map(d => [d.id, d.data().name]));
    // The season's classes in their display order (sort_order, then name), so a
    // driver's classes list the same way on every row — see orderClassIds.
    const seasonClasses = classesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
        String(a.name || "").localeCompare(String(b.name || "")));

    // The team each driver races for THIS season comes from the season's team
    // lineup (see lib/teams.js), falling back to the tag on their entry — the
    // same answer the standings and stats screens resolve.
    const seasonEntries = applySeasonTeams(
      entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      season.id,
      teamIndex,
    );

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
        numbers: new Set(),
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
      if (entry.number != null) {
        bucket.number = entry.number;
        bucket.numbers.add(entry.number);
      }
      // Per-series: keep the driver's latest entry for that series, including
      // the alias name they race under there.
      bucket.series_entries[seriesId] = {
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
    scope === "game" ? searchParams.get("game_id")
      : scope === "league" ? null
        : (seasons.find(s => s.game_id)?.game_id || null);
  const names = await fetchDriverNames(Object.values(drivers).map(d => d.driver_id), scopeGameId);

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
    bucket.display_name = n?.game || bucket.name;
    bucket.profile_name = n?.overall || bucket.name;
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

  return NextResponse.json({
    show_number: showNumber,
    edit_season_id: editSeasonId,
    seasons_counted: seasons.length,
    rows,
  });
}
