import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raceId = searchParams.get("race_id");
  const seasonId = searchParams.get("season_id");
  if (!raceId && !seasonId) {
    return NextResponse.json({ error: "race_id or season_id required" }, { status: 400 });
  }
  let query = db().collection("results");
  query = raceId ? query.where("race_id", "==", raceId) : query.where("season_id", "==", seasonId);
  const snap = await query.get();
  return NextResponse.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

// Bulk save: replaces all results for the race so admins can re-submit
// corrections without hitting duplicate errors.
export const POST = withAdmin(async (request, ctx, user) => {
  const { race_id, season_id, rows } = await request.json();
  if (!race_id || !season_id || !Array.isArray(rows)) {
    return NextResponse.json({ error: "race_id, season_id, rows[] required" }, { status: 400 });
  }
  for (const row of rows) {
    if (!row.entry_id || !row.finish_pos) {
      return NextResponse.json({ error: "each row needs entry_id and finish_pos" }, { status: 400 });
    }
  }

  const col = db().collection("results");
  const existing = await col.where("race_id", "==", race_id).get();
  const batch = db().batch();
  existing.docs.forEach(d => batch.delete(d.ref));

  const numOrNull = v => (v != null && v !== "" ? Number(v) : null);
  const saved = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const ref = col.doc();
    const doc = {
      race_id,
      season_id,
      entry_id: row.entry_id,
      finish_pos: Number(row.finish_pos),
      start_pos: numOrNull(row.start_pos),
      qual_time: row.qual_time || null,
      laps: Number(row.laps || 0),
      laps_led: Number(row.laps_led || 0),
      incidents: Number(row.incidents || 0),
      fastest_lap: !!row.fastest_lap,
      halfway_leader: !!row.halfway_leader,
      hard_charger: !!row.hard_charger,
      provisional: !!row.provisional,
      bonus_points: Number(row.bonus_points || 0),
      penalty_points: Number(row.penalty_points || 0),
      status: row.status || "finished",
      created_at: now,
      created_by: user.uid,
    };
    batch.set(ref, doc);
    saved.push({ id: ref.id, ...doc });
  }
  await batch.commit();
  return NextResponse.json(saved, { status: 201 });
});
