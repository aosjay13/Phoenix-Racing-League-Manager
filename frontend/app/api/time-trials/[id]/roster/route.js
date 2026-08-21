import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { TRIAL_COLLECTION, TRIAL_STATUS_COMPLETED, fetchTrial, fetchTrialEntries } from "@/lib/timeTrialsServer";
import { clearPlacementQueue } from "@/lib/placementQueueServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// "Complete Session" → build the official roster(s).
//
// The point of a placement night is that it already answers the question a
// roster asks: who is racing, and in which division. This takes the drivers off
// the trial's sheet, with the division each was sorted into, and writes them
// straight onto the roster — the hours of manual entry that a placement session
// otherwise creates.
//
//   POST { complete, season_id?, series_seasons?, seasons: [
//            { season_id, create[], update[], placed_entry_ids[] } ] }
//
// A division is not always a class. A league whose divisions are separate
// SERIES places drivers into series instead, and each series builds the roster
// of the season behind it — so one run can write SEVERAL rosters, one per
// target season. `series_seasons` overrides the map stored on the trial for
// this run; `season_id` is where everyone not placed into a series goes. Both
// are recorded on the trial so re-opening the sheet routes the same way.
//
// ── Where the plan comes from ─────────────────────────────────────────────
//
// The browser builds it. Grouping the sheet by target season, matching each
// driver against that season's existing roster and deciding create / re-class /
// leave alone are pure functions of the sheet on screen and the rosters it is
// compared against (planRosterRun, lib/timeTrials.js). This route used to run
// them, and ran them AGAIN for every `dry_run` the confirmation modal fired as
// the admin changed the target season — a serverless invocation to answer a
// question the browser had the data for. The modal previews from memory now and
// posts the plan it showed, so "what this will do" and "what it did" cannot
// disagree.
//
// Re-running is safe by design: a driver already on a roster is UPDATED to the
// division the trial placed them in rather than duplicated, so an admin can
// re-sort the field and press the button again.
//
// ── What is still checked here ────────────────────────────────────────────
//
// Not arithmetic — the things a browser cannot be trusted to have got right:
// the target seasons still exist, every re-classed entry really belongs to the
// season it is being re-classed in, and each row carries only the fields a
// roster entry is allowed to carry. Anything else in the payload is dropped.

// The exact shape planRosterBuild produces, and the only fields that reach a
// document. A whitelist rather than a spread: this payload arrives over the
// wire now, and an entry must not be able to grow fields because a request
// asked it to.
function createDoc(row) {
  const name = String(row?.name ?? "").trim();
  if (!name) return null;
  const classId = String(row.class_id ?? "");
  const number = String(row.number ?? "").trim();
  return {
    name,
    ...(number ? { number } : {}),
    ...(row.driver_id ? { driver_id: String(row.driver_id) } : {}),
    ...(row.user_id ? { user_id: String(row.user_id) } : {}),
    class_id: classId,
    class_ids: Array.isArray(row.class_ids) ? row.class_ids.filter(Boolean).map(String) : (classId ? [classId] : []),
    team_id: "",
  };
}

