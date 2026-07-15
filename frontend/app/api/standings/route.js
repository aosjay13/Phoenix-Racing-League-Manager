import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  calculateStandings,
  calculateTeamStandings,
  decorateRaceBonuses,
  resolveSeasonConfig,
} from "@/lib/standings";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const [seasonDoc, entriesSnap, teamsSnap, resultsSnap] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("teams").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
  ]);
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  const season = seasonDoc.data();
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const results = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));

  const config = resolveSeasonConfig(season);
  const drivers = calculateStandings(results, entries, teams, config);
  const teamRows = calculateTeamStandings(drivers.rows, teams);

  return NextResponse.json({
    season: { id: seasonId, ...season },
    drop_weeks: drivers.drop_weeks,
    drivers: drivers.rows,
    teams: teamRows,
  });
}
