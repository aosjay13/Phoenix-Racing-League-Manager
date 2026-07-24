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
import { fetchSeasonClasses, filterEntriesByClass, filterResultsByClass } from "@/lib/classServer";
import { gameAlias } from "@/lib/aliases";

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

  const entries = filterEntriesByClass(allEntries, classId);
  const results = filterResultsByClass(allResults, classId, entriesById);

  const config = resolveSeasonConfig(season);
  const drivers = calculateStandings(results, entries, teams, config, templatesById);
  const teamRows = calculateTeamStandings(drivers.rows, teams);

  // Contextual name rendering: on this game's standings, surface each driver's
  // game-specific alias (the on-track name) when they've mapped one. The season
  // carries its game_id; look up each pooled driver's alias for that game and
  // stamp it on the row (null when none), for the client to prefer over the
  // primary profile name.
  const gameId = season.game_id || null;
  if (gameId) {
    const driverIds = [...new Set(drivers.rows.map(r => r.driver_id).filter(Boolean))];
    const aliasByDriver = {};
    await Promise.all(driverIds.map(async id => {
      const doc = await db().collection("drivers").doc(id).get();
      if (doc.exists) aliasByDriver[id] = gameAlias(doc.data().aliases, gameId);
    }));
    for (const r of drivers.rows) r.game_alias = r.driver_id ? (aliasByDriver[r.driver_id] ?? null) : null;
  }

  // Tag every row with its class so the combined table can still show which
  // class each driver belongs to.
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
  for (const r of drivers.rows) {
    const cid = entriesById[r.entry_id]?.class_id || null;
    r.class_id = cid;
    r.class_name = cid ? (classNameById[cid] ?? null) : null;
  }

  return NextResponse.json({
    season: { id: seasonId, ...season },
    classes,
    class_id: classId || null,
    // Whether this season also crowns ONE overall champion across every class.
    // Defaults to true (and is meaningless without classes, where the whole
    // field is a single championship anyway).
    combined_championship: season.combined_championship !== false,
    drop_weeks: drivers.drop_weeks,
    drivers: drivers.rows,
    teams: teamRows,
  });
}