const handlePOST = withAdmin(async (request, { params }, user) => {
  const { season_id, series_seasons, complete = true, seasons: planned } = await request.json();
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  if (!Array.isArray(planned) || !planned.length) {
    return NextResponse.json({ error: "seasons[] required" }, { status: 400 });
  }

  const trialSeasonId = String(season_id || trial.season_id || "").trim();
  const seasonBySeries = { ...(trial.series_seasons || {}), ...(series_seasons || {}) };

  const seasonIds = planned.map(p => String(p?.season_id ?? ""));
  if (seasonIds.some(id => !id) || new Set(seasonIds).size !== seasonIds.length) {
    return NextResponse.json({ error: "Every roster in the plan needs its own season." }, { status: 400 });
  }

  const seasonDocs = await Promise.all(seasonIds.map(id => db().collection("seasons").doc(id).get()));
  if (seasonDocs.some(d => !d.exists)) {
    return NextResponse.json({ error: "A season this session places into no longer exists." }, { status: 404 });
  }
  const seasonName = Object.fromEntries(seasonDocs.map(d => [d.id, d.data().name || ""]));

  // A re-class only ever touches an entry on the roster it belongs to. The plan
  // was built against these very entries; this is the guarantee, not the filter.
  const existingSnaps = await Promise.all(
    seasonIds.map(id => db().collection("entries").where("season_id", "==", id).get())
  );
  const entryIdsBySeason = Object.fromEntries(
    seasonIds.map((id, i) => [id, new Set(existingSnaps[i].docs.map(d => d.id))]),
  );

  const writes = [];
  for (const plan of planned) {
    const seasonId = String(plan.season_id);
    for (const row of Array.isArray(plan.create) ? plan.create : []) {
      const doc = createDoc(row);
      if (!doc) return NextResponse.json({ error: "A driver on that plan has no name." }, { status: 400 });
      writes.push({ kind: "create", seasonId, doc });
    }
    for (const row of Array.isArray(plan.update) ? plan.update : []) {
      const id = String(row?.id ?? "");
      if (!entryIdsBySeason[seasonId].has(id)) {
        return NextResponse.json({ error: "That plan re-classes a driver who isn't on the roster." }, { status: 400 });
      }
      const classId = String(row.class_id ?? "");
      writes.push({ kind: "update", id, data: {
        class_id: classId,
        class_ids: Array.isArray(row.class_ids) ? row.class_ids.filter(Boolean).map(String) : (classId ? [classId] : []),
        time_trial_id: params.id,
      } });
    }
  }

  const leagueId = getRequestLeagueId(request);
  const now = new Date().toISOString();
  const col = db().collection("entries");

  // Firestore batches cap at 500 writes; chunk so a placement night of any size
  // goes through in one action, across however many rosters it builds.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    for (const write of writes.slice(i, i + 400)) {
      if (write.kind === "create") {
        batch.set(col.doc(), {
          season_id: write.seasonId,
          ...(leagueId ? { league_id: leagueId } : {}),
          ...write.doc,
          // Where this roster spot came from, so a season's roster can be traced
          // back to the night that built it.
          time_trial_id: params.id,
          created_at: now,
          created_by: user.uid,
        });
      } else {
        batch.update(col.doc(write.id), write.data);
      }
    }
    await batch.commit();
  }

  // ── The Placements Queue is now answered ─────────────────────────────────
  //
  // These drivers were approved into a placement session and left on no roster
  // — that is what put them in the queue. The rosters above are the answer, so
  // the registrations stop waiting: they move to `approved`, stamped with the
  // session that earned it (see lib/placementQueueServer.js).
  //
  // Cleared against who ACTUALLY got a roster spot, not against who was on the
  // sheet: a driver left unplaced tonight is still owed a session, and dropping
  // them off the list would lose them exactly as the queue exists to prevent.
  // The plan names those rows by id; the rows themselves are read back from the
  // sheet here, so the message each driver gets is built from stored documents
  // rather than from anything the request said about them.
  //
  // Never allowed to fail the run. The entries are written and the drivers are
  // racing; a queue row that survives is a to-do an admin can clear by hand,
  // while a throw here would report a completed night as a failure.
  let placements = { cleared: [] };
  try {
    const sheet = Object.fromEntries((await fetchTrialEntries(params.id)).map(r => [r.id, r]));
    const placedRows = planned.flatMap(plan =>
      (Array.isArray(plan.placed_entry_ids) ? plan.placed_entry_ids : [])
        .map(id => sheet[String(id)])
        .filter(Boolean)
        .map(row => ({
          ...row,
          target_season_id: String(plan.season_id),
          target_season_name: seasonName[String(plan.season_id)],
        })));
    placements = await clearPlacementQueue({
      trial, trialId: params.id, placedRows, leagueId, admin: user,
    });
  } catch (err) {
    console.error("Clearing the placements queue failed after a roster build", err);
  }

  // Completing the session is what closes it for entry and makes it available
  // to the "Import from Time Trial" picker on a race's Qualifying tab.
  const patch = {};
  if (complete && trial.status !== TRIAL_STATUS_COMPLETED) {
    patch.status = TRIAL_STATUS_COMPLETED;
    patch.completed_at = now;
  }
  // A trial run before its season existed learns which season it fed.
  if (!trial.season_id && trialSeasonId) patch.season_id = trialSeasonId;
  // …and remembers any per-series season chosen for this run, so re-opening the
  // sheet routes the same way it was just completed.
  if (series_seasons && Object.keys(series_seasons).length) patch.series_seasons = seasonBySeries;
  if (Object.keys(patch).length) await db().collection(TRIAL_COLLECTION).doc(params.id).update(patch);

  return NextResponse.json({
    ok: true,
    seasons: planned.map(p => ({
      season_id: String(p.season_id),
      season_name: seasonName[String(p.season_id)],
      created: (p.create || []).length,
      updated: (p.update || []).length,
    })),
    created: writes.filter(w => w.kind === "create").length,
    updated: writes.filter(w => w.kind === "update").length,
    // Who has stopped waiting on a placement session, so the admin is told that
    // half happened too — it is a change to a screen they are not looking at.
    placements_cleared: placements.cleared.length,
    trial: { ...trial, ...patch },
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
