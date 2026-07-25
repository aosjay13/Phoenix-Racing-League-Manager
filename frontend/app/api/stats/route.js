import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import {
  aggregateCareerStats,
  buildQualPosMap,
  buildQualTemplateMap,
  calculateStandings,
  configForTemplate,
  decorateRaceBonuses,
  decorateSessionFlags,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import {
  UNCLASSIFIED_LABEL,
  classKey,
  classOfResult,
  dedupeClassesByName,
  fetchClassesForSeasons,
  filterRacesByClass,
  filterResultsByClass,
  resolveClassScope,
} from "@/lib/classServer";
import { finalSessionName } from "@/lib/raceSummaryServer";
import { isPastRaceDate, raceDateSortKey, toDateOnly, todayDateString } from "@/lib/raceDate";

export const dynamic = "force-dynamic";

// Aggregated driver stats across seasons — the app version of the
// spreadsheet's "Overall Stats" sheets.
//   scope=league                → every season
//   scope=game&game_id=…        → all seasons in a game
//   scope=series&series_id=…    → all seasons in a series
//   scope=season&season_id=…    → one season
// Add &class_id=… to narrow to one class (Pro, GT3, …). A class doc belongs to a
// single season, so at series/game/league scope the id is widened to every
// same-named class in the scope (resolveClassScope) — that's what makes an
// all-time "GT3 stats" view work rather than showing one season's slice.
//
// Every response ALSO carries `by_class`: the same aggregation run separately
// for each class in the scope, so one race result cascades into its class table
// and the combined table in a single pass. Seasons with no classes (and
// unclassified drivers in seasons that have them) land in one default
// "Unclassified" group, so legacy data keeps feeding the combined totals exactly
// as it did before classes existed.
//
// Drivers are unified across seasons by linked account (user_id) when present,
// otherwise by roster name.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";
  const classId = searchParams.get("class_id") || "";

  let seasonsQuery = db().collection("seasons");
  if (scope === "game") {
    const gameId = searchParams.get("game_id");
    if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("game_id", "==", gameId);
  } else if (scope === "series") {
    const seriesId = searchParams.get("series_id");
    if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("series_id", "==", seriesId);
  } else if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(seasonId).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    return NextResponse.json(await buildStats([{ id: doc.id, ...doc.data() }], classId));
  } else if (scope !== "league") {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }

  // League-wide / game / series scopes read many seasons — constrain them to
  // the active league so stats never bleed across leagues. (scope=season is a
  // single doc, already league-correct via its id, and returns above.)
  seasonsQuery = scopeByLeague(seasonsQuery, getRequestLeagueId(request));
  const snap = await seasonsQuery.get();
  const seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return NextResponse.json(await buildStats(seasons, classId));
}

// Prefer the global driver identity (driver_id) so a driver who races under a
// different alias/number in each series still aggregates as one person; fall
// back to linked account or name for older entries written before driver_id
// existed.
const driverKeyFor = entry =>
  entry.driver_id ? `d:${entry.driver_id}` : entry.user_id ? `u:${entry.user_id}` : `n:${String(entry.name || "").trim().toLowerCase()}`;

