import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { calculateStandings, DEFAULT_POINTS_SCALE } from "@/lib/standings";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season"));
  const dropWeeks = parseInt(searchParams.get("drop_weeks") ?? "0");

  if (!season) return NextResponse.json({ error: "season required" }, { status: 400 });

  const [driversSnap, racesSnap] = await Promise.all([
    db().collection("drivers").where("season", "==", season).get(),
    db().collection("races").where("season", "==", season).get(),
  ]);

  const drivers = driversSnap.docs.map(d => d.data());
  const raceIds = racesSnap.docs.map(d => d.data().race_id);

  let results = [];
  for (const raceId of raceIds) {
    const snap = await db().collection("results").where("race_id", "==", raceId).get();
    results.push(...snap.docs.map(d => d.data()));
  }

  const standings = calculateStandings(results, drivers, season, dropWeeks, DEFAULT_POINTS_SCALE);
  return NextResponse.json(standings);
}
