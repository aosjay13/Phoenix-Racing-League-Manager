import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import {
  TRIAL_ENTRY_COLLECTION, fetchClassNamesForSeasons, fetchSeriesNames, fetchTrial,
  fetchTrialEntries, targetSeasonIds, trialEntryDoc,
} from "@/lib/timeTrialsServer";

export const dynamic = "force-dynamic";

// Bulk save of a session's sheet — every driver and every lap in one write, the
// same "replace what's there" shape /api/results uses, so an admin can correct
// a mistyped lap and re-save without hitting duplicates.
//
// Rows are matched to what's stored by document id where the row has one, so a
// re-save updates in place and each driver keeps their id (which is what lets
// the placement assignments below, and any link to this row, survive an edit).
// Rows with no id are new; stored rows the payload no longer mentions are
// deleted, which is how a driver is removed from the sheet.
export const POST = withAdmin(async (request, { params }) => {
  const { rows } = await request.json();
  if (!Array.isArray(rows)) return NextResponse.json({ error: "rows[] required" }, { status: 400 });

  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  // A row with no name and no identity can't be displayed or matched to a
  // driver, so it never reaches the database — that's the empty slot at the
  // bottom of the grid, not a submission.
  const named = rows.filter(r => String(r?.name ?? "").trim() || r?.driver_id);
  // Names for the two placement labels a row can carry. Classes are read across
  // EVERY season this trial can place into — its own and the one behind each
  // series — since a driver placed into the Pro Series is classified in that
  // series' season, not in the trial's.
  const [classNames, seriesNames] = await Promise.all([
    fetchClassNamesForSeasons(targetSeasonIds(trial)),
    fetchSeriesNames(trial.series_ids || []),
  ]);
  const leagueId = getRequestLeagueId(request);
  const existing = await fetchTrialEntries(params.id);
  const existingById = new Map(existing.map(e => [e.id, e]));

  const col = db().collection(TRIAL_ENTRY_COLLECTION);
  const batch = db().batch();
  const now = new Date().toISOString();
  const saved = [];
  const keptIds = new Set();

  named.forEach((row, position) => {
    const doc = trialEntryDoc(row, {
      trialId: params.id, maxLaps: trial.max_laps, classNames, seriesNames, leagueId, position,
    });
    const prior = row.id ? existingById.get(row.id) : null;
    const ref = prior ? col.doc(prior.id) : col.doc();
    const stamped = { ...doc, created_at: prior?.created_at || now, updated_at: now };
    batch.set(ref, stamped);
    keptIds.add(ref.id);
    saved.push({ id: ref.id, ...stamped });
  });

  for (const e of existing) if (!keptIds.has(e.id)) batch.delete(col.doc(e.id));
  await batch.commit();

  // The rows as stored. The sheet re-derives Best Time / Best Average from the
  // laps on every render anyway (summarizeEntries, lib/timeTrials.js), so
  // computing them here as well was work nobody read.
  return NextResponse.json(saved, { status: 201 });
});
