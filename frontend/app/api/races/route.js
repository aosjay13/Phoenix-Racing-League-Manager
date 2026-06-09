import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export async function GET(request) {
  const season = parseInt(new URL(request.url).searchParams.get("season"));
  if (!season) return NextResponse.json({ error: "season required" }, { status: 400 });

  const snap = await db().collection("races").where("season", "==", season).get();
  return NextResponse.json(snap.docs.map(d => d.data()));
}

export async function POST(request) {
  const body = await request.json();
  const { track, date, season, round_number } = body;
  if (!track || !date || !season || !round_number) {
    return NextResponse.json({ error: "track, date, season, round_number required" }, { status: 400 });
  }

  const race_id = crypto.randomUUID();
  const doc = { race_id, track, date, season: Number(season), round_number: Number(round_number) };
  await db().collection("races").doc(race_id).set(doc);
  return NextResponse.json(doc, { status: 201 });
}
