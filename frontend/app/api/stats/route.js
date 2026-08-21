import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { cachedPayload } from "@/lib/statsCache";
import {
  aggregateCareerStats,
  compareStandings,
  decorateRaceBonuses,
  decorateSessionFlags,
  sessionScopeContext,
  isQualifying,
  makeScorer,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { classIdsInSeason, fetchSeasonClasses, filterEntriesByClass, filterRacesByClass, filterResultsByClass, orderEntryClasses } from "@/lib/classServer";
import { crownsInScope, seasonChampions, titlesByEntry } from "@/lib/champions";
import { finalSessionName } from "@/lib/raceSummaryServer";
import { isPastRaceDate, raceDateSortKey, toDateOnly, todayDateString } from "@/lib/raceDate";
import { fetchDriverNames, gameIdForScope } from "@/lib/driverNamesServer";
import { fetchSeriesByIds } from "@/lib/seriesServer";
import { applySeasonTeams } from "@/lib/teams";
import { loadTeamIndex } from "@/lib/teamsServer";

export const dynamic = "force-dynamic";

// Aggregated driver stats across seasons — the app version of the
// spreadsheet's "Overall Stats" sheets.
//   scope=league                → every season
//   scope=game&game_id=…        → all seasons in a game
//   scope=series&series_id=…    → all seasons in a series
//   scope=season&season_id=…    → one season
// Add &class_id=… to narrow to one season class (Pro, GT3, …); classes belong
// to a single season, so it only bites within that season's slice of the scope.
// Drivers are unified across seasons by linked account (user_id) when
// present, otherwise by roster name.
//
// Cached on (league, scope, class) and dropped whenever a write could move a
// number — see lib/statsCache.js. This is the single most expensive read in the
// app: at league scope it aggregates every result the league has ever recorded,
// and it backs three screens (Stats, Records and the driver tables), so the
// same answer used to be recomputed from scratch for each of them.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { status, body } = await statsFor(getRequestLeagueId(request), {
    scope: searchParams.get("scope") || "league",
    classId: searchParams.get("class_id") || "",
    // A class NAME is the cross-season identity: above one season, "GT3" is a
    // separate doc per season, so the name is resolved to each season's own ids.
    className: searchParams.get("class_name") || "",
    gameId: searchParams.get("game_id") || "",
    seriesId: searchParams.get("series_id") || "",
    seasonId: searchParams.get("season_id") || "",
  });
  return NextResponse.json(body, { status });
}

const statsFor = cachedPayload("stats", async (leagueId, params) => {
  const { scope, classId, className } = params;

  // The team picture for the whole league, read once — every season below asks
  // it who was driving for whom, so a team's stats are the combined results of
  // its lineup in each season, and its all-time line is those seasons added up.
  const teamIndex = await loadTeamIndex({ leagueId });

  let seasonsQuery = db().collection("seasons");
  if (scope === "game") {
    if (!params.gameId) return { status: 400, body: { error: "game_id required" } };
    seasonsQuery = seasonsQuery.where("game_id", "==", params.gameId);
  } else if (scope === "series") {
    if (!params.seriesId) return { status: 400, body: { error: "series_id required" } };
    seasonsQuery = seasonsQuery.where("series_id", "==", params.seriesId);
  } else if (scope === "season") {
    if (!params.seasonId) return { status: 400, body: { error: "season_id required" } };
    const doc = await db().collection("seasons").doc(params.seasonId).get();
    if (!doc.exists) return { status: 404, body: { error: "Season not found" } };
    const season = { id: doc.id, ...doc.data() };
    return { status: 200, body: await buildStats([season], classId, className, season.game_id || null, teamIndex) };
  } else if (scope !== "league") {
    return { status: 400, body: { error: "invalid scope" } };
  }

  // League-wide / game / series scopes read many seasons — constrain them to
  // the active league so stats never bleed across leagues. (scope=season is a
  // single doc, already league-correct via its id, and returns above.)
  seasonsQuery = scopeByLeague(seasonsQuery, leagueId);
  const snap = await seasonsQuery.get();
  const seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // A Game or Series scope is tied to one game, so its tables show each
  // driver's name for THAT game; league scope ("All Games") has no game and
  // shows overall names.
  const gameId = await gameIdForScope({
    scope,
    gameId: params.gameId || null,
    seriesId: params.seriesId || null,
  });
  return { status: 200, body: await buildStats(seasons, classId, className, gameId, teamIndex) };
});

