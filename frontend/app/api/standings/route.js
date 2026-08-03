import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  calculateStandings,
  calculateTeamStandings,
  decorateRaceBonuses,
  decorateSessionFlags,
  resolveSeasonConfig,
} from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { classIdsInSeason, entryClassIds, fetchSeasonClasses, filterEntriesByClass, filterResultsByClass } from "@/lib/classServer";
import { fetchDriverNames } from "@/lib/driverNamesServer";

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

  const [seasonDoc, entriesSnap, teamsSnap, resultsSnap, racesSnap, templatesById, classes] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("teams").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
    db().collection("races").where("season_id", "==", seasonId).get(),
    fetchTemplatesById(),
    fetchSeasonClasses(seasonId),
  ]);
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  const season = seasonDoc.data();
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const entriesById = Object.fromEntries(allEntries.map(e => [e.id, e]));
  const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const racesById = Object.fromEntries(racesSnap.docs.map(d => [d.id, d.data()]));
  const allResults = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById));

  // Resolve the selection against THIS season's class docs, so a class picked
  // at series level still narrows the season it drills into.
  const classSel = classIdsInSeason(classes, { className, classId });
  const entries = filterEntriesByClass(allEntries, classSel);
  const results = filterResultsByClass(allResults, classSel, entriesById);

  const config = resolveSeasonConfig(season);
  // `classes` lets a class scoring on its own points structure total under it —
  // in its own championship and in the combined table alike.
  const drivers = calculateStandings(results, entries, teams, config, templatesById, classes);
  const teamRows = calculateTeamStandings(drivers.rows, teams);

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
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
  for (const r of drivers.rows) {
    const cids = entryClassIds(entriesById[r.entry_id]);
    r.class_id = cids[0] || null;
    r.class_ids = cids;
    const names = cids.map(cid => classNameById[cid]).filter(Boolean);
    r.class_name = names.length ? names.join(" · ") : null;
  }

  return NextResponse.json({
    season: { id: seasonId, ...season },
    classes,
    class_id: classSel[0] || classId || null,
    class_name: className || null,
    // Whether this season also crowns ONE overall champion across every class.
    // Defaults to true (and is meaningless without classes, where the whole
    // field is a single championship anyway).
    combined_championship: season.combined_championship !== false,
    drop_weeks: drivers.drop_weeks,
    drivers: drivers.rows,
    teams: teamRows,
  });
}
