// One season's championship tables, computed in the browser.
//
// This is the code that used to run inside GET /api/standings, moved rather
// than rewritten: same order, same rules, same payload. What changed is where
// it runs and what it starts from — a raw bundle (see lib/rawBundle.js) instead
// of a fistful of Firestore reads. The route is now a pass-through, and this
// runs in a useMemo on the Standings page.
//
// A class championship is scored exactly like the overall one, just over a
// narrowed field: points, gaps, ranks and every stat are recomputed within the
// class, so its leader is rank 1 with a 0-point gap rather than being pulled out
// of the combined table.

import {
  calculateStandings,
  calculateTeamStandings,
  decorateRaceBonuses,
  decorateSessionFlags,
  sessionScopeContext,
  isQualifying,
  makeScorer,
  parseMaybeJson,
  resolveSeasonConfig,
} from "@/lib/standings";
import { bangerPoints, bangerStatLine, hasBangerBonuses } from "@/lib/bangerRacing";
import {
  classIdsInSeason, classNamesFor, entryClassIds, entryClassIdsOrdered,
  filterEntriesByClass, filterResultsByClass, orderEntryClasses,
} from "@/lib/classFilter";
import { seasonChampions } from "@/lib/champions";
import { applySeasonTeams, teamsForEntries } from "@/lib/teams";
import { bareResults, driverNames, hiddenName, indexBundle, isIracingScope } from "@/lib/rawIndex";

// A champion, named the way this game's tables name them — and never with an
// iRacing real name on a season that isn't iRacing's.
function championName(bundle, entry, gameId) {
  const stored = entry?.name ?? "Unknown";
  if (!entry?.driver_id || !hiddenName(bundle, entry.driver_id, stored, gameId)) return stored;
  return driverNames(bundle, [entry.driver_id], gameId)[entry.driver_id]?.overall || stored;
}

