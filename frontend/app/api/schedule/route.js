import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { decorateSessionFlags } from "@/lib/standings";
import { summarizeRace } from "@/lib/raceSummaryServer";

export const dynamic = "force-dynamic";

// Schedule listing for one season, enriched with the SimRacerHub-style summary
// each row needs (pole, winner, field size, distance). Kept separate from the
// generic /api/races feed so the heavier results/entries joins only run for the
// schedule table that actually consumes them.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id is required" }, { status: 400 });

  const [seasonDoc, racesSnap, entriesSnap, resultsSnap] = await Promise.all([
    db().collection("seasons").doc(seasonId).get(),
    db().collection("races").where("season_id", "==", seasonId).get(),
    db().collection("entries").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
  ]);

  const seasonCar = seasonDoc.exists ? (seasonDoc.data().car || null) : null;
  const races = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const racesById = Object.fromEntries(races.map(r => [r.id, r]));
  const results = decorateSessionFlags(resultsSnap.docs.map(d => d.data()), racesById);

  const rows = races.map(r => ({ ...r, summary: summarizeRace(r, results, entriesById, seasonCar) }));
  return NextResponse.json(rows);
}
