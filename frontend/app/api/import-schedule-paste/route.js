import { NextResponse } from "next/server";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { withStatsRefresh } from "@/lib/statsCache";
import { parsePastedSchedule } from "@/lib/pastedSchedule";
import { srhSchedulePlan } from "@/lib/srhSchedule";
import { planTrackImport } from "@/lib/trackMatch";
import {
  loadLeagueTracks, MAX_RACES, resolveTargetSeries, trackPreview, writeScheduleImport,
} from "@/lib/scheduleWrite";

export const dynamic = "force-dynamic";

// Import a season's schedule from a paste.
//
//   POST { text, preview: true }        → read it and say what importing it
//                                         WOULD create, writing nothing
//   POST { text, series_id, season_name?, track_decisions? }
//                                       → create the season, its races, and any
//                                         venue it races at that this league
//                                         doesn't have yet
//
// Why it exists: the SimRacerHub importer only helps iRacing leagues, because
// SimRacerHub scores nothing else. Every other game's league still keeps a
// schedule — it just lives in a spreadsheet — and was still building next
// season a round at a time, retyping dates and tracks that were already typed
// months ago. Selecting the sheet and pasting it is now the whole import.
//
// ANY GAME. That is the point of it, and the one way it deliberately differs
// from the SimRacerHub route next door: there is nothing about a pasted table
// that belongs to one game, so nothing here asks which game it is.
//
// It is thin on purpose. Reading the paste is lib/pastedSchedule.js, which
// hands back exactly what parseSrhSchedule does; planning the season is
// srhSchedulePlan, the same one; checking the venues and writing the tracks,
// the season and the races is lib/scheduleWrite.js, shared with that route. The
// review table an admin approves is the same table. A pasted schedule is not a
// different KIND of import — it is the same import read from somewhere else.

const handlePOST = withAdmin(async (request, ctx, user, role, leagueId) => {
  const body = await request.json().catch(() => ({}));
  const { text, preview = false, series_id, season_name } = body;

  if (!String(text ?? "").trim()) {
    return NextResponse.json({ error: "Paste a schedule to import." }, { status: 400 });
  }

  // The series this would go into, resolved before anything is read on a real
  // import so an admin who picked the wrong one is told first.
  let series = null;
  if (!preview) {
    const target = await resolveTargetSeries(series_id, leagueId);
    if (target.error) return NextResponse.json({ error: target.error }, { status: target.status });
    series = target.series;
  }

  // ── Read the paste ─────────────────────────────────────────────────────
  const parsed = parsePastedSchedule(text);
  if (!parsed?.rounds?.length) {
    return NextResponse.json({
      error: "That doesn't read as a schedule. It needs a header row naming its columns — a Race or Round number, a Date, a Track, and how far each round runs — with a row per round under it.",
    }, { status: 400 });
  }

  const plan = srhSchedulePlan(parsed, { seasonName: season_name || parsed.title });
  if (!plan.races.length) {
    return NextResponse.json({ error: "Every row in that paste is an off week — there are no races to import." }, { status: 400 });
  }
  if (plan.races.length > MAX_RACES) {
    return NextResponse.json({ error: `That paste lists ${plan.races.length} rounds, which is more than this can import at once.` }, { status: 400 });
  }

  // ── The venues ─────────────────────────────────────────────────────────
  //
  // Matched against the tracks this league already has, exactly as a
  // SimRacerHub schedule's are. There is no track directory behind a paste, so
  // the matching runs on names alone — which is what it falls back to there
  // anyway when the directory can't be read.
  const leagueTracks = await loadLeagueTracks(leagueId);
  const trackPlan = planTrackImport(plan.tracks, leagueTracks);

  if (preview) {
    return NextResponse.json({
      ok: true,
      preview: true,
      // What the paste was understood as, so a column read wrongly is visible
      // before a season is built on it rather than after.
      source: { title: parsed.title, headers: parsed.headers, mapping: parsed.mapping, delimiter: parsed.delimiter },
      // Rows that were NOT read as rounds, and why — a totals line, a spacer, a
      // note at the bottom. An importer that quietly dropped a line would be one
      // an admin could not check.
      skipped: parsed.skipped,
      season: plan.season,
      rows: plan.rows,
      off_weeks: plan.off_weeks,
      warnings: plan.warnings,
      cars: plan.cars,
      ...trackPreview(trackPlan, leagueTracks),
    });
  }

  // ── Write it ───────────────────────────────────────────────────────────
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
    ...written,
    off_weeks: plan.off_weeks,
    warnings: plan.warnings,
  });
});

// A successful write here changes what the cached league reads are built from,
// so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