// `index` is an indexBundle() of a scope=season bundle; `seasonId` names the
// season inside it. Returns { status, body } so a screen can render a 404 the
// same way the route reported one.
export function buildStandings(index, { seasonId, classId = "", className = "" }) {
  const season = index.seasonById[seasonId];
  if (!season) return { status: 404, body: { error: "Season not found" } };

  const classes = index.classesFor(seasonId);
  const templatesById = index.templatesById;
  const teamIndex = index.teamIndex;

  // Every entry is stamped with the team that driver raced for IN THIS SEASON
  // (its `team_seasons` lineup, falling back to the entry's own tag — see
  // lib/teams.js). Doing it here, once, is what makes the team table below a
  // straight roll-up of the driver table: same points, same wins, same poles,
  // just grouped by team.
  const allEntries = applySeasonTeams(index.entriesFor(seasonId), seasonId, teamIndex);
  // Put every entry's classes into the season's order first, so a result that
  // records no class of its own resolves to a stable primary class (see
  // orderEntryClasses) instead of whichever class was ticked first.
  const entriesById = orderEntryClasses(
    Object.fromEntries(allEntries.map(e => [e.id, e])),
    classes,
  );
  const teams = teamsForEntries(allEntries, seasonId, teamIndex);
  const racesById = Object.fromEntries(index.racesFor(seasonId).map(({ id, ...race }) => [id, race]));
  const allResults = decorateRaceBonuses(decorateSessionFlags(bareResults(index.resultsFor(seasonId)), racesById,
    // The season and its classes can name heat/consolation points defaults of
    // their own; they resolve per result, under its own class.
    sessionScopeContext({ seasons: [season], classes, entriesById })));

  // Resolve the selection against THIS season's class docs, so a class picked
  // at series level still narrows the season it drills into.
  const classSel = classIdsInSeason(classes, { className, classId });
  const entries = filterEntriesByClass(allEntries, classSel);
  const results = filterResultsByClass(allResults, classSel, entriesById);

  // The series is the top of the points chain: its structure is the default
  // this season (and each of its classes) overrides. A series that sets nothing
  // leaves the season exactly as it scored before.
  const config = resolveSeasonConfig(season, index.seriesFor(season));
  // `classes` lets a class scoring on its own points structure total under it —
  // in its own championship and in the combined table alike.
  //
  // The roster handed over is the season's WHOLE roster, never the class's slice
  // of it. The two arguments answer different questions: `results` is already
  // narrowed to this class by the class each result RECORDS, while the roster
  // only ever supplies the name, number, team and points adjustment for the rows
  // those results produce. Narrow the roster too and every driver whose result is
  // stamped with this class while their roster entry is not — an unclassified
  // driver entered in a "<class> only" round, anyone re-classed after they raced
  // — loses their identity on the way through: they appear in the class table as
  // "Unknown", with their manual points adjustment silently dropped along with
  // their name, even though the results being counted are unmistakably theirs.
  const drivers = calculateStandings(results, Object.values(entriesById), teams, config, templatesById, classes);
  const teamRows = calculateTeamStandings(drivers.rows, teams);

  // ── Are the derby stats actually paying? ─────────────────────────────────
  //
  // Recorded takedowns/bonuses that award nothing is the one Demo Derby failure
  // an admin can't see: the columns fill in, the totals don't move, and nothing
  // says why. So the answer is computed here, from the SAME scorer the totals
  // come from — how many derby stats are on the board, and how many points they
  // actually paid — and the screen turns it into a warning. No guessing at which
  // level a rate should have been set: if it paid 0, it paid 0.
  const scoringResults = results.filter(r => !isQualifying(r) && r.counts_points !== false);
  const derbyScorer = makeScorer(results, { config, classes, entriesById, templatesById });
  const derbyLine = bangerStatLine(scoringResults);
  const derby = {
    stats_recorded: Object.values(derbyLine).reduce((a, n) => a + Number(n || 0), 0),
    points_awarded: scoringResults.reduce((a, r) => a + bangerPoints(r, derbyScorer.configFor(r).bonuses), 0),
    // Whether the SEASON itself pays, and which classes do. A class rate only
    // reaches results recorded in that class, so "the Banger class pays but
    // nothing scored" is a different problem from "nothing is set anywhere" —
    // and the fix is different too.
    season_pays: hasBangerBonuses(config.bonuses),
    paying_classes: classes
      .filter(c => hasBangerBonuses(parseMaybeJson(c.bonus_points, {})))
      .map(c => c.name),
  };

  // Contextual name rendering: on this game's standings, surface the name each
  // driver is shown under IN THIS GAME when they've set one. The season carries
  // its game_id; resolve every pooled driver's name for that game (see
  // lib/driverNames.js) and stamp it on the row — null when they haven't set
  // one, so the table falls back to the name on the entry.
  //
  // The name stored on the entry is checked here rather than trusted. It is a
  // copy of whatever the driver's overall name was when the entry was written
  // (see lib/driverSync.js), so for somebody who races iRacing it can BE their
  // real name — which an AMS2 or BeamNG standings table may not print. When it
  // is, the resolved generic name stands in; every other row is untouched.
  const gameId = season.game_id || null;
  const names = driverNames(index.bundle, drivers.rows.map(r => r.driver_id), gameId);
  // And whether the table may print a second name under the on-track one at
  // all: only iRacing's own standings may, because outside it that line is the
  // real name (see isIracingScope in lib/rawIndex.js).
  const iracing = isIracingScope(index.bundle, gameId);
  for (const r of drivers.rows) {
    const n = r.driver_id ? names[r.driver_id] : null;
    r.game_alias = n?.game ?? null;
    if (r.driver_id && hiddenName(index.bundle, r.driver_id, r.driver_name, gameId)) {
      r.driver_name = n?.overall || r.driver_name;
    }
    r.profile_name = iracing ? (n?.overall ?? null) : null;
  }

  // Tag every row with its class so the combined table can still show which
  // class each driver belongs to. A driver entered in several classes lists
  // them all, with the primary one kept in `class_id` for anything that can
  // only carry a single class. Every driver lists their classes in the SEASON's
  // order (the order the Class menu shows), so the column reads the same way on
  // every row instead of following whatever order each entry was saved with.
  for (const r of drivers.rows) {
    const entry = entriesById[r.entry_id];
    const cids = entryClassIdsOrdered(entry, classes);
    r.class_id = cids[0] || null;
    r.class_ids = cids;
    const names = classNamesFor(entry, classes);
    r.class_name = names.length ? names.join(" · ") : null;
  }

  // Every crown this season handed out, so the standings screen can show who
  // was actually credited — a class-by-class list plus the overall one, in the
  // same order the classes are listed. Computed from the UNFILTERED season, and
  // empty until the season is marked completed (nothing is awarded before
  // then). Named from the roster entry, matching the tables above.
  const champions = seasonChampions(season, allResults, allEntries, config, templatesById, classes)
    .map(c => ({
      ...c,
      driver_name: championName(index.bundle, entriesById[c.entry_id], gameId),
      driver_id: entriesById[c.entry_id]?.driver_id ?? null,
      user_id: entriesById[c.entry_id]?.user_id ?? null,
    }));

  return { status: 200, body: {
    season,
    classes,
    champions,
    class_id: classSel[0] || classId || null,
    class_name: className || null,
    // Whether this season also crowns ONE overall champion across every class.
    // Defaults to true (and is meaningless without classes, where the whole
    // field is a single championship anyway).
    combined_championship: season.combined_championship !== false,
    // Derby accounting for this scope — see above.
    derby,
    // Why a class championship is empty, when it is. A class only collects the
    // results actually recorded IN it, so a season whose drivers were never
    // assigned to a class (or whose results were entered on a shared grid with
    // the Class cell left blank) has a full season table and an empty class one
    // — with nothing on screen to say which of the two it is.
    class_scope: classSel.length ? {
      entries_in_class: entries.length,
      results_in_class: results.filter(r => !isQualifying(r)).length,
      season_entries: allEntries.length,
      season_results: allResults.filter(r => !isQualifying(r)).length,
      // Drivers in the season who are in NO class at all — the ones an admin
      // can drop into this class in one action to populate its championship
      // (see /api/admin/entries/assign-class). Their existing results come with
      // them: a result with no class of its own resolves through its driver's
      // roster class.
      unclassified_entries: allEntries.filter(e => entryClassIds(e).length === 0).length,
      // The concrete class doc this scope resolved to, so the screen can act on
      // it (the selection travels by name across seasons).
      class_id: classSel[0] || null,
    } : null,
    drop_weeks: drivers.drop_weeks,
    drivers: drivers.rows,
    teams: teamRows,
  } };
}

// Convenience for callers holding a raw bundle rather than an index.
export function standingsFromBundle(bundle, params) {
  return buildStandings(indexBundle(bundle), params);
}
