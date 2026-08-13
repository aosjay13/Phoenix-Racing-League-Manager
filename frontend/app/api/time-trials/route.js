import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { summarizeEntries, trialMatchesScope } from "@/lib/timeTrials";
import { TRIAL_COLLECTION, TRIAL_ENTRY_COLLECTION, TRIAL_STATUS_OPEN, trialFields } from "@/lib/timeTrialsServer";

export const dynamic = "force-dynamic";

// Standalone Time Trial sessions — the hub's list.
//
// Reads are public (a league's hot-lap sheets are as public as its results);
// creating one is an admin action. Filters are all optional and narrow by the
// scope the viewer is in: ?game_id=&series_id=&season_id=&status=.
//
// A trial deliberately does NOT require a season. A placement night usually
// happens BEFORE the season it feeds exists, so the session can stand on its
// own and be attached to a season later — which is exactly when the roster
// generation becomes available.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const leagueId = getRequestLeagueId(request);
  const snap = await scopeByLeague(db().collection(TRIAL_COLLECTION), leagueId).get();
  let trials = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Scope filter. A trial that names nothing at a level is in scope there — a
  // placement night usually predates the season it feeds — and a night placing
  // into several series belongs to every one of them. See trialMatchesScope.
  const scope = {
    gameId: searchParams.get("game_id") || "",
    seriesId: searchParams.get("series_id") || "",
    seasonId: searchParams.get("season_id") || "",
  };
  if (scope.gameId || scope.seriesId || scope.seasonId) {
    trials = trials.filter(t => trialMatchesScope(t, scope));
  }
  // Exact filters, where "unset" is not a wildcard: a trial is at one venue and
  // in one state.
  const wantedStatus = searchParams.get("status");
  if (wantedStatus) trials = trials.filter(t => (t.status || TRIAL_STATUS_OPEN) === wantedStatus);
  const wantedTrack = searchParams.get("track_id");
  if (wantedTrack) trials = trials.filter(t => (t.track_id || "") === wantedTrack);
  if (searchParams.get("is_placement") === "1") trials = trials.filter(t => !!t.is_placement);

  // How many drivers are on each sheet, so the hub can say so without opening
  // every session. One read for the whole league's laps, grouped in memory —
  // a query per trial turned opening the hub into N+1 round trips.
  const entriesSnap = await scopeByLeague(db().collection(TRIAL_ENTRY_COLLECTION), leagueId).get();
  const rowsByTrial = new Map();
  for (const doc of entriesSnap.docs) {
    const row = doc.data();
    if (!rowsByTrial.has(row.time_trial_id)) rowsByTrial.set(row.time_trial_id, []);
    rowsByTrial.get(row.time_trial_id).push(row);
  }
  for (const t of trials) {
    const rows = rowsByTrial.get(t.id) || [];
    const summarized = summarizeEntries(rows, { averageLaps: t.average_laps });
    t.driver_count = rows.length;
    t.lap_count = summarized.reduce((n, r) => n + r.laps_timed, 0);
  }

  // Newest first — a hub is a place you come back to, and the session you ran
  // last night is the one you want. Dates are bare calendar strings, so they
  // compare as text; a trial with no date falls back to when it was created.
  trials.sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.created_at || "").localeCompare(String(a.created_at || "")));

  return NextResponse.json(trials);
}

export const POST = withAdmin(async (request, ctx, user) => {
  const body = await request.json();
  const fields = trialFields(body);
  if (!fields.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const leagueId = getRequestLeagueId(request);
  const doc = {
    ...fields,
    status: TRIAL_STATUS_OPEN,
    ...(leagueId ? { league_id: leagueId } : {}),
    created_at: new Date().toISOString(),
    created_by: user.uid,
  };
  const ref = await db().collection(TRIAL_COLLECTION).add(doc);
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});
