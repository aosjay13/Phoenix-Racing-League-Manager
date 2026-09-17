import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { withStatsRefresh } from "@/lib/statsCache";
import { isIracingGame } from "@/lib/signupRequest";
import { srhCarName, srhFetchText, srhTrackDirectoryHtml } from "@/lib/srhFetch";
import {
  parseSrhSchedule, parseSrhSeasonRef, parseSrhTrackDirectory, srhSchedulePlan, srhTrackInfo,
} from "@/lib/srhSchedule";
import { planTrackImport } from "@/lib/trackMatch";
import {
  loadLeagueTracks, MAX_RACES, resolveTargetSeries, trackPreview, writeScheduleImport,
} from "@/lib/scheduleWrite";

export const dynamic = "force-dynamic";

// Import a whole season's schedule from SimRacerHub.
//
//   POST { url, preview: true }        → read that season's schedule and say
//                                        what importing it WOULD create,
//                                        writing nothing
//   POST { url, series_id, season_name?, track_decisions? }
//                                      → create the season, its races, and any
//                                        track it races at that this league
//                                        doesn't have yet
//
// Why it exists: an iRacing league builds next season on SimRacerHub because
// that is where its scoring lives, and then builds it again here, round by
// round, with the same tracks, dates and distances typed twice. One URL now
// does the second half.
//
// iRacing ONLY, and checked here rather than only in the button that opens it:
// SimRacerHub scores iRacing leagues and nothing else, so a schedule from it
// belongs to an iRacing game. A series under any other game is refused.
//
// Nothing is guessed at quietly. The preview names every round it read, every
// track it would create, and every figure it couldn't make sense of, because
// this writes a season's worth of rows in one press and an admin should see
// what they are about to get. The parsing itself is in lib/srhSchedule.js,
// where it can be tested without a database.
//
// VENUES get the same treatment drivers get in the results importer, and for
// the same reason: an importer that doesn't check fills the Tracks library with
// duplicates. Every layout a schedule races at is matched against the tracks
// this league already has — through every name each of them answers to — and
// `track_decisions` is the admin's answer for the ones that need one, keyed by
// the name SimRacerHub used:
//
//   { "Charlotte Motor Speedway Roval 2025": { action: "use", track_id } }
//   { "Lime Rock Park Grand Prix": { action: "create", name: "Lime Rock",
//                                    track_type: "Road Course" } }
//
// A track the admin points an import at RECORDS the name the source used (in
// `merged_names`, which the track profile prints as "Also raced as"), so a
// venue named whatever the league calls it is an exact match next season and
// there is nothing to review. That is what stops SimRacerHub's naming becoming
// this app's naming. See lib/trackMatch.js.

// Cars are named on their own page, one request each, so a season racing a
// handful of them looks them up and a season somehow listing dozens doesn't.
const MAX_CAR_LOOKUPS = 8;

const handlePOST = withAdmin(async (request, ctx, user, role, leagueId) => {
  const body = await request.json().catch(() => ({}));
  const { url: input, preview = false, series_id, season_name } = body;

  // parseSrhSeasonRef is the guard on where this route will make a request to:
  // it yields simracerhub.com URLs or nothing at all.
  const ref = parseSrhSeasonRef(input);
  if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });

  // ── The season this would go into ──────────────────────────────────────
  //
  // Resolved before the fetch on a real import, so an admin who picked the
  // wrong series is told before anything is read, and so the iRacing rule is
  // enforced by the server rather than by the button.
  let series = null;
  if (!preview) {
    const target = await resolveTargetSeries(series_id, leagueId);
    if (target.error) return NextResponse.json({ error: target.error }, { status: target.status });
    series = target.series;
    if (!isIracingGame(target.game?.name)) {
      return NextResponse.json(
        { error: "SimRacerHub scores iRacing leagues, so a schedule can only be imported into a series under an iRacing game." },
        { status: 400 },
      );
    }
  }

  // ── Read the schedule ──────────────────────────────────────────────────
  let html;
  try {
    html = await srhFetchText(ref.url);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  const parsed = parseSrhSchedule(html);
  if (!parsed?.rounds?.length) {
    return NextResponse.json(
      { error: "That SimRacerHub season has no schedule on it yet — check the season id, and that its rounds have been added." },
      { status: 404 },
    );
  }

  // Cars are drawn as pictures on most leagues' schedules, so the name behind
  // each one is looked up — once per car, not once per round. A lookup that
  // fails is simply a car this import doesn't set.
  const carIds = [...new Set(parsed.rounds.flatMap(r => r.car_ids))].slice(0, MAX_CAR_LOOKUPS);
  const needsNames = parsed.rounds.every(r => !r.car_names.length);
  // One at a time: a season races one car, so this is usually a single request,
  // and firing a handful at SimRacerHub at once is how you get throttled into
  // half-sent pages.
  const carNames = {};
  if (needsNames) {
    for (const id of carIds) {
      const name = await srhCarName(id);
      if (name) carNames[id] = name;
    }
  }

  const plan = srhSchedulePlan(parsed, { carNames, seasonName: season_name });
  if (!plan.races.length) {
    return NextResponse.json({ error: "Every row on that schedule is an off week — there are no races to import." }, { status: 404 });
  }
  if (plan.races.length > MAX_RACES) {
    return NextResponse.json({ error: `That schedule lists ${plan.races.length} rounds, which is more than this can import at once.` }, { status: 400 });
  }

  // ── The venues ─────────────────────────────────────────────────────────
  //
  // SimRacerHub's own track directory turns each round's layout name into the
  // venue behind it ("Lime Rock Park Grand Prix" → Lime Rock Park) and carries
  // iRacing's logo for it, so a venue created here arrives looking like the
  // place rather than like a blank row. One request, and the import survives
  // without it — the matching runs on names either way.
  const directoryHtml = await srhTrackDirectoryHtml();
  const directory = directoryHtml ? parseSrhTrackDirectory(directoryHtml) : [];
  const trackInfo = srhTrackInfo(plan.tracks, directory);
  const baseNames = directory.map(t => t.name);

  const leagueTracks = await loadLeagueTracks(leagueId);
  const trackPlan = planTrackImport(plan.tracks, leagueTracks, { info: trackInfo, baseNames });

  if (preview) {
    return NextResponse.json({
      ok: true,
      preview: true,
      source_url: ref.url,
      season_id: ref.season_id,
      source: plan.source,
      season: plan.season,
      rows: plan.rows,
      off_weeks: plan.off_weeks,
      warnings: plan.warnings,
      cars: plan.cars,
      ...trackPreview(trackPlan, leagueTracks),
    });
  }

  // ── Write it ───────────────────────────────────────────────────────────
  //
  // The venues, the season and its races, written by the module the pasted
  // schedule importer writes through too — see lib/scheduleWrite.js.
  const written = await writeScheduleImport({
    plan, trackPlan, trackDecisions: body.track_decisions, seriesId: series_id,
    gameId: series.game_id, leagueTracks, user, role, leagueId,
  });
  if (written.error) {
    return NextResponse.json(
      { error: written.error, ...(written.track_errors ? { track_errors: written.track_errors } : {}) },
      { status: written.status },
    );
  }

  return NextResponse.json({
    ok: true,
    source_url: ref.url,
    ...written,
    off_weeks: plan.off_weeks,
    warnings: plan.warnings,
  });
});

// A successful write here changes what the cached league reads are built from,
// so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
