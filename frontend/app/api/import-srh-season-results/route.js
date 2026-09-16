import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { withStatsRefresh } from "@/lib/statsCache";
import { isIracingGame } from "@/lib/signupRequest";
import { recalcGameSkillRatings } from "@/lib/skillRatingServer";
import { srhFetchText } from "@/lib/srhFetch";
import { hasSrhSessionStats, parseSrhPage, parseSrhRef, srhPageError, srhSegmentTable } from "@/lib/srhImport";
import { planRace } from "@/lib/srhSeasonResults";
import { classByEntryForSeason, sessionContext, stageSessionWrite } from "@/lib/resultsWrite";
import { racePerClassResults } from "@/lib/classFilter";
import { aliasValues } from "@/lib/aliases";
import { displayNameValues, gameNameFor } from "@/lib/driverNames";

export const dynamic = "force-dynamic";

// Import ONE round of a season's results from SimRacerHub — every session on
// the page, in one request.
//
//   POST { season_id, race_id, url, preview: true }
//        → read that round and say what importing it WOULD write
//   POST { season_id, race_id, url }
//        → write it: qualifying, every heat, the consolation and the feature
//
// Why one round per request, when the feature is "import the whole season":
// the season is the admin's press, not the server's request. Twelve rounds is
// twelve SimRacerHub pages, and a single request that fetched all of them would
// be one timeout away from a half-imported season with nothing to say about
// which half. The dialog loops over the rounds instead, so every round reports
// for itself, a failure names the round it happened on, and the rest still go
// in. See components/SrhSeasonResultsModal.jsx.
//
// What it does NOT do is decide anything the results grid decides. Which
// session a SimRacerHub session belongs in, which roster place each driver is,
// and what a row becomes are all lib/srhSeasonResults.js, which is pure and
// tested; the documents it writes are built by lib/resultsWrite.js, the same
// module the grid's own Save writes through. A season imported in bulk and a
// season typed in by hand store the same rows and score identically — which is
// the whole reason this is worth having.
//
// iRacing ONLY, checked here rather than only in the button that opens it:
// SimRacerHub scores iRacing leagues and nothing else.

// `recalc: false` lets the dialog import round after round and pay for the
// Skill Rating replay once, on the last of them. SR is derived — it is rebuilt
// from scratch chronologically every time — so a run of rounds that skipped it
// is corrected by the next save whatever happens.
async function recalcFor(gameId) {
  try {
    await recalcGameSkillRatings(gameId);
  } catch (err) {
    console.error("Skill Rating recalc failed", err);
  }
}