// Fold one scored result into a driver bucket (creating it on first sight) and,
// when the driver runs for a team, into that team's bucket too. Used once for
// the combined totals and once per class split, so a GT3 win lands in the GT3
// table and the combined table from the same pass — the cascade.
function accumulate(store, entry, scored, team, teamKey) {
  const key = driverKeyFor(entry);
  const bucket = (store.drivers[key] ??= {
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
  bucket.results.push(scored);

  // Mirror the same scored result into its team bucket. A team's stats are the
  // combined results of every driver who raced for it in scope.
  if (teamKey) {
    const tb = (store.teams[teamKey] ??= {
      team_name: team?.name ?? entry.team, logo_url: team?.logo_url ?? null, color: team?.color ?? null,
      results: [], driverKeys: new Set(), titles: 0,
    });
    if (team?.name) tb.team_name = team.name;
    if (team?.logo_url) tb.logo_url = team.logo_url;
    if (team?.color) tb.color = team.color;
    tb.results.push(scored);
    tb.driverKeys.add(key);
  }
}

// A fresh, empty aggregation store — the shape every scope (combined or one
// class) accumulates into.
const emptyStore = () => ({ drivers: {}, teams: {}, fieldSizes: [], races: 0 });

// Credit a championship to a driver (and their team) inside one store. Silently
// no-ops when the champion has no results in that store, which is what happens
// for a season the current filter excluded.
function creditTitle(store, entry, teamKey) {
  const key = driverKeyFor(entry);
  if (store.drivers[key]) store.drivers[key].titles += 1;
  if (teamKey && store.teams[teamKey]) store.teams[teamKey].titles += 1;
}

async function buildStats(seasons, classId = "") {
  const seasonIds = seasons.map(s => s.id);
  const [templatesById, allClasses] = await Promise.all([
    fetchTemplatesById(),
    fetchClassesForSeasons(seasonIds),
  ]);
  // One selected class widens to every same-named class across the scope, so a
  // series/game/all-time view of "GT3" spans each season that ran it.
  const classScope = await resolveClassScope(classId, seasonIds, allClasses);
  const scopeClasses = dedupeClassesByName(allClasses);
  const selector = classScope?.ids ?? null;
  const classById = Object.fromEntries(allClasses.map(c => [c.id, c]));

  const combined = emptyStore();
  // classKey ("gt3") -> that class's own isolated aggregation. Keyed by NAME so
  // one bucket spans every season that ran the class. "" is the default group:
  // seasons with no classes at all, plus unclassified drivers elsewhere.
  const splits = new Map();
  const splitFor = cls => {
    const key = cls ? classKey(cls.name) : "";
    let split = splits.get(key);
    if (!split) {
      split = {
        key,
        class_id: cls?.id ?? "",
        class_ids: new Set(cls ? [cls.id] : []),
        class_name: cls?.name ?? UNCLASSIFIED_LABEL,
        color: cls?.color ?? null,
        sort_order: cls ? Number(cls.sort_order || 0) : Number.MAX_SAFE_INTEGER,
        is_default: !cls,
        seasons: new Set(),
        ...emptyStore(),
      };
      splits.set(key, split);
    }
    if (cls) split.class_ids.add(cls.id);
    return split;
  };

  // Every race across the scope, used for the dashboard's schedule metrics
  // (total / completed / next upcoming) alongside the per-driver aggregates.
  const allRaces = [];

  for (const season of seasons) {
    const config = resolveSeasonConfig(season);
    const [entriesSnap, resultsSnap, racesSnap, teamsSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
      db().collection("races").where("season_id", "==", season.id).get(),
      db().collection("teams").where("season_id", "==", season.id).get(),
    ]);
    const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allEntriesById = Object.fromEntries(allEntries.map(e => [e.id, e]));
    const teamsById = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data()]));
    const seasonRaces = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Under a class filter, only that class's calendar counts toward the race
    // totals and field size — its own events plus the shared ones. The
    // race→doc map stays unfiltered so results always resolve their race.
    const races = filterRacesByClass(seasonRaces, selector);
    const racesById = Object.fromEntries(seasonRaces.map(r => [r.id, r]));
    for (const r of races) allRaces.push(r);
    const decorated = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));
    // A class filter narrows the field before anything is scored, so a class
    // view shows that class's own points, wins and averages — not a slice of
    // the overall table.
    const results = filterResultsByClass(decorated, selector, allEntriesById);
    // The class's field: everyone rostered in it, PLUS anyone who actually
    // scored a result in it. A driver who ran up a class for one round is
    // stamped with that class on the result while their roster entry says
    // otherwise — they belong in the table they raced in.
    const scoredIn = new Set(results.map(r => r.entry_id));
    const entries = selector
      ? allEntries.filter(e => selector.has(e.class_id || "") || scoredIn.has(e.id))
      : allEntries;
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const qualPosMap = buildQualPosMap(results);
    const qualTemplateByRace = buildQualTemplateMap(results);

    // Average field size: how many drivers actually took part in each event.
    combined.races += races.length;
    for (const race of races) {
      const n = fieldSizeFor(race, results);
      if (n > 0) combined.fieldSizes.push(n);
    }

    const teamKeyFor = entry => {
      const t = entry.team_id ? teamsById[entry.team_id] : null;
      const name = (t?.name ?? entry.team ?? "").trim();
      return name ? `t:${name.toLowerCase()}` : null;
    };

    // The classes this season actually runs, and the results each of them owns.
    // A season with none produces a single default group holding the whole
    // field, so legacy seasons need no special handling anywhere below.
    const seasonClasses = allClasses.filter(c => c.season_id === season.id);
    const resultsByClass = new Map();  // class doc (or null) -> results
    for (const r of results) {
      const cid = classOfResult(r, allEntriesById);
      const cls = cid ? classById[cid] ?? null : null;
      const key = cls ? classKey(cls.name) : "";
      let bucket = resultsByClass.get(key);
      if (!bucket) resultsByClass.set(key, (bucket = { cls, results: [] }));
      bucket.results.push(r);
    }

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const team = entry.team_id ? teamsById[entry.team_id] : null;
      const teamKey = teamKeyFor(entry);
      const scored = {
        ...r,
        points: (isQualifying(r) || r.counts_points === false) ? 0 : pointsFor(r, configForTemplate(config, templatesById[r.points_template_id]), qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null, configForTemplate(config, templatesById[qualTemplateByRace[r.race_id]])),
      };
      // The cascade: one result counts in the combined table AND in its own
      // class's table. Nothing is moved out of the combined totals — a class is
      // an extra view of the same result, never a replacement for it.
      accumulate(combined, entry, scored, team, teamKey);
      const cid = classOfResult(r, allEntriesById);
      const split = splitFor(cid ? classById[cid] ?? null : null);
      split.seasons.add(season.id);
      accumulate(split, entry, scored, team, teamKey);
    }

    // Per-class race counts and field sizes: a class's calendar is its own
    // pinned events plus every shared one.
    for (const [, { cls, results: classResults }] of resultsByClass) {
      const split = splitFor(cls);
      split.seasons.add(season.id);
      const classRaces = cls ? filterRacesByClass(races, cls.id) : races;
      split.races += classRaces.length;
      for (const race of classRaces) {
        const n = fieldSizeFor(race, classResults);
        if (n > 0) split.fieldSizes.push(n);
      }
    }

    if (season.status !== "completed" || !results.length) continue;

    // Titles. Three things can crown a champion, and a multi-class season can
    // crown several at once:
    //   • a season with no classes → its one champion (unchanged, always);
    //   • each class of a multi-class season → its class champion;
    //   • the whole field → the overall champion, but only when the season's
    //     "Overall Championship" toggle is on (combined_championship), since a
    //     season running class championships only never crowns one.
    // Under a class filter the field is already narrowed, so the standings
    // computed here ARE that class's championship and are credited directly.
    const combinedOn = season.combined_championship !== false;
    const hasClasses = seasonClasses.length > 0;
    if (selector || !hasClasses || combinedOn) {
      const standings = calculateStandings(results, entries, [], config, templatesById);
      const winner = standings.rows[0] && entriesById[standings.rows[0].entry_id];
      if (winner) creditTitle(combined, winner, teamKeyFor(winner));
    }
    // Class champions cascade into the all-time totals as well: a GT3 title is a
    // title. (Skipped under a class filter — the block above already credited
    // exactly that class's champion.)
    for (const [, { cls, results: classResults }] of resultsByClass) {
      const split = splitFor(cls);
      // Same rule as the scope filter above: the class's field is its roster
      // plus anyone who scored in it this season.
      const scoredInClass = new Set(classResults.map(r => r.entry_id));
      const classEntries = cls
        ? entries.filter(e => e.class_id === cls.id || scoredInClass.has(e.id))
        : entries;
      if (!classResults.length || !classEntries.length) continue;
      const standings = calculateStandings(classResults, classEntries, [], config, templatesById);
      const winner = standings.rows[0] && entriesById[standings.rows[0].entry_id];
      if (!winner) continue;
      // The default group only crowns anyone when it IS the whole season (a
      // season with no classes) — leading the unclassified stragglers of a
      // multi-class season is not a championship.
      if (cls || !hasClasses) creditTitle(split, winner, teamKeyFor(winner));
      if (!selector && hasClasses && cls) creditTitle(combined, winner, teamKeyFor(winner));
    }
  }

  // A driver can run a different alias per series; when aggregating across
  // more than one season, show their canonical global-driver name instead of
  // whichever alias happened to be seen last.
  const allStores = [combined, ...splits.values()];
  const driverIds = [...new Set(allStores.flatMap(s => Object.values(s.drivers).map(d => d.driver_id)).filter(Boolean))];
  const canonicalName = {};
  if (driverIds.length) {
    const docs = await Promise.all(driverIds.map(id => db().collection("drivers").doc(id).get()));
    for (const doc of docs) if (doc.exists) canonicalName[doc.id] = doc.data().name;
  }

  const driverRowsOf = store => {
    const rows = Object.values(store.drivers).map(d => ({
      driver_name: (d.driver_id && canonicalName[d.driver_id]) || d.driver_name,
      driver_number: d.driver_number,
      driver_id: d.driver_id,
      user_id: d.user_id,
      ...aggregateCareerStats(d.results, d.titles),
    }));
    rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.driver_name.localeCompare(b.driver_name));
    return rows;
  };

  const teamRowsOf = store => {
    const rows = Object.values(store.teams).map(t => ({
      team_name: t.team_name,
      logo_url: t.logo_url,
      color: t.color,
      drivers: t.driverKeys.size,
      ...aggregateCareerStats(t.results, t.titles),
    }));
    rows.sort((a, b) => b.points - a.points || b.wins - a.wins || String(a.team_name).localeCompare(String(b.team_name)));
    return rows;
  };

  // Average Field Size — how many drivers a race in this scope typically draws.
  // Only races with finalized results are counted (see fieldSizeFor), so an
  // empty or still-upcoming event never drags the average down.
  const fieldSizeOf = ({ fieldSizes }) => {
    const total = fieldSizes.reduce((a, b) => a + b, 0);
    return {
      races_counted: fieldSizes.length,
      total_drivers: total,
      avg_drivers_per_race: fieldSizes.length ? Math.round((total / fieldSizes.length) * 100) / 100 : null,
      largest_field: fieldSizes.length ? Math.max(...fieldSizes) : null,
      smallest_field: fieldSizes.length ? Math.min(...fieldSizes) : null,
    };
  };

  // Schedule metrics compare bare calendar dates (never `new Date(str)`, which
  // reads a YYYY-MM-DD date as UTC midnight and shifts it a day west).
  const today = todayDateString();
  const dated = allRaces.filter(r => toDateOnly(r.date));
  const completed = dated.filter(r => isPastRaceDate(r.date, today)).length;
  const nextRace = dated
    .filter(r => !isPastRaceDate(r.date, today))
    .sort((a, b) => raceDateSortKey(a.date) - raceDateSortKey(b.date))[0] || null;

  // Class splits in the admin's class order, the default (Unclassified) group
  // last. Dropped entirely when every result in scope falls in that one default
  // group, which is every season that predates classes — those responses look
  // exactly as they did before.
  const by_class = [...splits.values()]
    .sort((a, b) => a.sort_order - b.sort_order || String(a.class_name).localeCompare(String(b.class_name)))
    .map(split => ({
      class_id: split.class_id,
      class_ids: [...split.class_ids],
      class_name: split.class_name,
      color: split.color,
      is_default: split.is_default,
      seasons_counted: split.seasons.size,
      races_counted: split.races,
      field_size: fieldSizeOf(split),
      rows: driverRowsOf(split),
      team_rows: teamRowsOf(split),
    }));

  return {
    seasons_counted: seasons.length,
    rows: driverRowsOf(combined),
    team_rows: teamRowsOf(combined),
    // The classes this scope offers, one row per distinct class name, and which
    // one (if any) the returned combined tables are filtered to.
    classes: scopeClasses,
    class_id: classId || null,
    class_name: classScope?.name ?? null,
    // Every class's own isolated aggregation, alongside the combined tables
    // above — a class result feeds both.
    by_class: by_class.length === 1 && by_class[0].is_default ? [] : by_class,
    field_size: fieldSizeOf(combined),
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
