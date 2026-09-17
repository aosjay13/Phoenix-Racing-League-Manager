import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";
import { entryClassIds } from "@/lib/classFilter";
import {
  mapClassesByName, mapClassId, planEntryMap, newEntryForDriver,
  copyRaceDoc, copyResultDocs, customPointsIdMap, nextRoundNumber, scheduleRoundNumbers,
} from "@/lib/raceCopy";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// Copy one event — and the results it scored — into another season, in the same
// series or a different one entirely.
//
//   GET                        → the season index the copy dialog picks from:
//                                every season in the league with its series and
//                                game, plus how many events each one has
//   GET  ?season_id=…          → that season's events, oldest round first, with
//                                whether each has saved results
//   POST { race_id, to_season_id, … }
//                              → copy that one event
//   POST { from_season_id, to_season_id, … }
//                              → copy that season's WHOLE SCHEDULE — every
//                                round of it, in order
//
// A race carries per-season ids that mean nothing in the target season, so the
// copy translates rather than duplicates (see lib/raceCopy.js): drivers are
// matched to the target roster by driver_id → linked account → name, classes are
// matched by NAME, and anything that can't be matched degrades gracefully — an
// unmatched class copies over unclassified, an unmatched driver is either added
// to the target roster (`add_missing_drivers`, the default) or reported back as
// skipped.
//
// What's deliberately left behind: Skill Rating (recomputed for the target
// season's game at the end of the copy) and Strength of Field, both of which are
// derived by replaying a game's whole timeline and would be fiction if carried.
//
// A WHOLE SCHEDULE is the same copy done for every round, and it is one request
// rather than a loop of them on purpose: the roster and class mappings are
// worked out once instead of per round, every document lands in one run of
// batches, and the Skill Rating replay — which walks a game's entire timeline —
// is paid for once at the end rather than twelve times. It is the same planner
// and the same rules either way; the only thing a schedule adds is which round
// numbers the copies take.

// One league's seasons with the series and game around them, so the dialog can
// offer "which season?" as a single grouped dropdown instead of making an admin
// drill Game ▸ Series ▸ Season twice over.
async function seasonIndex(leagueId) {
  const [seasonsSnap, seriesSnap, gamesSnap, racesSnap] = await Promise.all([
    scopeByLeague(db().collection("seasons"), leagueId).get(),
    db().collection("series").get(),
    db().collection("games").get(),
    db().collection("races").get(),
  ]);
  const seriesById = Object.fromEntries(seriesSnap.docs.map(d => [d.id, d.data()]));
  const gameName = Object.fromEntries(gamesSnap.docs.map(d => [d.id, d.data().name || "Game"]));
  const raceCount = {};
  for (const d of racesSnap.docs) {
    const sid = d.data().season_id;
    if (sid) raceCount[sid] = (raceCount[sid] || 0) + 1;
  }

  const seasons = seasonsSnap.docs.map(d => {
    const s = d.data();
    const ser = s.series_id ? seriesById[s.series_id] : null;
    return {
      id: d.id,
      name: s.name || "Season",
      series_id: s.series_id || null,
      series_name: ser?.name || null,
      game_id: s.game_id || null,
      game_name: s.game_id ? (gameName[s.game_id] || null) : null,
      status: s.status || "active",
      race_count: raceCount[d.id] || 0,
    };
  });
  // Grouped the way the dropdown reads them: game, then series, then season.
  seasons.sort((a, b) =>
    String(a.game_name ?? "").localeCompare(String(b.game_name ?? "")) ||
    String(a.series_name ?? "").localeCompare(String(b.series_name ?? "")) ||
    String(a.name).localeCompare(String(b.name)));
  return seasons;
}

// One season's events for the "which race?" dropdown. `has_results` is what
// makes the dialog honest about what a copy will actually bring across — an
// event with none copies as an empty calendar entry.
async function seasonRaces(seasonId) {
  const [racesSnap, resultsSnap] = await Promise.all([
    db().collection("races").where("season_id", "==", seasonId).get(),
    db().collection("results").where("season_id", "==", seasonId).get(),
  ]);
  const counts = {};
  for (const d of resultsSnap.docs) {
    const rid = d.data().race_id;
    if (rid) counts[rid] = (counts[rid] || 0) + 1;
  }
  return racesSnap.docs
    .map(d => {
      const r = d.data();
      return {
        id: d.id,
        name: r.name || "Race",
        date: r.date || null,
        round_number: r.round_number ?? null,
        track: r.track || null,
        result_count: counts[d.id] || 0,
        has_results: (counts[d.id] || 0) > 0,
      };
    })
    .sort((a, b) => (Number(a.round_number) || 0) - (Number(b.round_number) || 0));
}

export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (seasonId) return NextResponse.json({ races: await seasonRaces(seasonId) });
  return NextResponse.json({ seasons: await seasonIndex(getRequestLeagueId(request)) });
});

