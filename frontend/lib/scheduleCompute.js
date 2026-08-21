// Schedule listing enriched with the SimRacerHub-style summary each row needs
// (pole, winner, field size, distance) — computed in the browser.
//
// This is the code that used to run inside GET /api/schedule, moved rather than
// rewritten. Two modes:
//
//   seasonId set   → one season's events (the season view)
//   seasonId unset → a master feed ACROSS seasons, so the schedule page shows
//                    recent + upcoming racing immediately at "All Games" /
//                    "All Series" without drilling in. Rows carry their
//                    game/series/season context.
//
// The master feed is the one that most needed to come off the server: it reads
// every race, entry and result the league has ever recorded, so its cost grew
// with the league's whole history rather than with what is on screen.

import { decorateSessionFlags, sessionScopeContext } from "@/lib/standings";
import { indexResultsByRace, summarizeRace } from "@/lib/raceSummaryServer";
import { carForClass, carsByClassForRace, classIdsInSeason, filterRacesByClass, raceInClass } from "@/lib/classFilter";
import { bareResults, indexBundle, nameResolver } from "@/lib/rawIndex";

// Name every pole sitter / winner the way the game that event was raced on
// names them (see lib/driverNames.js), leaving the entry's own name in place
// for anyone with no name set for that game. Each row carries its own game, so
// the master feed across games gets each event's name right.
function applyGameNames(bundle, rows, gameIdOf) {
  const nameFor = nameResolver(bundle);
  const people = rows.flatMap(r => [
    r.summary?.winner, r.summary?.pole,
    ...(r.class_summaries || []).flatMap(cs => [cs.winner, cs.pole]),
  ].filter(Boolean).map(p => ({ person: p, gameId: gameIdOf(r) })));

  for (const { person, gameId } of people) {
    if (person.driver_id) person.name = nameFor.display(person.driver_id, gameId) || person.name;
  }
  return rows;
}

// One season's calendar. `classId` narrows it to that class's schedule: the
// events pinned to the class plus every shared (unpinned) event. "All Classes"
// returns the whole calendar. Each row carries `class_name` so a mixed schedule
// shows at a glance which events are class-specific.
function oneSeason(index, seasonId, classIdParam = "", className = "") {
  const season = index.seasonById[seasonId] ?? null;
  const classes = index.classesFor(seasonId);
  const allRaces = index.racesFor(seasonId);
  // The selection resolved against this season's own class docs, so a class
  // picked at series level still narrows the season it drills into.
  const classSel = classIdsInSeason(classes, { className, classId: classIdParam });
  const classId = classSel[0] || "";
  const races = filterRacesByClass(allRaces, classSel);
  const entriesById = Object.fromEntries(index.entriesFor(seasonId).map(e => [e.id, e]));
  // Summaries resolve results by race, so the map must cover every race the
  // results reference — build it from the unfiltered list.
  const racesById = Object.fromEntries(allRaces.map(r => [r.id, r]));
  const results = decorateSessionFlags(bareResults(index.resultsFor(seasonId)), racesById,
    sessionScopeContext({ seasons: [season], classes, entriesById }));
  // Grouped once for every summary below, rather than rescanned per race (and
  // again per class of every race).
  const resultsByRace = indexResultsByRace(results);
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));

  const viewClass = classId ? classes.find(c => c.id === classId) ?? null : null;
  // Inside a class, each row's summary is that class's own race: its pole, its
  // winner, its field, and its car. Events split by class have several winners,
  // so an unscoped summary would show whoever happened to be P1 in another
  // class. At "All Classes" a round where the classes run different machinery
  // carries `class_cars` instead, so the calendar still shows which car goes
  // with which class rather than collapsing to one of them.
  // The class whose car a row falls back on: the one being viewed, else the one
  // the round is pinned to (a Pro-only round shows Pro's car at "All Classes"),
  // else none — leaving the season default.
  const carClassFor = r => viewClass ?? (r.class_id ? classes.find(c => c.id === r.class_id) ?? null : null);
  // At "All Classes" on a multi-class season, a round several classes run has a
  // pole and a winner PER CLASS — a single combined summary would show whichever
  // class's P1 happened to sort first. Each such round carries `class_summaries`
  // so the calendar can list every class's pole/winner side by side.
  const classSummariesFor = r => {
    if (viewClass || classes.length < 2) return [];
    const running = classes.filter(c => raceInClass(r, c.id));
    if (running.length < 2) return [];
    return running.map(c => {
      const s = summarizeRace(r, resultsByRace, entriesById, null, c.id);
      return { class_id: c.id, class_name: c.name, pole: s.pole, winner: s.winner };
    });
  };
  const rows = races.map(r => ({
    ...r,
    class_name: r.class_id ? (classNameById[r.class_id] ?? null) : null,
    class_cars: viewClass ? [] : carsByClassForRace(r, season, classes),
    class_summaries: classSummariesFor(r),
    summary: summarizeRace(r, resultsByRace, entriesById, carForClass(season, carClassFor(r)), classSel),
  }));
  return applyGameNames(index.bundle, rows, () => season?.game_id || null);
}

