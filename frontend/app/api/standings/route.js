import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
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
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { classIdsInSeason, classNamesFor, entryClassIds, entryClassIdsOrdered, fetchSeasonClasses, filterEntriesByClass, filterResultsByClass, orderEntryClasses } from "@/lib/classServer";
import { seasonChampions } from "@/lib/champions";
import { fetchSeriesForSeason } from "@/lib/seriesServer";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { applySeasonTeams, teamsForEntries } from "@/lib/teams";
import { loadTeamIndex } from "@/lib/teamsServer";
import { getRequestLeagueId } from "@/lib/serverAuth";

// One season's championship tables.
//   ?season_id=…              → the overall (whole-field) championship
//   ?season_id=…&class_id=…   → that class's own isolated championship
//
// A class championship is scored exactly like the overall one, just over a
// narrowed field: points, gaps, ranks and every stat are recomputed within the
// class, so its leader is rank 1 with a 0-point gap rather than being pulled out
// of the combined table.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const classId = searchParams.get("class_id") || "";
  const className = searchParams.get("class_name") || "";
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const [seasonDoc, entriesSnap, teamIndex, resultsSnap, racesSnap, templatesById, classes] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    loadTeamIndex({ leagueId: getRequestLeagueId(request) }),
    db().collection("results").where("season_id", "==", seasonId).get(),
    db().collection("races").where("season_id", "==", seasonId).get(),
    fetchTemplatesById(),
    fetchSeasonClasses(seasonId),
  ]);
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  const season = seasonDoc.data();
  // Every entry is stamped with the team that driver raced for IN THIS SEASON
  // (its `team_seasons` lineup, falling back to the entry's own tag — see
  // lib/teams.js). Doing it here, once, is what makes the team table below a
  // straight roll-up of the driver table: same points, same wins, same poles,
  // just grouped by team.
  const allEntries = applySeasonTeams(
    entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    seasonId,
    teamIndex,
  );
  // Put every entry's classes into the season's order first, so a result that
  // records no class of its own resolves to a stable primary class (see
  // orderEntryClasses) instead of whichever class was ticked first.
  const entriesById = orderEntryClasses(
    Object.fromEntries(allEntries.map(e => [e.id, e])),
    classes,
  );
  const teams = teamsForEntries(allEntries, seasonId, teamIndex);
  const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
  const allResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById,
    // The season and its classes can name heat/consolation points defaults of
    // their own; they resolve per result, under its own class.
    sessionScopeContext({ seasons: [{ id: seasonId, ...season }], classes, entriesById })));

  // Resolve the selection against THIS season's class docs, so a class picked
  // at series level still narrows the season it drills into.
  const classSel = classIdsInSeason(classes, { className, classId });
  const entries = filterEntriesByClass(allEntries, classSel);
  const results = filterResultsByClass(allResults, classSel, entriesById);

  // The series is the top of the points chain: its structure is the default
  // this season (and each of its classes) overrides. A series that sets nothing
  // leaves the season exactly as it scored before.
  const series = await fetchSeriesForSeason(season);
  const config = resolveSeasonConfig(season, series);
  // `classes` lets a class scoring on its own points structure total under it —
  // in its own championship and in the combined table alike.
  const drivers = calculateStandings(results, entries, teams, config, templatesById, classes);
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
  // one, so the client falls back to the name on the entry.
  const gameId = season.game_id || null;
  if (gameId) {
    const names = await fetchDriverNames(drivers.rows.map(r => r.driver_id), gameId);
    for (const r of drivers.rows) r.game_alias = r.driver_id ? (names[r.driver_id]?.game ?? null) : null;
  }

  // Tag every row with its class so the combined table can still show which
  // class each driver belongs to. A driver entered in several classes lists
  // them all, with the primary one kept in `class_id` for anything that can
  // only carry a single class.
  // Every driver lists their classes in the SEASON's order (the order the Class
  // menu shows), so the column reads the same way on every row instead of
  // following whatever order each entry happened to be saved with.
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
  const champions = seasonChampions({ id: seasonId, ...season }, allResults, allEntries, config, templatesById, classes)
    .map(c => ({
      ...c,
      driver_name: entriesById[c.entry_id]?.name ?? "Unknown",
      driver_id: entriesById[c.entry_id]?.driver_id ?? null,
      user_id: entriesById[c.entry_id]?.user_id ?? null,
    }));

  return NextResponse.json({
    season: { id: seasonId, ...season },
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
  });
}
