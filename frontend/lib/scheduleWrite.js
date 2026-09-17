// Creating a season, its rounds and the venues they race at.
//
// Two importers now produce a season's schedule: the SimRacerHub one, which
// reads it off a URL, and the pasted one, which reads it out of a spreadsheet
// (see lib/srhSchedule.js and lib/pastedSchedule.js). Both hand srhSchedulePlan
// the same rounds and get the same plan back, so everything from that point on
// — checking the venues against the ones a league already has, settling the
// admin's answers, and writing the tracks, the season and the races — is one
// job done once, here.
//
// Keeping it in one place is not tidiness. A season's worth of documents is the
// largest thing either importer writes, and the venue rules are the subtle part
// of it: a track the admin points an import at RECORDS the name the source used
// (in `merged_names`, printed on the track's page as "Also raced as"), which is
// what makes next season's import an exact match and what stops a source's
// naming becoming this app's naming. A second copy of that would drift, and the
// drift would show up as a Tracks library full of near-duplicates.
//
// Server-only: it writes to Firestore, so it is imported from route handlers.

import { db } from "@/lib/firebase";
import { buildEntityDoc, SPECS } from "@/lib/entityApi";
import { normalizeName } from "@/lib/nameKey";
import { applyTrackDecisions, trackNames } from "@/lib/trackMatch";

// A schedule with more rounds than this is not a schedule.
export const MAX_RACES = 120;

// Every track this league has, for the matcher to check a schedule against.
// Names are indexed by lib/trackMatch.js rather than here, so the importer and
// the review table agree on what a venue answers to.
export async function loadLeagueTracks(leagueId) {
  let query = db().collection("tracks");
  if (leagueId) query = query.where("league_id", "==", leagueId);
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The tracks half of a preview, in the shape both review tables render.
export function trackPreview(trackPlan, leagueTracks) {
  return {
    // Every venue this schedule races at, checked against the ones this league
    // already has: what matched, what merely resembles something (with the
    // reason, so an admin can tell an Oval from a Roval), and what would be
    // created — named as the admin likes rather than as the source does.
    tracks: trackPlan.rows,
    track_summary: trackPlan.summary,
    // Every track in the league, for the review table's dropdown: an admin
    // settling a doubtful venue may want one this matcher never offered.
    league_tracks: leagueTracks
      .map(t => ({ id: t.id, name: t.name, track_type: t.track_type || "", names: trackNames(t) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    new_tracks: trackPlan.summary.new,
  };
}

// The series a season is about to be created in, checked. Returns
// { series, game } or { error, status }.
export async function resolveTargetSeries(seriesId, leagueId) {
  if (!seriesId) return { error: "series_id required", status: 400 };
  const seriesDoc = await db().collection("series").doc(seriesId).get();
  if (!seriesDoc.exists) return { error: "Series not found", status: 404 };
  const series = { id: seriesDoc.id, ...seriesDoc.data() };
  if (leagueId && series.league_id && series.league_id !== leagueId) {
    return { error: "That series belongs to another league.", status: 403 };
  }
  if (!series.game_id) return { error: "That series isn't attached to a game.", status: 400 };
  const gameDoc = await db().collection("games").doc(series.game_id).get();
  return { series, game: gameDoc.exists ? { id: gameDoc.id, ...gameDoc.data() } : null };
}

// Write the venues, the season and its races. Returns what the route answers
// with, or { error, status } for anything it refuses.
export async function writeScheduleImport({
  plan, trackPlan, trackDecisions = {}, seriesId, gameId, leagueTracks,
  user, role, leagueId, now = new Date().toISOString(),
}) {
  if (!plan.season.name) return { error: "season_name required", status: 400 };

  // 1. The venues, settled first so every race can be linked to a real track
  //    rather than carrying its name as loose text — which is what gives the
  //    season's rounds a track page, lap records and a history from the day
  //    they're created.
  //
  //    The admin's answers decide; an unanswered suggestion creates the venue
  //    rather than pointing a season's races at a layout nobody confirmed (see
  //    applyTrackDecisions).
  const decided = applyTrackDecisions(trackPlan.rows, trackDecisions || {});
  if (decided.errors.length) {
    return { error: decided.errors[0], track_errors: decided.errors, status: 400 };
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
    if (!track) return { error: `That track no longer exists (${raw}).`, status: 404 };
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
  //       with the surface its name implies and the source's own logo where it
  //       had one. The logo is an image field, so buildEntityDoc leaves it off
  //       for anyone but the Owner — the same rule every other logo follows
  //       (see lib/imagePermissions.js).
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
    if (built.error) return { error: built.error, status: 400 };
    // `merged_names` isn't one of the tracks spec's writable fields (the merge
    // tool owns it), so it's set alongside the built doc rather than through it.
    const doc = normalizeName(name) === normalizeName(raw) ? built.doc : { ...built.doc, merged_names: [raw] };
    const ref = await db().collection("tracks").add(doc);
    const saved = { id: ref.id, ...doc };
    trackIdByName.set(raw, saved);
    created.push(saved);
  }

  // 2. The season.
  const seasonBuilt = buildEntityDoc({
    spec: SPECS.seasons,
    body: {
      series_id: seriesId,
      game_id: gameId,
      name: plan.season.name,
      ...(plan.season.car ? { car: plan.season.car } : {}),
    },
    user, role, leagueId, now,
  });
  if (seasonBuilt.error) return { error: seasonBuilt.error, status: 400 };
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
    if (built.error) return { error: `Round ${race.round_number}: ${built.error}`, status: 400 };
    raceDocs.push(built.doc);
  }
  for (let i = 0; i < raceDocs.length; i += 450) {
    const batch = db().batch();
    for (const doc of raceDocs.slice(i, i + 450)) batch.set(db().collection("races").doc(), doc);
    await batch.commit();
  }

  return {
    season,
    races: raceDocs.length,
    tracks_created: created.map(t => t.name),
    tracks_matched: decided.use.length,
    // Venues that learned what the source calls them, so the next import of
    // this series needs no review at all.
    tracks_aliased: aliased,
  };
}
