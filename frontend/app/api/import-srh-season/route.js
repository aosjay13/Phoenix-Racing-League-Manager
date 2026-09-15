import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { buildEntityDoc, SPECS } from "@/lib/entityApi";
import { withStatsRefresh } from "@/lib/statsCache";
import { normalizeName } from "@/lib/nameKey";
import { isIracingGame } from "@/lib/signupRequest";
import { srhCarName, srhFetchText } from "@/lib/srhFetch";
import { parseSrhSchedule, parseSrhSeasonRef, srhSchedulePlan } from "@/lib/srhSchedule";

export const dynamic = "force-dynamic";

// Import a whole season's schedule from SimRacerHub.
//
//   POST { url, preview: true }        → read that season's schedule and say
//                                        what importing it WOULD create,
//                                        writing nothing
//   POST { url, series_id, season_name? }
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

// A schedule with more rounds than this is not a schedule.
const MAX_RACES = 120;
// Cars are named on their own page, one request each, so a season racing a
// handful of them looks them up and a season somehow listing dozens doesn't.
const MAX_CAR_LOOKUPS = 8;

// The league's tracks, indexed by every name each of them answers to — its own
// and any it was merged from, which is what stops an import re-creating a
// venue an admin has just tidied away (see the track merge tool).
async function loadTracks(leagueId) {
  let query = db().collection("tracks");
  if (leagueId) query = query.where("league_id", "==", leagueId);
  const snap = await query.get();
  const byName = new Map();
  const docs = [];
  for (const d of snap.docs) {
    const data = { id: d.id, ...d.data() };
    docs.push(data);
    for (const name of [data.name, ...(data.merged_names || [])]) {
      const key = normalizeName(name);
      if (key && !byName.has(key)) byName.set(key, data);
    }
  }
  return { byName, docs };
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

  const { byName: tracksByName } = await loadTracks(leagueId);
  const matched = plan.tracks.map(name => ({ name, track: tracksByName.get(normalizeName(name)) || null }));

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
      // Which venues this league already has and which it would gain — the one
      // thing an import like this can add that an admin didn't ask for by name.
      tracks: matched.map(({ name, track }) => ({
        name,
        existing: track ? { id: track.id, name: track.name } : null,
      })),
      new_tracks: matched.filter(m => !m.track).length,
    });
  }

  // ── Write it ───────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  if (!plan.season.name) return NextResponse.json({ error: "season_name required" }, { status: 400 });

  // 1. Tracks this league doesn't have yet. Created first, so every race can be
  //    linked to a real venue rather than carrying its name as loose text —
  //    which is what gives the season's rounds a track page, lap records and a
  //    history from the day they're created.
  const trackIdByName = new Map();
  const created = [];
  for (const { name, track } of matched) {
    if (track) { trackIdByName.set(name, track); continue; }
    const built = buildEntityDoc({ spec: SPECS.tracks, body: { name }, user, role, leagueId, now });
    if (built.error) return NextResponse.json({ error: built.error }, { status: 400 });
    const ref2 = await db().collection("tracks").add(built.doc);
    const doc = { id: ref2.id, ...built.doc };
    trackIdByName.set(name, doc);
    created.push(doc);
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
    tracks_matched: matched.length - created.length,
    off_weeks: plan.off_weeks,
    warnings: plan.warnings,
  });
});

// A successful write here changes what the cached league reads are built from,
// so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
