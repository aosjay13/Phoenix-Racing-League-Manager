import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { buildEntityDoc, SPECS } from "@/lib/entityApi";
import { withStatsRefresh } from "@/lib/statsCache";
import { normalizeName } from "@/lib/nameKey";
import { isIracingGame } from "@/lib/signupRequest";
import { srhCarName, srhFetchText, srhTrackDirectoryHtml } from "@/lib/srhFetch";
import {
  parseSrhSchedule, parseSrhSeasonRef, parseSrhTrackDirectory, srhSchedulePlan, srhTrackInfo,
} from "@/lib/srhSchedule";
import { applyTrackDecisions, planTrackImport, trackNames } from "@/lib/trackMatch";

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

// A schedule with more rounds than this is not a schedule.
const MAX_RACES = 120;
// Cars are named on their own page, one request each, so a season racing a
// handful of them looks them up and a season somehow listing dozens doesn't.
const MAX_CAR_LOOKUPS = 8;

// Every track this league has, for the matcher to check a schedule against.
// Names are indexed by lib/trackMatch.js rather than here, so the importer and
// the review table agree on what a venue answers to.
async function loadTracks(leagueId) {
  let query = db().collection("tracks");
  if (leagueId) query = query.where("league_id", "==", leagueId);
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

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
  let game = null;
  if (!preview) {
    if (!series_id) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    const seriesDoc = await db().collection("series").doc(series_id).get();
    if (!seriesDoc.exists) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    series = { id: seriesDoc.id, ...seriesDoc.data() };
    if (leagueId && series.league_id && series.league_id !== leagueId) {
      return NextResponse.json({ error: "That series belongs to another league." }, { status: 403 });
    }
    if (!series.game_id) {
      return NextResponse.json({ error: "That series isn't attached to a game." }, { status: 400 });
    }
    const gameDoc = await db().collection("games").doc(series.game_id).get();
    game = gameDoc.exists ? { id: gameDoc.id, ...gameDoc.data() } : null;
    if (!isIracingGame(game?.name)) {
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

  const leagueTracks = await loadTracks(leagueId);
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
      // Every venue this schedule races at, checked against the ones this
      // league already has: what matched, what merely resembles something (with
      // the reason, so an admin can tell an Oval from a Roval), and what would
      // be created — named as the admin likes rather than as SimRacerHub does.
      tracks: trackPlan.rows,
      track_summary: trackPlan.summary,
      // Every track in the league, for the review table's dropdown: an admin
      // settling a doubtful venue may want one this matcher never offered.
      league_tracks: leagueTracks
        .map(t => ({ id: t.id, name: t.name, track_type: t.track_type || "", names: trackNames(t) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      new_tracks: trackPlan.summary.new,
    });
  }

  // ── Write it ───────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  if (!plan.season.name) return NextResponse.json({ error: "season_name required" }, { status: 400 });

  // 1. The venues, settled first so every race can be linked to a real track
  //    rather than carrying its name as loose text — which is what gives the
  //    season's rounds a track page, lap records and a history from the day
  //    they're created.
  //
  //    The admin's answers decide; an unanswered suggestion creates the venue
  //    rather than pointing a season's races at a layout nobody confirmed (see
  //    applyTrackDecisions).
  const decided = applyTrackDecisions(trackPlan.rows, body.track_decisions || {});
  if (decided.errors.length) {
    return NextResponse.json({ error: decided.errors[0], track_errors: decided.errors }, { status: 400 });
  }

  const byId = new Map(leagueTracks.map(t => [t.id, t]));
  const trackIdByName = new Map();
  const created = [];
  const aliased = [];

  //    a) Venues the league already has. The name the source used is recorded
  //       on the one the admin pointed at, unless it already answers to it —
  //       that recording is what makes next season's import an exact match, and
  //       what lets a league call a venue whatever it likes.
  for (const { raw, track_id } of decided.use) {
    const track = byId.get(track_id);
    if (!track) return NextResponse.json({ error: `That track no longer exists (${raw}).` }, { status: 404 });
    trackIdByName.set(raw, track);
    const known = new Set(trackNames(track).map(normalizeName));
    if (!known.has(normalizeName(raw))) {
      const merged = [...(Array.isArray(track.merged_names) ? track.merged_names : []), raw];
      await db().collection("tracks").doc(track.id).update({ merged_names: merged });
      track.merged_names = merged;
      aliased.push({ track: track.name, name: raw });
    }
  }

  //    b) Venues this league doesn't have yet, under the name the admin chose,
  //       with the surface its name implies and iRacing's own logo where the
  //       directory had one. The logo is an image field, so buildEntityDoc
  //       leaves it off for anyone but the Owner — the same rule every other
  //       logo follows (see lib/imagePermissions.js).
  for (const { raw, name, track_type, logo_url } of decided.create) {
    const built = buildEntityDoc({
      spec: SPECS.tracks,
      body: {
        name,
        ...(track_type ? { track_type } : {}),
        ...(logo_url ? { logo_url } : {}),
        // The source's own name for it, when the admin called it something
        // else. Printed on the track's page as "Also raced as", and matched on
        // by every later import.
        ...(normalizeName(name) === normalizeName(raw) ? {} : { merged_names: [raw] }),
      },
      user, role, leagueId, now,
    });
    if (built.error) return NextResponse.json({ error: built.error }, { status: 400 });
    // `merged_names` isn't one of the tracks spec's writable fields (the merge
    // tool owns it), so it's set alongside the built doc rather than through it.
    const doc = normalizeName(name) === normalizeName(raw) ? built.doc : { ...built.doc, merged_names: [raw] };
    const ref2 = await db().collection("tracks").add(doc);
    const saved = { id: ref2.id, ...doc };
    trackIdByName.set(raw, saved);
    created.push(saved);
  }

  // 2. The season.
  const seasonBuilt = buildEntityDoc({
    spec: SPECS.seasons,
    body: {
      series_id,
      game_id: series.game_id,
      name: plan.season.name,
      ...(plan.season.car ? { car: plan.season.car } : {}),
    },
    user, role, leagueId, now,
  });
  if (seasonBuilt.error) return NextResponse.json({ error: seasonBuilt.error }, { status: 400 });
  const seasonRef = await db().collection("seasons").add(seasonBuilt.doc);
  const season = { id: seasonRef.id, ...seasonBuilt.doc };

  // 3. The races, each validated by the same rules a single New Race POST
  //    applies (see buildEntityDoc), then written in batches.
  const raceDocs = [];
  for (const race of plan.races) {
    const track = race.track ? trackIdByName.get(race.track) : null;
    const built = buildEntityDoc({
      spec: SPECS.races,
      body: {
        ...race,
        season_id: season.id,
        ...(track ? { track: track.name, track_id: track.id } : {}),
      },
      user, role, leagueId, now,
    });
    if (built.error) return NextResponse.json({ error: `Round ${race.round_number}: ${built.error}` }, { status: 400 });
    raceDocs.push(built.doc);
  }
  for (let i = 0; i < raceDocs.length; i += 450) {
    const batch = db().batch();
    for (const doc of raceDocs.slice(i, i + 450)) batch.set(db().collection("races").doc(), doc);
    await batch.commit();
  }

  return NextResponse.json({
    ok: true,
    source_url: ref.url,
    season,
    races: raceDocs.length,
    tracks_created: created.map(t => t.name),
    tracks_matched: decided.use.length,
    // Venues that learned what SimRacerHub calls them, so the next import of
    // this series needs no review at all.
    tracks_aliased: aliased,
    off_weeks: plan.off_weeks,
    warnings: plan.warnings,
  });
});

// A successful write here changes what the cached league reads are built from,
// so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
