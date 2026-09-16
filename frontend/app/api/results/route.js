import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId } from "@/lib/serverAuth";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";
import { isClassScoped } from "@/lib/classFilter";
import { withStatsRefresh } from "@/lib/statsCache";
import {
  classByEntryForSeason, matchesSession, rowsError, sessionContext, sessionTypeOf, stageSessionWrite,
} from "@/lib/resultsWrite";

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

// Bulk save: replaces all results for the race session so admins can
// re-submit corrections without hitting duplicate errors. Events with
// multiple races (or, for heat-format events, multiple heats/consolations)
// store one `session` name per race. `points_template_id` (optional) pins
// the points system this session was scored under, so standings/stats stay
// correct even if the season's default or another session's template later
// changes — see lib/standings.js configForTemplate().
//
// What a row becomes, and which stored rows it replaces, is lib/resultsWrite.js
// — shared with the season-wide SimRacerHub importer so a night typed in by
// hand and a night imported in bulk store the same documents.
const handlePOST = withAdmin(async (request, ctx, user) => {
  const { race_id, season_id, session = "", session_type, session_class, points_template_id, rows } = await request.json();
  const sessionType = sessionTypeOf(session_type);
  if (!race_id || !season_id || !Array.isArray(rows)) {
    return NextResponse.json({ error: "race_id, season_id, rows[] required" }, { status: 400 });
  }
  const bad = rowsError(rows);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const { firstSession, raceClassId } = await sessionContext(race_id);
  const savingSession = session || firstSession;
  const leagueId = getRequestLeagueId(request);

  // Record the class each driver ran in on the result itself, so a class
  // championship stays historically correct even if the driver is later moved
  // to another class (or the roster entry is re-used).
  const entriesById = await classByEntryForSeason(season_id);

  const existing = await db().collection("results").where("race_id", "==", race_id).get();
  const batch = db().batch();
  const saved = stageSessionWrite({
    batch, existing: existing.docs, race_id, season_id, leagueId,
    session: savingSession, sessionType, session_class, points_template_id, rows,
    firstSession, raceClassId, entriesById, uid: user.uid,
  });
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
// to the event's first standard session / "race", mirroring POST. An optional
// &session_class=… narrows the wipe to one class's slice of that session, so
// clearing (say) the Pro race leaves the Amateur race that ran alongside it
// alone; omit it to clear the session for every class.
const handleDELETE = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const raceId = searchParams.get("race_id");
  const session = searchParams.get("session") || "";
  const sessionType = sessionTypeOf(searchParams.get("session_type"));
  // Absent param = the whole session; present (including the Unclassified
  // sentinel) = that one class.
  const sessionClass = searchParams.has("session_class") ? searchParams.get("session_class") : null;
  if (!raceId) return NextResponse.json({ error: "race_id required" }, { status: 400 });

  const { firstSession, seasonId: raceSeasonId } = await sessionContext(raceId);
  const target = session || firstSession;
  const entriesById = isClassScoped(sessionClass) ? await classByEntryForSeason(raceSeasonId) : {};
  const existing = await db().collection("results").where("race_id", "==", raceId).get();
  const doomed = existing.docs.filter(d => matchesSession(d.data(), sessionType, target, firstSession, sessionClass, entriesById));
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

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
export const DELETE = withStatsRefresh(handleDELETE);
