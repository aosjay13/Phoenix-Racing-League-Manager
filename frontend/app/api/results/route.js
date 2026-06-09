import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export async function POST(request) {
  const body = await request.json();
  const { driver_uid, race_id, finish_pos, laps_led = 0, incidents = 0, status = "finished" } = body;

  if (!driver_uid || !race_id || !finish_pos) {
    return NextResponse.json({ error: "driver_uid, race_id, finish_pos required" }, { status: 400 });
  }

  const existing = await db().collection("results")
    .where("race_id", "==", race_id)
    .where("driver_uid", "==", driver_uid)
    .limit(1)
    .get();

  if (!existing.empty) {
    return NextResponse.json({ detail: "Result already exists for this driver and race" }, { status: 409 });
  }

  const result_id = crypto.randomUUID();
  const doc = {
    result_id,
    driver_uid,
    race_id,
    finish_pos: Number(finish_pos),
    laps_led: Number(laps_led),
    incidents: Number(incidents),
    status,
    created_at: new Date().toISOString(),
  };
  await db().collection("results").doc(result_id).set(doc);
  return NextResponse.json(doc, { status: 201 });
}
