import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { summarizeEntries } from "@/lib/timeTrials";
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

  // Equality filters applied in memory: each is optional, and a trial that
  // names nothing at that level (a free-floating placement session) is only
  // dropped when the filter is actually asked for.
  for (const field of ["game_id", "series_id", "season_id", "status", "track_id"]) {
    const wanted = searchParams.get(field);
    if (wanted) trials = trials.filter(t => (t[field] || "") === wanted);
  }
  if (searchParams.get("is_placement") === "1") trials = trials.filter(t => !!t.is_placement);

  // How many drivers are on each sheet, so the hub can say so without opening
  // every session.
  const counts = await Promise.all(
    trials.map(t => db().collection(TRIAL_ENTRY_COLLECTION).where("time_trial_id", "==", t.id).get())
  );
  trials.forEach((t, i) => {
    const rows = counts[i].docs.map(d => d.data());
    const summarized = summarizeEntries(rows, { averageLaps: t.average_laps });
    t.driver_count = rows.length;
    t.lap_count = summarized.reduce((n, r) => n + r.laps_timed, 0);
  });

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
