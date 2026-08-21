import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { classIdForScope, isClassScoped } from "@/lib/classFilter";
import { bangerFieldsForSave } from "@/lib/bangerRacing";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// The bridge: a completed Time Trial becomes a scheduled race's Qualifying.
//
//   POST { race_id, session_class?, grid: [{ entry_id, finish_pos, qual_time,
//                                            fastest_lap_time }] }
//
// The trial's order IS the grid — fastest lap on pole — and each driver's best
// lap is filed as their qualifying time. From the moment this writes, those are
// ordinary qualifying results: they score qualifying points, they set poles and
// Average Start, and their laps are eligible for the track record exactly like
// hand-entered ones. That is the whole intent of the action, and the only route
// by which a trial ever reaches the standard statistics — an admin has to ask
// for it, on a named event.
//
// ── Where the grid comes from ─────────────────────────────────────────────
//
// The browser builds it. Ordering the session, matching each driver to a roster
// entry and deciding which time is filed are all pure functions of the laps on
// screen (planQualifyingExport / matchEntry, lib/timeTrials.js), and the sheet
// has already run them to draw itself. This route used to run them again — and
// worse, ran them on every `dry_run` the confirmation dialog fired as the admin
// changed a dropdown, so previewing an export cost a serverless invocation per
// keystroke. The dialog previews from memory now and posts the finished grid.
//
// What is left here is not arithmetic: it is the check that the rows describe
// drivers who are actually on the target season's roster, and the write.
const handlePOST = withAdmin(async (request, { params }, user) => {
  const { race_id, session_class = null, grid } = await request.json();
  if (!race_id) return NextResponse.json({ error: "race_id required" }, { status: 400 });
  if (!Array.isArray(grid) || !grid.length) {
    return NextResponse.json({ error: "grid[] required" }, { status: 400 });
  }

  const trialDoc = await db().collection("time_trials").doc(params.id).get();
  if (!trialDoc.exists) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const raceDoc = await db().collection("races").doc(race_id).get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Race not found" }, { status: 404 });
  const race = { id: raceDoc.id, ...raceDoc.data() };
  if (!race.season_id) {
    return NextResponse.json({ error: "That race isn't attached to a season." }, { status: 400 });
  }

  const entriesSnap = await db().collection("entries").where("season_id", "==", race.season_id).get();
  const classByEntry = Object.fromEntries(entriesSnap.docs.map(d => [d.id, d.data().class_id || ""]));

  // A result is filed against a roster entry, so every row has to name one that
  // exists in THIS season — otherwise the export would write results nothing
  // can resolve a driver for. The client drops unmatched drivers before it gets
  // here; this is the guarantee, not the filter.
  const seen = new Set();
  for (const row of grid) {
    const entryId = String(row?.entry_id ?? "");
    if (!(entryId in classByEntry)) {
      return NextResponse.json({ error: "A driver on that grid isn't on the season's roster." }, { status: 400 });
    }
    if (seen.has(entryId)) {
      return NextResponse.json({ error: "The same driver appears twice on that grid." }, { status: 400 });
    }
    seen.add(entryId);
    if (!Number.isInteger(row.finish_pos) || row.finish_pos < 1) {
      return NextResponse.json({ error: "Every grid slot needs a position." }, { status: 400 });
    }
  }

  // Which class's qualifying this is, on an event whose sessions are split by
  // class. Absent (the ordinary case) the export replaces the whole session,
  // exactly as saving the grid by hand would.
  const scoped = isClassScoped(session_class);
  const scopeClassId = scoped ? classIdForScope(session_class) : "";
  const leagueId = getRequestLeagueId(request);

  const col = db().collection("results");
  const existing = await col.where("race_id", "==", race_id).get();
  const batch = db().batch();

  // Replace the event's qualifying (or one class's slice of it) — the same
  // "this session, entered again" rule /api/results follows, so exporting twice
  // corrects the grid instead of doubling it.
  existing.docs
    .filter(d => {
      const data = d.data();
      if ((data.session_type || "race") !== "qualifying") return false;
      if (!scoped) return true;
      const rowClass = data.class_id || classByEntry[data.entry_id] || "";
      return rowClass === scopeClassId;
    })
    .forEach(d => batch.delete(d.ref));

  const now = new Date().toISOString();
  let exported = 0;
  for (const row of grid) {
    const ref = col.doc();
    batch.set(ref, {
      race_id,
      season_id: race.season_id,
      ...(leagueId ? { league_id: leagueId } : {}),
      session: "Qualifying",
      session_type: "qualifying",
      entry_id: row.entry_id,
      class_id: scoped ? scopeClassId : (race.class_id || classByEntry[row.entry_id] || ""),
      finish_pos: row.finish_pos,
      start_pos: null,
      qual_time: row.qual_time || null,
      race_time: null,
      interval: null,
      laps: 0,
      laps_led: 0,
      incidents: 0,
      fastest_lap: false,
      // The lap itself, so the venue's record books see it as the lap it was.
      fastest_lap_time: row.fastest_lap_time || null,
      halfway_leader: false,
      hard_charger: false,
      most_laps_led: false,
      provisional: false,
      // Written on every result, zeros outside a derby series — the same shape
      // /api/results saves, so nothing downstream ever has to ask what kind of
      // document this is. See lib/bangerRacing.js.
      ...bangerFieldsForSave({}),
      bonus_points: 0,
      penalty_points: 0,
      points_adjustment: 0,
      manual_points: null,
      status: "finished",
      points_template_id: null,
      // Where this grid came from. Nothing reads it to change scoring — an
      // exported qualifying result is an ordinary one — but a session that was
      // imported rather than typed should say so.
      time_trial_id: params.id,
      created_at: now,
      created_by: user.uid,
    });
    exported += 1;
  }
  await batch.commit();

  return NextResponse.json({
    ok: true,
    race: { id: race.id, name: race.name },
    exported,
  }, { status: 201 });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