// Firestore caps a batch at 500 writes; results for one event stay well inside
// that, but a heat-racing weekend with several sessions and a full field can
// approach it, so writes are chunked.
//
// Order matters across chunks: roster entries, then the race, then its results.
// A chunk failing part-way therefore leaves at worst a visible event holding
// fewer results than it should — something an admin can see and delete — rather
// than results whose race doesn't exist, which would score in the standings
// with nothing on the calendar to point at.
const BATCH_LIMIT = 450;

async function commitAll(docs) {
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = db().batch();
    for (const { ref, doc } of docs.slice(i, i + BATCH_LIMIT)) batch.set(ref, doc);
    await batch.commit();
  }
}

// A season with more rounds than this is not a schedule.
const MAX_SCHEDULE_RACES = 120;

const handlePOST = withAdmin(async (request, ctx, user) => {
  const {
    race_id, from_season_id, to_season_id,
    // A whole schedule is the calendar, so it copies WITHOUT last season's
    // results unless they're asked for; one event is usually copied for the
    // results it scored, so that one brings them by default. Both dialogs offer
    // the same switch either way.
    include_results = !from_season_id,
    add_missing_drivers = true,
    name = null, date = null, round_number = null,
  } = await request.json();

  const wholeSchedule = !race_id && !!from_season_id;
  if (!to_season_id || (!race_id && !from_season_id)) {
    return NextResponse.json({ error: "to_season_id and one of race_id / from_season_id required" }, { status: 400 });
  }

  // ── What is being copied ─────────────────────────────────────────────────
  //
  // One event or every round of a season. From here down the two are the same
  // thing — a list of source races — so there is one set of rules rather than
  // two that could drift.
  const targetSeasonDoc = await db().collection("seasons").doc(to_season_id).get();
  if (!targetSeasonDoc.exists) return NextResponse.json({ error: "That season no longer exists." }, { status: 404 });

  let sourceRaces = [];
  let fromSeasonId = from_season_id || "";
  if (wholeSchedule) {
    const snap = await db().collection("races").where("season_id", "==", from_season_id).get();
    sourceRaces = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.round_number) || 0) - (Number(b.round_number) || 0));
    if (!sourceRaces.length) {
      return NextResponse.json({ error: "That season has no races to copy." }, { status: 404 });
    }
    if (sourceRaces.length > MAX_SCHEDULE_RACES) {
      return NextResponse.json({ error: `That season has ${sourceRaces.length} rounds, which is more than this can copy at once.` }, { status: 400 });
    }
  } else {
    const raceDoc = await db().collection("races").doc(race_id).get();
    if (!raceDoc.exists) return NextResponse.json({ error: "That race no longer exists." }, { status: 404 });
    const race = { id: raceDoc.id, ...raceDoc.data() };
    if (!race.season_id) {
      return NextResponse.json({ error: "That race isn't attached to a season." }, { status: 400 });
    }
    fromSeasonId = race.season_id;
    sourceRaces = [race];
  }

  if (fromSeasonId === to_season_id) {
    return NextResponse.json({ error: "Pick a different season to copy into." }, { status: 400 });
  }

  const leagueId = getRequestLeagueId(request);
  // Copying between leagues would move drivers and results across a partition
  // that every other read treats as absolute.
  const targetLeagueId = targetSeasonDoc.data().league_id || "";
  if (leagueId && targetLeagueId && targetLeagueId !== leagueId) {
    return NextResponse.json({ error: "That season belongs to another league." }, { status: 403 });
  }

  const [sourceEntriesSnap, targetEntriesSnap, sourceClassSnap, targetClassSnap, targetRacesSnap, resultsSnap] =
    await Promise.all([
      db().collection("entries").where("season_id", "==", fromSeasonId).get(),
      db().collection("entries").where("season_id", "==", to_season_id).get(),
      db().collection("classes").where("season_id", "==", fromSeasonId).get(),
      db().collection("classes").where("season_id", "==", to_season_id).get(),
      db().collection("races").where("season_id", "==", to_season_id).get(),
      // One query either way: a season's results all carry its season_id, so a
      // whole schedule needs no per-race read.
      include_results
        ? (wholeSchedule
          ? db().collection("results").where("season_id", "==", fromSeasonId).get()
          : db().collection("results").where("race_id", "==", race_id).get())
        : Promise.resolve({ docs: [] }),
    ]);

  const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sourceEntries = docsOf(sourceEntriesSnap);
  const targetEntries = docsOf(targetEntriesSnap);
  const results = docsOf(resultsSnap);
  const classMap = mapClassesByName(docsOf(sourceClassSnap), docsOf(targetClassSnap));

  const now = new Date().toISOString();
  const stamp = { created_at: now, created_by: user.uid, ...(leagueId ? { league_id: leagueId } : {}) };

  // ── The races themselves ─────────────────────────────────────────────────
  //
  // Which round numbers the copies take. A schedule copied into an EMPTY season
  // keeps its own numbering, because that is the schedule — "Race 1" of the
  // source is "Race 1" of the copy. Into a season that already has rounds, they
  // continue from the last one instead, since two rounds sharing a number would
  // order the calendar by chance. One event always joins the end, as it always
  // has.
  const targetRaces = docsOf(targetRacesSnap);
  const startAt = nextRoundNumber(targetRaces);
  const keepsOwnNumbers = wholeSchedule && targetRaces.length === 0;
  const scheduleNumbers = scheduleRoundNumbers(sourceRaces, targetRaces);

  const resultsByRace = {};
  for (const r of results) (resultsByRace[r.race_id] ??= []).push(r);

  const planned = sourceRaces.map((race, i) => {
    // Points structures typed for a single session live on the race document,
    // so each copy gets its own ids for them — otherwise the two events would
    // share one structure and editing either would re-score the other. Empty
    // unless the source event actually carries one.
    const customPointsMap = customPointsIdMap(race);
    const ref = db().collection("races").doc();
    return {
      source: race,
      ref,
      customPointsMap,
      doc: {
        ...copyRaceDoc(race, {
          season_id: to_season_id,
          round_number: wholeSchedule
            ? scheduleNumbers[i]
            : (round_number != null && round_number !== "" ? Number(round_number) : startAt),
          // Renaming and re-dating are one event's business; a schedule keeps
          // every round's own name and date, which is what a schedule IS.
          name: wholeSchedule ? null : name,
          date: wholeSchedule ? null : date,
          // A "<class> only" round stays pinned to the same class by name when
          // the target season runs one; otherwise it copies as a shared round,
          // since a stale class id would hide the event from every calendar.
          class_id: mapClassId(race.class_id, classMap),
          classMap,
          // The event's caution flags / lead changes describe the race that was
          // run, so they come across only when its results do.
          include_results,
          customPointsMap,
        }),
        copied_from_race_id: race.id,
        copied_from_season_id: fromSeasonId,
        ...stamp,
      },
    };
  });

  // ── The drivers those results belong to ──────────────────────────────────
  // Only the drivers these events actually scored need to exist on the target
  // roster — copying races is not a roster import, so nobody else comes along.
  const scoringEntryIds = new Set(results.map(r => r.entry_id).filter(Boolean));
  const scoringEntries = sourceEntries.filter(e => scoringEntryIds.has(e.id));
  const { map: entryMap, missing } = planEntryMap(scoringEntries, targetEntries);

  const createdEntries = [];
  if (add_missing_drivers) {
    for (const entry of missing) {
      const ref = db().collection("entries").doc();
      const doc = {
        season_id: to_season_id,
        ...newEntryForDriver(entry, entryClassIds(entry).map(id => mapClassId(id, classMap))),
        ...stamp,
      };
      createdEntries.push({ ref, doc });
      entryMap[entry.id] = ref.id;
    }
  }

  // Each copy's results, keyed to the copy rather than to the round they came
  // from — one race's worth at a time, so a session's points structure is the
  // one its own event carries.
  const rows = [];
  const skipped = [];
  for (const p of planned) {
    const out = copyResultDocs(resultsByRace[p.source.id] || [], {
      race_id: p.ref.id, season_id: to_season_id, entryMap, classMap,
      customPointsMap: p.customPointsMap,
    });
    rows.push(...out.rows);
    skipped.push(...out.skipped);
  }

  await commitAll([
    ...createdEntries,
    ...planned.map(p => ({ ref: p.ref, doc: p.doc })),
    ...rows.map(doc => ({ ref: db().collection("results").doc(), doc: { ...doc, ...stamp } })),
  ]);

  // The copy is a new race in the target season's game, so that game's Skill
  // Rating timeline has to be replayed for it to slot into date order. Derived
  // data — never fails the copy; the next recalc corrects it.
  try {
    await recalcGameSkillRatings(await gameIdForSeason(to_season_id));
  } catch (err) {
    console.error("Skill Rating recalc failed", err);
  }

  // Who didn't make it, by name, so the dialog can say so rather than just
  // reporting a smaller number than the admin expected.
  const nameOfEntry = Object.fromEntries(sourceEntries.map(e => [e.id, e.name || "Unknown driver"]));
  const skippedNames = [...new Set(skipped.map(r => nameOfEntry[r.entry_id] || "Unknown driver"))];

  return NextResponse.json({
    // The one event, for the dialog that copied one. A schedule reports the set.
    race: { id: planned[0].ref.id, ...planned[0].doc },
    races_copied: planned.length,
    rounds: planned.map(p => ({ id: p.ref.id, name: p.doc.name, round_number: p.doc.round_number })),
    kept_round_numbers: keepsOwnNumbers,
    results_copied: rows.length,
    results_skipped: skipped.length,
    drivers_created: createdEntries.length,
    skipped_drivers: skippedNames,
    // A class the target season doesn't run: its results copy over
    // unclassified, which is worth saying out loud.
    unmapped_classes: [...new Set(
      results.map(r => r.class_id).filter(id => id && !classMap[id])
    )].length,
  }, { status: 201 });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
