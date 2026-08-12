import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { summarizeEntries } from "@/lib/timeTrials";
import {
  TRIAL_COLLECTION, TRIAL_ENTRY_COLLECTION,
  fetchTrial, fetchTrialEntries, trialFields,
} from "@/lib/timeTrialsServer";

export const dynamic = "force-dynamic";

// One Time Trial session, with its drivers, their laps, and the derived Best
// Time / Best Average columns already worked out.
//
// The derived columns are computed HERE as well as in the browser on purpose:
// the same lib does both, so an export, a record and the on-screen table can
// never disagree about which lap was a driver's fastest.
export async function GET(request, { params }) {
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const [entries, season, classes] = await Promise.all([
    fetchTrialEntries(params.id),
    trial.season_id
      ? db().collection("seasons").doc(trial.season_id).get().then(d => (d.exists ? { id: d.id, ...d.data() } : null))
      : null,
    trial.season_id
      ? db().collection("classes").where("season_id", "==", trial.season_id).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
            String(a.name || "").localeCompare(String(b.name || ""))))
      : [],
  ]);

  return NextResponse.json({
    trial,
    season,
    classes,
    entries: summarizeEntries(entries, { averageLaps: trial.average_laps }),
  });
}

export const PATCH = withAdmin(async (request, { params }) => {
  const body = await request.json();
  const ref = db().collection(TRIAL_COLLECTION).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  // Every field is coerced against the MERGED session (so the averaging window
  // is resolved against whatever lap cap this write leaves behind), but only
  // the fields the request actually names are written — a screen that knows
  // about one setting can never blank the others.
  const coerced = trialFields({ ...doc.data(), ...body });
  const updates = {};
  for (const key of Object.keys(coerced)) {
    if (body[key] !== undefined) updates[key] = coerced[key];
  }
  // The window and the cap are two halves of one rule: changing the cap can
  // shorten the window, so it re-resolves whenever either is sent.
  if (body.average_laps !== undefined || body.max_laps !== undefined) {
    updates.average_laps = coerced.average_laps;
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  if (updates.name !== undefined && !updates.name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  await ref.update(updates);
  return NextResponse.json({ id: params.id, ...doc.data(), ...updates });
});

// Deleting a session takes its drivers' laps with it — an entry with no session
// is unreachable, and would otherwise sit in the records data forever.
export const DELETE = withAdmin(async (request, { params }) => {
  const entries = await db().collection(TRIAL_ENTRY_COLLECTION).where("time_trial_id", "==", params.id).get();
  const batch = db().batch();
  entries.docs.forEach(d => batch.delete(d.ref));
  batch.delete(db().collection(TRIAL_COLLECTION).doc(params.id));
  await batch.commit();
  return NextResponse.json({ ok: true, deleted_entries: entries.size });
});
