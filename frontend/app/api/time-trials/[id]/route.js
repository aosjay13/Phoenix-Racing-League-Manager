import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { summarizeEntries } from "@/lib/timeTrials";
import {
  TRIAL_COLLECTION, TRIAL_ENTRY_COLLECTION,
  fetchTrial, fetchTrialEntries, trialFields,
} from "@/lib/timeTrialsServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// A season's classes in the order the Class menu shows them everywhere else.
async function seasonClasses(seasonId) {
  if (!seasonId) return [];
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) ||
      String(a.name || "").localeCompare(String(b.name || "")));
}

// One Time Trial session, with its drivers, their laps, and the derived Best
// Time / Best Average columns already worked out.
//
// The derived columns are computed HERE as well as in the browser on purpose:
// the same lib does both, so an export, a record and the on-screen table can
// never disagree about which lap was a driver's fastest.
export async function GET(request, { params }) {
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const seriesIds = trial.series_ids || [];
  const seriesSeasons = trial.series_seasons || {};

  const [entries, season, classes, seriesDocs, seasonDocs, seriesClasses] = await Promise.all([
    fetchTrialEntries(params.id),
    trial.season_id
      ? db().collection("seasons").doc(trial.season_id).get().then(d => (d.exists ? { id: d.id, ...d.data() } : null))
      : null,
    seasonClasses(trial.season_id),
    Promise.all(seriesIds.map(id => db().collection("series").doc(id).get())),
    Promise.all(seriesIds.map(id => (seriesSeasons[id]
      ? db().collection("seasons").doc(seriesSeasons[id]).get()
      : Promise.resolve(null)))),
    // Each series places into ONE season, and a class belongs to a season — so
    // the divisions a series offers are that season's, not the trial's. Loaded
    // per series so the sheet can only ever offer a class the roster it is
    // about to write actually has.
    Promise.all(seriesIds.map(id => seasonClasses(seriesSeasons[id]))),
  ]);

  // What this night can sort drivers into, resolved once here so the sheet, the
  // completion workflow and the roster run all read the same targets.
  const placement_series = seriesIds.map((id, i) => {
    const seriesDoc = seriesDocs[i];
    const seasonDoc = seasonDocs[i];
    return {
      series_id: id,
      series_name: seriesDoc?.exists ? (seriesDoc.data().name || "Series") : "Series",
      season_id: seasonDoc?.exists ? seasonDoc.id : "",
      season_name: seasonDoc?.exists ? (seasonDoc.data().name || "") : "",
      classes: seriesClasses[i],
    };
  });

  return NextResponse.json({
    trial,
    season,
    classes,
    placement_series,
    entries: summarizeEntries(entries, { averageLaps: trial.average_laps }),
  });
}

const handlePATCH = withAdmin(async (request, { params }) => {
  const body = await request.json();
  const ref = db().collection(TRIAL_COLLECTION).doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  // Every field is coerced against the MERGED session (so the averaging window
  // is resolved against whatever lap cap this write leaves behind, and the
  // series → season map against whatever series list it leaves behind), but
  // only the fields the request actually names are written — a screen that
  // knows about one setting can never blank the others.
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
  // Likewise the series list and its season map: unticking a series has to drop
  // the season it was routing rosters to.
  if (body.series_ids !== undefined || body.series_seasons !== undefined) {
    updates.series_seasons = coerced.series_seasons;
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
const handleDELETE = withAdmin(async (request, { params }) => {
  const entries = await db().collection(TRIAL_ENTRY_COLLECTION).where("time_trial_id", "==", params.id).get();
  const batch = db().batch();
  entries.docs.forEach(d => batch.delete(d.ref));
  batch.delete(db().collection(TRIAL_COLLECTION).doc(params.id));
  await batch.commit();
  return NextResponse.json({ ok: true, deleted_entries: entries.size });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const PATCH = withStatsRefresh(handlePATCH);
export const DELETE = withStatsRefresh(handleDELETE);
