import { db } from "@/lib/firebase";
import { scopeByLeague } from "@/lib/serverAuth";
import { normalizeAverageLaps, normalizeLaps, normalizeMaxLaps, summarizeEntries } from "@/lib/timeTrials";

// Firestore reads around the Time Trial rules in lib/timeTrials.js.
//
// A trial lives in two collections: the session itself (`time_trials`) and one
// document per driver in it (`time_trial_entries`, linked by `time_trial_id`),
// the same parent-field shape every other list in this app uses. Laps ride on
// the entry as an array of clock strings — a driver submits many laps, and the
// number of them is not known in advance, so they are the row rather than a row
// each.

export const TRIAL_COLLECTION = "time_trials";
export const TRIAL_ENTRY_COLLECTION = "time_trial_entries";

export const TRIAL_STATUS_OPEN = "open";
export const TRIAL_STATUS_COMPLETED = "completed";

// The label a trial's laps carry into the Track Records database. Records show
// the session a lap came from, so a hot lap set in a time trial says so rather
// than looking like it came out of a race.
export const TRIAL_SESSION_LABEL = "Time Trial";

// The series → season map, kept to the series actually being placed into. A
// leftover entry for a series that was later unticked would otherwise keep
// routing rosters somewhere the sheet no longer offers.
function cleanSeriesSeasons(value, seriesIds = []) {
  if (!value || typeof value !== "object") return {};
  const wanted = new Set(seriesIds);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([seriesId, seasonId]) => wanted.has(seriesId) && seasonId)
      .map(([seriesId, seasonId]) => [seriesId, String(seasonId)])
  );
}

// The session settings, coerced. Everything here is optional except the name:
// a trial can float free of any season (a pre-season shootout for a season that
// doesn't exist yet is the normal case for a placement night), in which case it
// carries only a game and stands on its own.
//
// Every field is always returned, coerced. Which of them a PATCH actually
// WRITES is the route's business — it keeps only the fields the request named,
// so a screen that knows about one setting can't blank the rest.
export function trialFields(body = {}) {
  const out = {};
  const set = (field, value) => { out[field] = value; };

  set("name", String(body.name ?? "").trim());
  set("game_id", String(body.game_id ?? "").trim());
  set("series_id", String(body.series_id ?? "").trim());
  set("season_id", String(body.season_id ?? "").trim());
  set("track_id", String(body.track_id ?? "").trim());
  set("track", String(body.track ?? "").trim());
  set("date", String(body.date ?? "").trim().slice(0, 10));
  set("car", String(body.car ?? "").trim());
  set("notes", String(body.notes ?? "").trim());
  set("max_laps", normalizeMaxLaps(body.max_laps));
  set("is_placement", !!body.is_placement);
  set("class_ids", Array.isArray(body.class_ids) ? body.class_ids.filter(Boolean).map(String) : []);
  // Series placement: the series this night sorts drivers into, for the leagues
  // whose divisions ARE series rather than classes. `series_seasons` names, per
  // series, the season whose roster the placement builds — a roster belongs to
  // a season, so a series alone isn't a destination.
  set("series_ids", Array.isArray(body.series_ids) ? body.series_ids.filter(Boolean).map(String) : []);
  set("series_seasons", cleanSeriesSeasons(body.series_seasons, out.series_ids));
  // Which column the sheet is ordered and placed by — the outright best lap, or
  // the average. Stored so re-opening a trial reads the way it was left.
  set("sort_key", body.sort_key === "average" ? "average" : "best");
  set("status", body.status === TRIAL_STATUS_COMPLETED ? TRIAL_STATUS_COMPLETED : TRIAL_STATUS_OPEN);
  // The averaging window depends on the lap cap, so it is resolved against
  // whichever cap this write ends up storing.
  set("average_laps", normalizeAverageLaps(body.average_laps, out.max_laps));
  return out;
}

export async function fetchTrial(id) {
  const doc = await db().collection(TRIAL_COLLECTION).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// A trial's drivers, laps included, in the order the sheet was last saved in
// (`position`, stamped on save). The screen re-ranks them by time; this is the
// stable underlying order, so re-opening a sheet reads the way it was left
// rather than in whatever order the database hands the documents back.
export async function fetchTrialEntries(trialId) {
  const snap = await db().collection(TRIAL_ENTRY_COLLECTION).where("time_trial_id", "==", trialId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (Number(a.position ?? 0) - Number(b.position ?? 0)) ||
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.id).localeCompare(String(b.id)));
}

// The season's classes, for resolving the name a placement stamps onto a
// driver. Names matter because a track record keys on the class NAME (a class
// doc belongs to one season, a venue's history spans seasons) — see
// lib/trackRecords.js.
export async function fetchClassNames(seasonId) {
  if (!seasonId) return {};
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data().name || ""]));
}

// The same, across every season a trial can place into — its own, plus the
// season behind each series it sorts drivers into. One flat id → name map: a
// class doc belongs to exactly one season, so the ids can't collide.
export async function fetchClassNamesForSeasons(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return {};
  const maps = await Promise.all(ids.map(fetchClassNames));
  return Object.assign({}, ...maps);
}

// Series id → name, for the label a series placement denormalizes onto a row.
export async function fetchSeriesNames(seriesIds = []) {
  const ids = [...new Set(seriesIds.filter(Boolean))];
  if (!ids.length) return {};
  const docs = await Promise.all(ids.map(id => db().collection("series").doc(id).get()));
  return Object.fromEntries(docs.filter(d => d.exists).map(d => [d.id, d.data().name || ""]));
}

