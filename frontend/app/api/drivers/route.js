import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export async function GET(request) {
  const season = parseInt(new URL(request.url).searchParams.get("season"));
  if (!season) return NextResponse.json({ error: "season required" }, { status: 400 });

  const snap = await db().collection("drivers").where("season", "==", season).get();
  return NextResponse.json(snap.docs.map(d => d.data()));
}

export async function POST(request) {
  const body = await request.json();
  const { name, number, team, season } = body;
  if (!name || number == null || !team || !season) {
    return NextResponse.json({ error: "name, number, team, season required" }, { status: 400 });
  }

  const uid = crypto.randomUUID();
  const doc = { uid, name, number: Number(number), team, season: Number(season) };
  await db().collection("drivers").doc(uid).set(doc);
  return NextResponse.json(doc, { status: 201 });
}