// Master feed across every season in the bundle (a league, game or series
// scope). Races join to their season/series/game for context.
function globalFeed(index, gameId, seriesId) {
  const bundle = index.bundle;
  // Which seasons are in scope, given the optional game/series filters. The
  // bundle is already fetched at a scope, so this only bites when a narrower
  // filter is applied to a wider bundle.
  const seasonInScope = s => {
    if (!s) return false;
    if (seriesId) return s.series_id === seriesId;
    if (gameId) return s.game_id === gameId;
    return true;
  };

  const races = bundle.races || [];
  const racesById = Object.fromEntries(races.map(r => [r.id, r]));
  const entriesById = Object.fromEntries((bundle.entries || []).map(e => [e.id, e]));
  const results = decorateSessionFlags(bareResults(bundle.results || []), racesById,
    sessionScopeContext({
      seasons: index.seasons,
      classes: bundle.classes || [],
      entriesById,
    }));
  // Same grouping as oneSeason, and it matters more here: this feed spans every
  // season the league has ever raced, so the scan it replaces was the whole
  // history once per race.
  const resultsByRace = indexResultsByRace(results);

  const rows = [];
  for (const r of races) {
    const season = index.seasonById[r.season_id];
    if (!seasonInScope(season)) continue;
    const ser = season.series_id ? index.seriesById[season.series_id] : null;
    // A multi-class round has a pole and a winner PER CLASS, so the feed gets
    // the same per-class breakdown the season calendar shows rather than
    // whichever class's P1 happened to sort first. Both lists come back empty
    // for a single-class season, leaving the row exactly as it was.
    const seasonClasses = index.classesFor(season.id);
    const running = seasonClasses.filter(c => raceInClass(r, c.id));
    rows.push({
      ...r,
      class_cars: carsByClassForRace(r, season, seasonClasses),
      class_summaries: running.length < 2 ? [] : running.map(c => {
        const s = summarizeRace(r, resultsByRace, entriesById, null, c.id);
        return { class_id: c.id, class_name: c.name, pole: s.pole, winner: s.winner };
      }),
      summary: summarizeRace(r, resultsByRace, entriesById, season.car || null),
      season_id: season.id,
      season_name: season.name || "Season",
      series_id: ser?.id || null,
      series_name: ser?.name || null,
      game_id: season.game_id || null,
      game_name: season.game_id ? (index.gameNameById[season.game_id] || null) : null,
    });
  }
  return applyGameNames(bundle, rows, r => r.game_id);
}

export function buildSchedule(index, { seasonId = "", classId = "", className = "", gameId = "", seriesId = "" } = {}) {
  return seasonId
    ? oneSeason(index, seasonId, classId, className)
    : globalFeed(index, gameId || null, seriesId || null);
}

export function scheduleFromBundle(bundle, params) {
  return buildSchedule(indexBundle(bundle), params);
}
