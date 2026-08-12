import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { planRosterBuild } from "@/lib/timeTrials";
import { TRIAL_COLLECTION, TRIAL_STATUS_COMPLETED, fetchTrial, fetchTrialEntries } from "@/lib/timeTrialsServer";

export const dynamic = "force-dynamic";

// "Complete Session" → build the official roster.
//
// The point of a placement night is that it already answers the question a
// roster asks: who is racing, and in which division. This takes the drivers off
// the trial's sheet, with the class each was sorted into, and writes them
// straight onto the season's roster — the hours of manual entry that a
// placement session otherwise creates.
//
//   POST { season_id, complete: true, dry_run: false }
//
// `dry_run` answers "what would this do?" without writing anything, which is
// what the confirmation modal shows before the admin commits. The plan itself
// (who is created, who is merely re-classed, who is left alone) lives in
// lib/timeTrials.js so the two answers can never differ.
//
// Re-running is safe by design: a driver already on the roster is UPDATED to
// the class the trial placed them in rather than duplicated, so an admin can
// re-sort the field and press the button again.
export const POST = withAdmin(async (request, { params }, user) => {
  const { season_id, complete = true, dry_run = false } = await request.json();
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const seasonId = String(season_id || trial.season_id || "").trim();
  if (!seasonId) {
    return NextResponse.json({ error: "Pick the season whose roster this should build." }, { status: 400 });
  }
  const seasonDoc = await db().collection("seasons").doc(seasonId).get();
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  const [rows, existingSnap] = await Promise.all([
    fetchTrialEntries(params.id),
    db().collection("entries").where("season_id", "==", seasonId).get(),
  ]);
  const existing = existingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // On a placement session an unplaced driver is left alone: there is no
  // division to put them in yet, and inventing one isn't ours to do. An
  // ordinary trial can still push its field onto the roster unclassified.
  const plan = planRosterBuild(rows, existing, { requireClass: !!trial.is_placement });

  if (dry_run) {
    return NextResponse.json({ ok: true, dry_run: true, season_id: seasonId, ...plan });
  }

  const leagueId = getRequestLeagueId(request);
  const now = new Date().toISOString();
  const col = db().collection("entries");

  // Firestore batches cap at 500 writes; chunk so a placement night of any size
  // goes through in one action.
  const writes = [
    ...plan.create.map(row => ({ kind: "create", row })),
    ...plan.update.map(row => ({ kind: "update", row })),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    for (const write of writes.slice(i, i + 400)) {
      if (write.kind === "create") {
        batch.set(col.doc(), {
          season_id: seasonId,
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

  // Completing the session is what closes it for entry and makes it available
  // to the "Import from Time Trial" picker on a race's Qualifying tab.
  const patch = {};
  if (complete && trial.status !== TRIAL_STATUS_COMPLETED) {
    patch.status = TRIAL_STATUS_COMPLETED;
    patch.completed_at = now;
  }
  // A trial run before its season existed learns which season it fed.
  if (!trial.season_id) patch.season_id = seasonId;
  if (Object.keys(patch).length) await db().collection(TRIAL_COLLECTION).doc(params.id).update(patch);

  return NextResponse.json({
    ok: true,
    season_id: seasonId,
    created: plan.create.length,
    updated: plan.update.length,
    skipped: plan.skipped,
    trial: { ...trial, ...patch },
  });
});
