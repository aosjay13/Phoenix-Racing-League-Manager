import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { groupByTargetSeason, planRosterBuild } from "@/lib/timeTrials";
import { TRIAL_COLLECTION, TRIAL_STATUS_COMPLETED, fetchTrial, fetchTrialEntries } from "@/lib/timeTrialsServer";
import { clearPlacementQueue } from "@/lib/placementQueueServer";
import { withStatsRefresh } from "@/lib/statsRefresh";

export const dynamic = "force-dynamic";

// "Complete Session" → build the official roster(s).
//
// The point of a placement night is that it already answers the question a
// roster asks: who is racing, and in which division. This takes the drivers off
// the trial's sheet, with the division each was sorted into, and writes them
// straight onto the roster — the hours of manual entry that a placement session
// otherwise creates.
//
//   POST { season_id, series_seasons?, complete: true, dry_run: false }
//
// A division is not always a class. A league whose divisions are separate
// SERIES places drivers into series instead, and each series builds the roster
// of the season behind it — so one run can write SEVERAL rosters, one per
// target season. `series_seasons` overrides the map stored on the trial for
// this run; `season_id` is where everyone not placed into a series goes.
//
// `dry_run` answers "what would this do?" without writing anything, which is
// what the confirmation modal shows before the admin commits. The plan itself
// (who is created, who is merely re-classed, who is left alone) lives in
// lib/timeTrials.js so the two answers can never differ.
//
// Re-running is safe by design: a driver already on a roster is UPDATED to the
// division the trial placed them in rather than duplicated, so an admin can
// re-sort the field and press the button again.
const handlePOST = withAdmin(async (request, { params }, user) => {
  const { season_id, series_seasons, complete = true, dry_run = false } = await request.json();
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  // Where each kind of row lands. The trial's own season takes everyone not
  // placed into a series; each series takes its own season.
  const trialSeasonId = String(season_id || trial.season_id || "").trim();
  const seasonBySeries = { ...(trial.series_seasons || {}), ...(series_seasons || {}) };
  const rows = await fetchTrialEntries(params.id);
  const groups = groupByTargetSeason(rows, { trialSeasonId, seasonBySeries });

  // Rows with nowhere to go: a driver placed into a series that names no
  // season, on a trial with no season of its own. They're reported, never
  // written — inventing a roster for them isn't ours to do.
  const homeless = groups.get("") || [];
  groups.delete("");
  if (!groups.size) {
    return NextResponse.json({
      error: trialSeasonId
        ? "Nobody on this sheet has a roster to go to yet."
        : "Pick the season whose roster this should build.",
    }, { status: 400 });
  }

  const seasonIds = [...groups.keys()];
  const seasonDocs = await Promise.all(seasonIds.map(id => db().collection("seasons").doc(id).get()));
  const missing = seasonIds.filter((id, i) => !seasonDocs[i].exists);
  if (missing.length) {
    return NextResponse.json({ error: "A season this session places into no longer exists." }, { status: 404 });
  }
  const seasonName = Object.fromEntries(seasonDocs.map(d => [d.id, d.data().name || ""]));

  // One roster per target season, each planned against that season's own
  // existing entries — a driver already in the Pro Series' roster is matched
  // there, not against some other season's.
  const existingSnaps = await Promise.all(
    seasonIds.map(id => db().collection("entries").where("season_id", "==", id).get())
  );
  // On a class placement night an unplaced driver is left alone: there is no
  // division to put them in yet, and inventing one isn't ours to do. A driver
  // sorted into a SERIES has been placed either way — the series is their
  // division — so they join that series' roster whether or not they also drew a
  // class inside it. An ordinary trial pushes its field on unclassified.
  const placesIntoClasses = !!trial.is_placement && (trial.class_ids || []).length > 0;
  const requireClass = row => placesIntoClasses && !row.assigned_series_id;
  const plans = seasonIds.map((seasonId, i) => ({
    season_id: seasonId,
    season_name: seasonName[seasonId],
    ...planRosterBuild(groups.get(seasonId), existingSnaps[i].docs.map(d => ({ id: d.id, ...d.data() })), { requireClass }),
  }));

  const totals = {
    created: plans.reduce((n, p) => n + p.create.length, 0),
    updated: plans.reduce((n, p) => n + p.update.length, 0),
    skipped: [
      ...plans.flatMap(p => p.skipped),
      ...homeless.map(r => ({ name: r.name || "", reason: "no season to place them in" })),
    ],
  };

  if (dry_run) {
    return NextResponse.json({ ok: true, dry_run: true, seasons: plans, ...totals });
  }

  const leagueId = getRequestLeagueId(request);
  const now = new Date().toISOString();
  const col = db().collection("entries");

  // Firestore batches cap at 500 writes; chunk so a placement night of any size
  // goes through in one action, across however many rosters it builds.
  const writes = plans.flatMap(plan => [
    ...plan.create.map(row => ({ kind: "create", seasonId: plan.season_id, row })),
    ...plan.update.map(row => ({ kind: "update", row })),
  ]);
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    for (const write of writes.slice(i, i + 400)) {
      if (write.kind === "create") {
        batch.set(col.doc(), {
          season_id: write.seasonId,
          ...(leagueId ? { league_id: leagueId } : {}),
          ...write.row,
          // Where this roster spot came from, so a season's roster can be traced
          // back to the night that built it.
          time_trial_id: params.id,
          created_at: now,
          created_by: user.uid,
        });
      } else {
        batch.update(col.doc(write.row.id), {
          class_id: write.row.class_id,
          class_ids: write.row.class_ids,
          time_trial_id: params.id,
        });
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
  //
  // Never allowed to fail the run. The entries are written and the drivers are
  // racing; a queue row that survives is a to-do an admin can clear by hand,
  // while a throw here would report a completed night as a failure.
  let placements = { cleared: [] };
  try {
    placements = await clearPlacementQueue({
      trial,
      trialId: params.id,
      placedRows: plans.flatMap(plan => plan.placed.map(row => ({
        ...row,
        target_season_id: plan.season_id,
        target_season_name: plan.season_name,
      }))),
      leagueId,
      admin: user,
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
    seasons: plans.map(p => ({
      season_id: p.season_id, season_name: p.season_name,
      created: p.create.length, updated: p.update.length,
    })),
    ...totals,
    // Who has stopped waiting on a placement session, so the admin is told that
    // half happened too — it is a change to a screen they are not looking at.
    placements_cleared: placements.cleared.length,
    trial: { ...trial, ...patch },
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
