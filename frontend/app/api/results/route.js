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

const SESSION_TYPES = ["qualifying", "race", "heat", "consolation", "feature"];

// Bulk save: replaces all results for the race session so admins can
// re-submit corrections without hitting duplicate errors. Events with
// multiple races (or, for heat-format events, multiple heats/consolations)
// store one `session` name per race. `points_template_id` (optional) pins
// the points system this session was scored under, so standings/stats stay
// correct even if the season's default or another session's template later
// changes — see lib/standings.js configForTemplate().
export const POST = withAdmin(async (request, ctx, user) => {
  const { race_id, season_id, session = "", session_type, points_template_id, rows } = await request.json();
  const sessionType = SESSION_TYPES.includes(session_type) ? session_type : "race";
  if (!race_id || !season_id || !Array.isArray(rows)) {
    return NextResponse.json({ error: "race_id, season_id, rows[] required" }, { status: 400 });
  }
  for (const row of rows) {
    if (!row.entry_id || !row.finish_pos) {
      return NextResponse.json({ error: "each row needs entry_id and finish_pos" }, { status: 400 });
    }
  }

  // Determine the event's session list so we replace only the race being saved
  // (an event may hold several races) and still overwrite legacy results that
  // predate the session field.
  const raceDoc = await db().collection("races").doc(race_id).get();
  const raceSessions = raceDoc.exists && Array.isArray(raceDoc.data().sessions) && raceDoc.data().sessions.length
    ? raceDoc.data().sessions
    : ["Race"];
  const firstSession = raceSessions[0];
  const savingSession = session || firstSession;

  const col = db().collection("results");
  const existing = await col.where("race_id", "==", race_id).get();
  const batch = db().batch();
  // Replace only the exact session being saved, isolating qualifying from race
  // sessions (and legacy race results that predate the session fields).
  existing.docs
    .filter(d => {
      const data = d.data();
      const docType = data.session_type || "race";
      const docSession = data.session || firstSession;
      return docType === sessionType && docSession === savingSession;
    })
    .forEach(d => batch.delete(d.ref));

  const numOrNull = v => (v != null && v !== "" ? Number(v) : null);
  const saved = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const ref = col.doc();
    const doc = {
      race_id,
      season_id,
      session: savingSession,
      session_type: sessionType,
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
      points_template_id: points_template_id || null,
      created_at: now,
      created_by: user.uid,
    };
    batch.set(ref, doc);
    saved.push({ id: ref.id, ...doc });
  }
  await batch.commit();
  return NextResponse.json(saved, { status: 201 });
});