// The season roster, under every name each driver answers to: their profile
// name, the name they race under in THIS game, and each connected account
// (Discord, PSN, Xbox, Steam, iRacing). This is what matchDriver scores an
// imported name against — the same set the review grid builds in the browser,
// built here because a bulk import has no browser to build it in.
async function loadMatchEntries(seasonId, gameId, leagueId) {
  const [entrySnap, driverSnap] = await Promise.all([
    db().collection("entries").where("season_id", "==", seasonId).get(),
    scopeByLeague(db().collection("drivers"), leagueId).get(),
  ]);
  const byId = new Map(driverSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  return entrySnap.docs.map(d => {
    const entry = { id: d.id, ...d.data() };
    const driver = entry.driver_id ? byId.get(entry.driver_id) : null;
    const gameName = driver && gameId ? gameNameFor(driver, gameId) : null;
    return {
      ...entry,
      // The name this driver races under in this game wins, exactly as the
      // results grid renders it (see gameEntries in RaceEditScreen).
      name: gameName || entry.name,
      aliases: driver ? [...aliasValues(driver.aliases), ...displayNameValues(driver)] : [],
    };
  });
}

// Fetch a round's SimRacerHub page and read every session on it. Returns
// { doc, url } or { error, status }.
async function readRacePage(input) {
  // parseSrhRef is the guard on where this route will make a request to: it
  // yields simracerhub.com URLs or nothing at all.
  const ref = parseSrhRef(input);
  if (!ref.ok) return { error: ref.error, status: 400 };

  let failure = { error: "Could not read that SimRacerHub race.", status: 502 };
  for (const url of ref.urls) {
    let html;
    try {
      html = await srhFetchText(url);
    } catch (err) {
      failure = { error: err.message, status: 502 };
      continue;
    }
    const doc = parseSrhPage(html);
    if (!doc?.segments?.length) {
      failure = {
        error: srhPageError(html)
          || "That SimRacerHub page has no results on it yet — check the race has been scored.",
        status: 404,
      };
      continue;
    }
    // Each session as the table the shared importer understands, attached to
    // the segment it came from so the planner can read both at once.
    for (const segment of doc.segments) segment.table = srhSegmentTable(segment);
    return { doc, url };
  }
  return failure;
}

const handlePOST = withAdmin(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const { season_id, race_id, url, preview = false, recalc = true } = body;
  const leagueId = getRequestLeagueId(request);

  if (!season_id) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  // ── Where it would go ──────────────────────────────────────────────────
  const seasonDoc = await db().collection("seasons").doc(season_id).get();
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const season = { id: seasonDoc.id, ...seasonDoc.data() };
  if (leagueId && season.league_id && season.league_id !== leagueId) {
    return NextResponse.json({ error: "That season belongs to another league." }, { status: 403 });
  }

  const gameDoc = season.game_id ? await db().collection("games").doc(season.game_id).get() : null;
  const game = gameDoc?.exists ? { id: gameDoc.id, ...gameDoc.data() } : null;
  if (!isIracingGame(game?.name)) {
    return NextResponse.json(
      { error: "SimRacerHub scores iRacing leagues, so results can only be imported into a season under an iRacing game." },
      { status: 400 },
    );
  }

  // The bill for a run of rounds, settled on its own. The dialog asks for the
  // Skill Rating replay once, after the last round — and asks for it HERE when
  // that last round was the one that failed, so a run that wrote eleven rounds
  // and lost the twelfth still leaves the ratings sound.
  if (body.recalc_only) {
    await recalcFor(season.game_id);
    return NextResponse.json({ ok: true, recalculated: true });
  }

  if (!race_id || !url) {
    return NextResponse.json({ error: "race_id and url required" }, { status: 400 });
  }

  const raceDoc = await db().collection("races").doc(race_id).get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Race not found" }, { status: 404 });
  const race = { id: raceDoc.id, ...raceDoc.data() };
  if (race.season_id !== season_id) {
    return NextResponse.json({ error: "That race is not in this season." }, { status: 400 });
  }
  // An event whose classes run their own Qualifying and Race stores a separate
  // grid per class, and a SimRacerHub page says which class each driver is in
  // only by which of its tables they appear in — which this reads as one field,
  // because that is what the single-race importer reads it as too. Writing that
  // one field into a class's grid would put every class's drivers in one of
  // them. So a split event is refused by name rather than half-imported, and
  // the results screen enters it class by class as before.
  if (racePerClassResults(race, season)) {
    return NextResponse.json({
      error: "This round runs each class's sessions separately, so its results are entered one class at a time on the results screen.",
    }, { status: 400 });
  }

  // ── Read the round ─────────────────────────────────────────────────────
  const read = await readRacePage(url);
  if (read.error) return NextResponse.json({ error: read.error }, { status: read.status });
  const { doc, url: sourceUrl } = read;

  const entries = await loadMatchEntries(season_id, season.game_id, leagueId);
  if (!entries.length) {
    return NextResponse.json(
      { error: "This season has no roster yet, so there is nobody to import results for. Add the drivers first." },
      { status: 400 },
    );
  }

  const plan = planRace(race, doc, entries);

  // What the preview and the import both report, so the dialog renders one
  // shape either way and an admin sees the same round twice.
  const report = {
    ok: true,
    race_id,
    source_url: sourceUrl,
    event: doc.event,
    sessions: plan.sessions.map(s => ({
      srh_name: s.srh_name,
      session: s.session,
      session_type: s.session_type,
      new: s.new,
      drivers: s.driver_count,
      matched: s.matched,
      provisional: s.provisional,
      unmatched: s.unmatched.length,
      warnings: s.warnings,
    })),
    skipped: plan.skipped,
    unmatched: plan.unmatched,
    race_update: plan.race_update,
    heat_night: plan.heat_night,
    rows_total: plan.rows_total,
    stats: hasSrhSessionStats(plan.stats) ? plan.stats : null,
    stats_session: plan.stats_session,
  };

  if (!plan.rows_total) {
    return NextResponse.json({
      ...report,
      ok: false,
      error: plan.unmatched.length
        ? "Nobody on that page is on this season's roster — check the roster, or that this is the right round."
        : "That SimRacerHub page has no results to import.",
    }, { status: 422 });
  }

  if (preview) return NextResponse.json({ ...report, preview: true });

  // ── Write it ───────────────────────────────────────────────────────────
  //
  // 1. The sessions the event doesn't have yet. Written first, so the rows
  //    below land in sessions the results screen actually shows a tab for.
  if (plan.race_update) {
    await db().collection("races").doc(race_id).update(plan.race_update);
  }

  // 2. Every session's rows, in one batch. The race's existing results are read
  //    once for all of them — five sessions of the same event cannot each have
  //    a different answer to "what is already stored here".
  const { firstSession } = await sessionContext(race_id);
  const entriesById = await classByEntryForSeason(season_id);
  const existing = await db().collection("results").where("race_id", "==", race_id).get();
  const batch = db().batch();
  let written = 0;
  for (const s of plan.sessions) {
    if (!s.rows.length) continue;
    stageSessionWrite({
      batch, existing: existing.docs, race_id, season_id, leagueId,
      session: s.session, sessionType: s.session_type, rows: s.rows,
      // The event's own points structures decide what each session pays, as on
      // any session saved without one picked (see resolveTemplateId in
      // lib/standings.js). An import must not pin a template nobody chose.
      points_template_id: null,
      firstSession,
      raceClassId: race.class_id || "",
      entriesById, uid: user.uid,
    });
    written += 1;
  }
  await batch.commit();

  // 3. The night's own figures — cautions, caution laps, lead changes — from
  //    the session that decided it. Written after the results on purpose: the
  //    results are the point, and a race statistic is worth nothing without
  //    them. A failure here never fails the import.
  let statsSaved = false;
  if (report.stats) {
    try {
      await db().collection("races").doc(race_id).update({
        caution_flags: Number(report.stats.caution_flags || 0),
        caution_laps: Number(report.stats.caution_laps || 0),
        lead_changes: Number(report.stats.lead_changes || 0),
      });
      statsSaved = true;
    } catch (err) {
      console.error("Race statistics not saved", err);
    }
  }

  // 4. Skill Ratings, once the dialog says the season is done.
  if (recalc) await recalcFor(season.game_id);

  return NextResponse.json({
    ...report,
    preview: false,
    written: { sessions: written, rows: plan.rows_total, stats: statsSaved },
  });
});

// A successful write here changes what the cached league reads are built from,
// so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
