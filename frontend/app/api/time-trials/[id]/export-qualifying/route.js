import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { classIdForScope, isClassScoped } from "@/lib/classFilter";
import { bangerFieldsForSave } from "@/lib/bangerRacing";
import { entryIndex, matchEntry, planQualifyingExport, summarizeEntries } from "@/lib/timeTrials";
import { fetchTrial, fetchTrialEntries } from "@/lib/timeTrialsServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// The bridge: a completed Time Trial becomes a scheduled race's Qualifying.
//
//   POST { race_id, sort_key?: "best" | "average", session_class?, dry_run? }
//
// The trial's order IS the grid — fastest lap on pole — and each driver's best
// lap is filed as their qualifying time. From the moment this writes, those are
// ordinary qualifying results: they score qualifying points, they set poles and
// Average Start, and their laps are eligible for the track record exactly like
// hand-entered ones. That is the whole intent of the action, and the only route
// by which a trial ever reaches the standard statistics — an admin has to ask
// for it, on a named event.
//
// `dry_run` reports what would be written (and, more usefully, WHO the target
// season's roster is missing) without touching anything, which is what the
// confirmation step shows.
const handlePOST = withAdmin(async (request, { params }, user) => {
  const { race_id, sort_key, session_class = null, dry_run = false } = await request.json();
  if (!race_id) return NextResponse.json({ error: "race_id required" }, { status: 400 });

  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const raceDoc = await db().collection("races").doc(race_id).get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Race not found" }, { status: 404 });
  const race = { id: raceDoc.id, ...raceDoc.data() };
  if (!race.season_id) {
    return NextResponse.json({ error: "That race isn't attached to a season." }, { status: 400 });
  }

  const [rows, entriesSnap] = await Promise.all([
    fetchTrialEntries(params.id),
    db().collection("entries").where("season_id", "==", race.season_id).get(),
  ]);
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const index = entryIndex(entries);
  const key = sort_key === "average" ? "average" : (trial.sort_key === "average" ? "average" : "best");
  const summarized = summarizeEntries(rows, { averageLaps: trial.average_laps });
  const { grid, unmatched } = planQualifyingExport(summarized, row => matchEntry(row, index)?.id || "", { key });

  if (dry_run) {
    return NextResponse.json({
      ok: true, dry_run: true, race: { id: race.id, name: race.name },
      exported: grid.length, unmatched, grid,
    });
  }
  if (!grid.length) {
    return NextResponse.json({
      error: unmatched.length
        ? "None of this session's drivers are on that race's season roster yet."
        : "Nobody in this session has set a lap time yet.",
      unmatched,
    }, { status: 400 });
  }

  // Which class's qualifying this is, on an event whose sessions are split by
  // class. Absent (the ordinary case) the export replaces the whole session,
  // exactly as saving the grid by hand would.
  const scoped = isClassScoped(session_class);
  const scopeClassId = scoped ? classIdForScope(session_class) : "";
  const classByEntry = Object.fromEntries(entries.map(e => [e.id, e.class_id || ""]));
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
  const saved = [];
  for (const row of grid) {
    const ref = col.doc();
    const doc = {
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
    };
    batch.set(ref, doc);
    saved.push({ id: ref.id, ...doc });
  }
  await batch.commit();

  return NextResponse.json({
    ok: true,
    race: { id: race.id, name: race.name },
    exported: saved.length,
    unmatched,
  }, { status: 201 });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