// Every season a trial's placements can write a roster into: its own, plus the
// one behind each series it places into.
export function targetSeasonIds(trial = {}) {
  return [...new Set([trial.season_id, ...Object.values(trial.series_seasons || {})].filter(Boolean))];
}

// ── Track Records ───────────────────────────────────────────────────────────
//
// A time trial IS a lap around a venue, so its laps belong in that venue's
// record books even though the session counts toward no racing statistic. This
// hands lib/trackStatsServer.js one candidate per driver — their fastest lap of
// the session — in the same shape a race lap arrives in, so the existing
// "keep the fastest" rules do the rest without knowing where the lap came from.
//
// Matched to the venue exactly as races are: by `track_id`, plus legacy/free
// text trials that only named the track.
export async function fetchTrackRecordLaps({ trackId, trackName, leagueId = "" }) {
  const wantedName = String(trackName || "").trim();
  const queries = [scopeByLeague(db().collection(TRIAL_COLLECTION).where("track_id", "==", trackId), leagueId).get()];
  if (wantedName) {
    queries.push(scopeByLeague(db().collection(TRIAL_COLLECTION).where("track", "==", wantedName), leagueId).get());
  }
  const snaps = await Promise.all(queries);

  const trialsById = new Map();
  for (const d of snaps[0].docs) trialsById.set(d.id, { id: d.id, ...d.data() });
  if (snaps[1]) {
    for (const d of snaps[1].docs) {
      const data = d.data();
      // A trial pinned to a DIFFERENT venue's id must not be folded in by name.
      if (!data.track_id) trialsById.set(d.id, { id: d.id, ...data });
    }
  }
  if (!trialsById.size) return [];

  const entrySnaps = await Promise.all(
    [...trialsById.keys()].map(id => db().collection(TRIAL_ENTRY_COLLECTION).where("time_trial_id", "==", id).get())
  );

  const laps = [];
  for (const snap of entrySnaps) {
    for (const doc of snap.docs) {
      const entry = { id: doc.id, ...doc.data() };
      const trial = trialsById.get(entry.time_trial_id);
      if (!trial) continue;
      const [summary] = summarizeEntries([entry]);
      if (summary.best_seconds == null) continue;
      laps.push({
        seconds: summary.best_seconds,
        time: summary.best_time,
        driver_name: entry.name || "Unknown",
        driver_id: entry.driver_id || null,
        user_id: entry.user_id || null,
        game_id: trial.game_id || null,
        // A driver placed into a series belongs to THAT series for the purpose
        // of scoping this lap — a Pro Series placement lap is a Pro Series lap,
        // and the venue's records narrow by the same Series/Season dropdowns
        // every other record does. Falls back to the trial's own scope for an
        // ordinary (class-placement or plain hot-lap) session.
        series_id: entry.assigned_series_id || trial.series_id || null,
        season_id: (entry.assigned_series_id && trial.series_seasons?.[entry.assigned_series_id])
          || trial.season_id || null,
        // A trial's class is the one the driver was PLACED in (a placement
        // night) or entered under. Blank leaves the lap out of the per-class
        // breakdown, exactly as an unclassified race lap is.
        class_name: entry.assigned_class_name || "",
        // Rendered on the record card the same way a race lap's is.
        race_id: null,
        race_name: trial.name || TRIAL_SESSION_LABEL,
        session: TRIAL_SESSION_LABEL,
        from_qualifying: false,
        from_time_trial: true,
        time_trial_id: trial.id,
        date: trial.date || null,
        lap: summary.best_lap,
      });
    }
  }
  return laps;
}

// Entry payload as it is stored. Laps are capped by the session's own limit, so
// a sheet can't carry more laps than the session allows even if the request
// says otherwise.
export function trialEntryDoc(row, {
  trialId, maxLaps, classNames = {}, seriesNames = {}, leagueId = "", position = 0,
}) {
  const assignedClassId = String(row.assigned_class_id ?? "").trim();
  const assignedSeriesId = String(row.assigned_series_id ?? "").trim();
  return {
    time_trial_id: trialId,
    ...(leagueId ? { league_id: leagueId } : {}),
    // The sheet's own row order, so it re-opens as it was left.
    position,
    name: String(row.name ?? "").trim(),
    number: row.number == null ? "" : String(row.number).trim().slice(0, 3),
    driver_id: String(row.driver_id ?? "").trim(),
    user_id: String(row.user_id ?? "").trim(),
    // The roster entry this driver came from, when they came from one. It is a
    // convenience for the export, never an identity: a trial can be run for
    // drivers who are on no roster at all yet — that is what a placement night
    // is for.
    entry_id: String(row.entry_id ?? "").trim(),
    // The registration that put this row on the sheet, when it was pooled from
    // the Placements Queue ("Import from Placements Queue"). A trace, never an
    // identity: the queue is cleared by matching the PERSON, so a driver typed
    // onto the sheet by hand is placed exactly as one imported is.
    signup_request_id: String(row.signup_request_id ?? "").trim(),
    laps: normalizeLaps(row.laps, maxLaps),
    assigned_class_id: assignedClassId,
    // Denormalized so a lap can be filed under its class in the record books
    // without re-reading the season's classes (and so a record survives the
    // class doc being deleted later).
    assigned_class_name: assignedClassId ? (classNames[assignedClassId] || "") : "",
    // The series this driver was placed into, when the night sorts into series
    // rather than (or as well as) classes. It decides which season's roster
    // their entry is written to — see targetSeasonFor in lib/timeTrials.js.
    assigned_series_id: assignedSeriesId,
    assigned_series_name: assignedSeriesId ? (seriesNames[assignedSeriesId] || "") : "",
    notes: String(row.notes ?? "").trim(),
  };
}
