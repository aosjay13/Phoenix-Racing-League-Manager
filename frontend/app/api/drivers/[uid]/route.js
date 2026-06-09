import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export async function PUT(request, { params }) {
  const { uid } = params;
  const existing = await db().collection("drivers").doc(uid).get();
  if (!existing.exists) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const body = await request.json();
  const { name, number, team, season } = body;
  const updated = { uid, name, number: Number(number), team, season: Number(season) };
  await db().collection("drivers").doc(uid).set(updated);
  return NextResponse.json(updated);
}

export async function DELETE(_, { params }) {
  const { uid } = params;
  const existing = await db().collection("drivers").doc(uid).get();
  if (!existing.exists) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  await db().collection("drivers").doc(uid).delete();
  return NextResponse.json({ deleted: true });
}