async function buildStats(seasons, classId = "", className = "", gameId = null, teamIndex = null) {
  // driverKey -> { name, number, user_id, results[], titles }
  const drivers = {};
  // teamId -> aggregated team bucket. A team is a persistent document (see
  // lib/teams.js), so its all-time line is simply every season's contribution
  // added together under the same id — even as its driver lineup changes
  // completely from one season to the next. Legacy per-season team docs fold
  // onto the canonical doc for their name, so an un-migrated league aggregates
  // exactly as it did before.
  const teams = {};
  // Every race across the scope, used for the dashboard's schedule metrics
  // (total / completed / next upcoming) alongside the per-driver aggregates.
  const allRaces = [];
  // Field-size accumulator: one entry per race that actually has finalized
  // results, holding how many drivers took part. See fieldSizeFor below.
  const fieldSizes = [];
  const templatesById = await fetchTemplatesById();

  // Every series in scope, read once — each season scores on its series'
  // structure unless it overrides it.
  const seriesById = await fetchSeriesByIds(seasons.map(s => s.series_id));

  for (const season of seasons) {
    const config = resolveSeasonConfig(season, seriesById[season.series_id] || null);
    const [entriesSnap, resultsSnap, racesSnap, seasonClasses] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
      fetchSeasonClasses(season.id),
    ]);
    // Stamp each entry with the team that driver raced for in THIS season, so
    // a driver who changed teams between seasons contributes their results to
    // the right team in each of them.
    const allEntries = applySeasonTeams(
      entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      season.id,
      teamIndex,
    );
    // Ordered the same way the standings do it, so a result with no class of
    // its own resolves to the same class on both screens.
    const allEntriesById = orderEntryClasses(
      Object.fromEntries(allEntries.map(e => [e.id, e])),
      seasonClasses,
    );
    // A class filter narrows the field before anything is scored, so a class
    // view shows that class's own points, wins and averages — not a slice of
    // the overall table. `classSel` is this season's OWN docs for the selected
    // class; empty means the season doesn't run it, so it drops out of the
    // aggregation entirely rather than contributing its whole field.
    const classSel = classIdsInSeason(seasonClasses, { className, classId });
    const classFilterOn = !!(className || classId);
    if (classFilterOn && !classSel.length) continue;
    const entries = filterEntriesByClass(allEntries, classSel);
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const seasonRaces = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Under a class filter, only that class's calendar counts toward the race
    // totals and field size — its own events plus the shared ones. The
    // race→doc map stays unfiltered so results always resolve their race.
    const races = filterRacesByClass(seasonRaces, classSel);
    const racesById = Object.fromEntries(seasonRaces.map(r => [r.id, r]));
    for (const r of races) allRaces.push(r);
    const decorated = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById,
      sessionScopeContext({ seasons: [season], classes: seasonClasses, entriesById: allEntriesById })));
    const results = filterResultsByClass(decorated, classSel, allEntriesById);
    // Scores every result under the class its driver raced in, so a class with
    // its own points structure totals under that structure here too.
    const scorer = makeScorer(results, { config, classes: seasonClasses, entriesById: allEntriesById, templatesById });

    // Average field size: how many drivers actually took part in each event.
    for (const race of races) {
      const n = fieldSizeFor(race, results);
      if (n > 0) fieldSizes.push(n);
    }

    // Prefer the global driver identity (driver_id) so a driver who races
    // under a different alias/number in each series still aggregates as one
    // person; fall back to linked account or name for older entries written
    // before driver_id existed.
    const keyFor = entry =>
      entry.driver_id ? `d:${entry.driver_id}` : entry.user_id ? `u:${entry.user_id}` : `n:${String(entry.name || "").trim().toLowerCase()}`;

    // A team's cross-season identity is its document id — that's what makes it
    // persistent. An entry tagged with a team name but no resolvable doc (old
    // free-text data) still gets a bucket, keyed by that name.
    const teamKeyFor = entry => {
      const teamId = teamIndex.teamIdForEntry(entry, season.id);
      if (teamId) return `t:${teamId}`;
      const name = String(entry.team ?? "").trim();
      return name ? `n:${name.toLowerCase()}` : null;
    };

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const key = keyFor(entry);
      const bucket = (drivers[key] ??= {
        driver_name: entry.name,
        driver_number: entry.number ?? null,
        driver_id: entry.driver_id ?? null,
        user_id: entry.user_id ?? null,
        results: [],
        titles: 0,
      });
      // Prefer the most recent identity details we see.
      bucket.driver_name = entry.name;
      if (entry.number != null) bucket.driver_number = entry.number;
      if (entry.user_id) bucket.user_id = entry.user_id;
      if (entry.driver_id) bucket.driver_id = entry.driver_id;
      const scored = {
        ...r,
        // Qualifying scores itself now, so it is not excluded here — only a
        // session whose points toggle is off scores nothing.
        points: r.counts_points === false ? 0 : scorer.points(r),
      };
      bucket.results.push(scored);

      // Mirror the same scored result into its team bucket. A team's stats are
      // the combined results of every driver who raced for it in scope.
      const tk = teamKeyFor(entry);
      if (tk) {
        const t = teamIndex.teamForEntry(entry, season.id);
        const tb = (teams[tk] ??= { team_id: t?.id ?? null, team_name: t?.name ?? entry.team, logo_url: t?.logo_url ?? null, color: t?.color ?? null, results: [], driverKeys: new Set(), titles: 0, seasons: new Set() });
        if (t?.name) tb.team_name = t.name;
        if (t?.logo_url) tb.logo_url = t.logo_url;
        if (t?.color) tb.color = t.color;
        tb.results.push(scored);
        tb.driverKeys.add(key);
        tb.seasons.add(season.id);
      }
    }

    // Championships for this season, credited to the driver and — if they were
    // on a team that season — to that team. Computed from the UNFILTERED season
    // so every class's champion is found, then narrowed to the scope being
    // viewed: inside a class only that class's title counts, while the
    // league-wide view counts every crown. That's what carries a class
    // championship up into a driver's global tally instead of losing it to
    // whoever led the combined table. A driver who wins both their class and
    // the overall in one season scores both — two championships were decided.
    const crowns = crownsInScope(
      seasonChampions(season, decorated, allEntries, config, templatesById, seasonClasses),
      classSel.length ? classSel : classId,
    );
    for (const [entryId, rec] of titlesByEntry(crowns)) {
      const winner = allEntriesById[entryId];
      if (!winner) continue;
      const key = keyFor(winner);
      if (drivers[key]) drivers[key].titles += rec.titles;
      const tk = teamKeyFor(winner);
      if (tk && teams[tk]) teams[tk].titles += rec.titles;
    }
  }

  // A driver can be entered under a different name per series, so the name
  // shown here comes from their driver profile rather than whichever entry was
  // seen last: inside one game that's the name they've set for that game, and
  // league-wide it's their overall display name (see lib/driverNames.js).
  // `profile_name` keeps the overall name alongside it so a game's table can
  // show "who that is" under the on-track name.
  const names = await fetchDriverNames(Object.values(drivers).map(d => d.driver_id), gameId);

  const rows = Object.values(drivers).map(d => {
    const n = d.driver_id ? names[d.driver_id] : null;
    return {
      driver_name: n?.display || d.driver_name,
      profile_name: n?.overall || d.driver_name,
      game_alias: n?.game ?? null,
      driver_number: d.driver_number,
      driver_id: d.driver_id,
      user_id: d.user_id,
      ...aggregateCareerStats(d.results, d.titles),
    };
  });

  // Championship order — points, then the league tie-breaker chain (see
  // TIE_BREAKERS in lib/standings.js), then name for a dead-even pair.
  rows.sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "driver_name" }));

  // One row per persistent team, its all-time line in this scope: every point,
  // win, top 5, pole and finish scored by whoever was on its roster in each of
  // the seasons it fielded a lineup.
  const team_rows = Object.values(teams).map(t => ({
    team_id: t.team_id,
    team_name: t.team_name,
    logo_url: t.logo_url,
    color: t.color,
    drivers: t.driverKeys.size,
    seasons_raced: t.seasons.size,
    ...aggregateCareerStats(t.results, t.titles),
  }));
  team_rows.sort((a, b) => compareStandings(a, b, { pointsKey: "points", nameKey: "team_name" }));

  // Schedule metrics compare bare calendar dates (never `new Date(str)`, which
  // reads a YYYY-MM-DD date as UTC midnight and shifts it a day west).
  const today = todayDateString();
  const dated = allRaces.filter(r => toDateOnly(r.date));
  const completed = dated.filter(r => isPastRaceDate(r.date, today)).length;
  const nextRace = dated
    .filter(r => !isPastRaceDate(r.date, today))
    .sort((a, b) => raceDateSortKey(a.date) - raceDateSortKey(b.date))[0] || null;

  const totalDrivers = fieldSizes.reduce((a, b) => a + b, 0);

  return {
    seasons_counted: seasons.length,
    rows,
    team_rows,
    // Average Field Size — how many drivers a race in this scope typically
    // draws. Only races with finalized results are counted (see fieldSizeFor),
    // so an empty or still-upcoming event never drags the average down.
    field_size: {
      races_counted: fieldSizes.length,
      total_drivers: totalDrivers,
      avg_drivers_per_race: fieldSizes.length ? Math.round((totalDrivers / fieldSizes.length) * 100) / 100 : null,
      largest_field: fieldSizes.length ? Math.max(...fieldSizes) : null,
      smallest_field: fieldSizes.length ? Math.min(...fieldSizes) : null,
    },
    race_summary: {
      total: allRaces.length,
      completed,
      next_race: nextRace ? { name: nextRace.name, track: nextRace.track ?? null, date: toDateOnly(nextRace.date) } : null,
    },
  };
}

// How many drivers took part in one event, for the Average Field Size metric.
// Counted from the event's DECIDING session (the Feature for a heat weekend,
// otherwise its last standard race) — the same field size the Schedule shows —
// so a heat weekend counts its field once rather than once per heat. Provisional
// entries (drivers awarded points without racing) and qualifying-only
// appearances don't count as participation, and an event whose results haven't
// been entered yet returns 0 and is skipped entirely by the caller.
function fieldSizeFor(race, results) {
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const finalName = finalSessionName(race);
  const finalResults = results.filter(r =>
    r.race_id === race.id && !isQualifying(r) && !r.provisional && (r.session || firstStd) === finalName);
  return new Set(finalResults.map(r => r.entry_id)).size;
}
