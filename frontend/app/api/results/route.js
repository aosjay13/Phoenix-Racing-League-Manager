import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";

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

// Session-list metadata used to resolve which stored docs belong to the
// session being written: legacy docs may lack the session field, in which
// case they're treated as the event's first standard session.
async function sessionContext(raceId) {
  const raceDoc = await db().collection("races").doc(raceId).get();
  const sessions = raceDoc.exists && Array.isArray(raceDoc.data().sessions) && raceDoc.data().sessions.length
    ? raceDoc.data().sessions
    : ["Race"];
  return { firstSession: sessions[0] };
}

// Docs that count as "this session". Qualifying is isolated by type, but all
// race-like types (race/heat/consolation/feature) match each other by session
// name: the event page merges them by name, so a leftover set saved under
// another type (e.g. before the event was switched to heat format) would
// render as duplicate finishing positions.
function matchesSession(data, sessionType, savingSession, firstSession) {
  const docType = data.session_type || "race";
  const docSession = data.session || firstSession;
  if (docSession !== savingSession) return false;
  return sessionType === "qualifying" ? docType === "qualifying" : docType !== "qualifying";
}

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

  const { firstSession } = await sessionContext(race_id);
  const savingSession = session || firstSession;

  const col = db().collection("results");
  const existing = await col.where("race_id", "==", race_id).get();
  const batch = db().batch();
  // Replace this session's existing rows. SR is recomputed from scratch below
  // (a full chronological replay of the game), so no per-session reversal is
  // needed — corrections and re-saves are handled by the recalc.
  existing.docs
    .filter(d => matchesSession(d.data(), sessionType, savingSession, firstSession))
    .forEach(d => batch.delete(d.ref));

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
      start_pos: row.start_pos === "" || row.start_pos == null ? null : Number(row.start_pos),
      qual_time: row.qual_time || null,
      race_time: row.race_time || null,
      interval: row.interval || null,
      laps: Number(row.laps || 0),
      laps_led: Number(row.laps_led || 0),
      incidents: Number(row.incidents || 0),
      fastest_lap: !!row.fastest_lap,
      // Driver's best single lap time for this session, as a clock string
      // ("1:23.456"). Independent of the `fastest_lap` flag (which just marks
      // who set the session's quickest lap): the fastest of these across every
      // race at a venue is that track's lap record. See lib/trackStatsServer.js.
      fastest_lap_time: row.fastest_lap_time || null,
      halfway_leader: !!row.halfway_leader,
      hard_charger: !!row.hard_charger,
      provisional: !!row.provisional,
      bonus_points: Number(row.bonus_points || 0),
      penalty_points: Number(row.penalty_points || 0),
      // Signed per-result adjustment (penalties/corrections), applied on top of
      // scored points without changing the finishing position. Negative docks.
      points_adjustment: Number(row.points_adjustment || 0),
      // Flat, admin-entered points for a provisional entry (a driver who didn't
      // make the race). Overrides position-based scoring; null for normal rows.
      manual_points: row.manual_points === "" || row.manual_points == null ? null : Number(row.manual_points),
      status: row.status || "finished",
      points_template_id: points_template_id || null,
      created_at: now,
      created_by: user.uid,
    };
    batch.set(ref, doc);
    saved.push({ id: ref.id, ...doc });
  }
  await batch.commit();

  // Recompute this game's Skill Ratings from scratch, chronologically. This
  // rebuilds the whole timeline from the 1500 baseline, so a race entered/edited
  // out of order slots into its correct date position and ripples through every
  // later race — updating current SR, each result's sr_delta, and every race's
  // Strength of Field. SR is a derived stat, so a failure here never fails the
  // save; the next recalc corrects it.
  try {
    await recalcGameSkillRatings(await gameIdForSeason(season_id));
  } catch (err) {
    console.error("Skill Rating recalc failed", err);
  }

  return NextResponse.json(saved, { status: 201 });
});

// Clears the saved results for one session of a race, leaving the rest of the
// event untouched. ?race_id=…&session=…&session_type=… — session/type default
// to the event's first standard session / "race", mirroring POST.
export const DELETE = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const raceId = searchParams.get("race_id");
  const session = searchParams.get("session") || "";
  const typeParam = searchParams.get("session_type");
  const sessionType = SESSION_TYPES.includes(typeParam) ? typeParam : "race";
  if (!raceId) return NextResponse.json({ error: "race_id required" }, { status: 400 });

  const { firstSession } = await sessionContext(raceId);
  const target = session || firstSession;
  const existing = await db().collection("results").where("race_id", "==", raceId).get();
  const doomed = existing.docs.filter(d => matchesSession(d.data(), sessionType, target, firstSession));
  // Grab a season_id off the deleted set (all share the race → one season) to
  // resolve the game whose SR timeline must be recomputed.
  const seasonId = doomed.length ? doomed[0].data().season_id : null;
  const batch = db().batch();
  doomed.forEach(d => batch.delete(d.ref));
  await batch.commit();

  // Recompute the game's SR chronologically now that these results are gone, so
  // ratings/deltas/SoF for every remaining race stay sound (and any driver who
  // no longer has an SR race resets to baseline).
  try {
    await recalcGameSkillRatings(await gameIdForSeason(seasonId));
  } catch (err) {
    console.error("Skill Rating recalc failed", err);
  }

  return NextResponse.json({ ok: true, deleted: doomed.length });
});
