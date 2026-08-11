import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";
import { entryClassIds } from "@/lib/classFilter";
import {
  mapClassesByName, mapClassId, planEntryMap, newEntryForDriver,
  copyRaceDoc, copyResultDocs, nextRoundNumber,
} from "@/lib/raceCopy";

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
//                              → do the copy
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

export const POST = withAdmin(async (request, ctx, user) => {
  const {
    race_id, to_season_id,
    include_results = true,
    add_missing_drivers = true,
    name = null, date = null, round_number = null,
  } = await request.json();

  if (!race_id || !to_season_id) {
    return NextResponse.json({ error: "race_id and to_season_id required" }, { status: 400 });
  }

  const [raceDoc, targetSeasonDoc] = await Promise.all([
    db().collection("races").doc(race_id).get(),
    db().collection("seasons").doc(to_season_id).get(),
  ]);
  if (!raceDoc.exists) return NextResponse.json({ error: "That race no longer exists." }, { status: 404 });
  if (!targetSeasonDoc.exists) return NextResponse.json({ error: "That season no longer exists." }, { status: 404 });

  const race = { id: raceDoc.id, ...raceDoc.data() };
  const fromSeasonId = race.season_id;
  if (!fromSeasonId) {
    return NextResponse.json({ error: "That race isn't attached to a season." }, { status: 400 });
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
      include_results
        ? db().collection("results").where("race_id", "==", race_id).get()
        : Promise.resolve({ docs: [] }),
    ]);

  const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sourceEntries = docsOf(sourceEntriesSnap);
  const targetEntries = docsOf(targetEntriesSnap);
  const results = docsOf(resultsSnap);
  const classMap = mapClassesByName(docsOf(sourceClassSnap), docsOf(targetClassSnap));

  const now = new Date().toISOString();
  const stamp = { created_at: now, created_by: user.uid, ...(leagueId ? { league_id: leagueId } : {}) };

  // ── The race itself ──────────────────────────────────────────────────────
  const raceRef = db().collection("races").doc();
  const newRace = {
    ...copyRaceDoc(race, {
      season_id: to_season_id,
      round_number: round_number != null && round_number !== ""
        ? Number(round_number)
        : nextRoundNumber(docsOf(targetRacesSnap)),
      name, date,
      // A "<class> only" round stays pinned to the same class by name when the
      // target season runs one; otherwise it copies as a shared round, since a
      // stale class id would hide the event from every calendar.
      class_id: mapClassId(race.class_id, classMap),
      classMap,
    }),
    copied_from_race_id: race.id,
    copied_from_season_id: fromSeasonId,
    ...stamp,
  };

  // ── The drivers those results belong to ──────────────────────────────────
  // Only the drivers this event actually scored need to exist on the target
  // roster — copying a race is not a roster import, so nobody else comes along.
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

  const { rows, skipped } = copyResultDocs(results, {
    race_id: raceRef.id, season_id: to_season_id, entryMap, classMap,
  });

  await commitAll([
    ...createdEntries,
    { ref: raceRef, doc: newRace },
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
    race: { id: raceRef.id, ...newRace },
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
