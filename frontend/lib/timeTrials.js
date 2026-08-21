// Time Trials & Placements — the rules of a hot-lapping session.
//
// A Time Trial is NOT a race. Nobody finishes ahead of anybody; every driver
// simply submits a list of laps, and the sheet is ordered by what those laps
// say. That difference is the whole reason this lives in its own collection
// rather than as another `results` session type:
//
//   • A time trial scores no championship points, wins nothing, and counts
//     toward NO standard statistic (Wins, Top 5s, Average Finish, titles…).
//     The stats engine reads `results`; a trial's laps are never written there,
//     so there is nothing to exclude and nothing that can leak in by accident.
//   • Its laps ARE eligible for the Track Records database — a hot lap is a hot
//     lap, whoever turned it and whatever session it came from. See
//     trackRecordLapsFrom below, which hands them to lib/trackCompute.js.
//
// The one bridge between the two worlds is deliberate and admin-driven: the
// "Export to Qualifying" action copies a trial's best laps onto a real race's
// Qualifying session, at which point they are ordinary qualifying results and
// behave exactly like hand-entered ones.
//
// Kept dependency-free apart from the shared clock parser so every rule below
// can be exercised without a database or a browser.

import { formatTime, parseTime } from "@/lib/raceTime";

// ── Session settings ────────────────────────────────────────────────────────

// "Maximum Laps" — how many laps a driver may submit. 0 (the default) is
// infinite: an open hot-lapping session where drivers keep going until the
// window closes. Anything above it caps the lap inputs on the entry grid.
export const LAPS_UNLIMITED = 0;
// A sane ceiling so a typo ("1000") can't render ten thousand inputs.
export const MAX_LAPS_CAP = 100;

export function normalizeMaxLaps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LAPS_UNLIMITED;
  return Math.min(Math.floor(n), MAX_LAPS_CAP);
}

// "Best Average Time" needs to say WHICH laps it averages, or the column means
// something different on every sheet. Two readings are both legitimate, so the
// session says which one it uses:
//
//   0 (the default) — the average of EVERY lap the driver submitted. The
//     consistency measure: one scruffy lap drags it down, which is exactly what
//     a placement session wants to know.
//   N — the best average of any N CONSECUTIVE laps ("best 3-lap average"), the
//     classic time-attack measure. A driver with fewer than N laps has none.
//
// Capped by the session's own lap limit where there is one — averaging five
// laps in a three-lap session would give every driver a blank column.
export const AVERAGE_ALL_LAPS = 0;

export function normalizeAverageLaps(value, maxLaps = LAPS_UNLIMITED) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 1) return AVERAGE_ALL_LAPS;
  const cap = normalizeMaxLaps(maxLaps);
  const window = Math.min(Math.floor(n), MAX_LAPS_CAP);
  return cap ? Math.min(window, cap) : window;
}

export function averageLabel(averageLaps) {
  const n = normalizeAverageLaps(averageLaps);
  return n ? `Best ${n}-Lap Avg` : "Best Average Time";
}

// ── Laps ────────────────────────────────────────────────────────────────────

// A driver's laps are stored as the clock strings an admin typed ("1:23.456"),
// not as parsed numbers: the text is what was on the timing screen, and a
// value that doesn't parse is kept rather than silently dropped so it can be
// seen and corrected instead of vanishing on save.
export function normalizeLaps(value, maxLaps = LAPS_UNLIMITED) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list.map(v => String(v ?? "").trim());
  // Trailing blanks are the empty inputs at the bottom of the grid — never a
  // lap. Blanks BETWEEN laps are kept, so lap 3 stays lap 3 when lap 2 is
  // missing.
  while (cleaned.length && !cleaned[cleaned.length - 1]) cleaned.pop();
  const cap = normalizeMaxLaps(maxLaps);
  return cap ? cleaned.slice(0, cap) : cleaned;
}

// What a typed lap is worth in seconds, or null when it is not a lap at all.
//
// The clock parser is deliberately permissive — it has to accept "1:23.456",
// "83.456" and "1:02:03.004" from whatever a timing screen prints — so this is
// where a time trial draws the line, and it draws it at "a lap somebody
// actually turned":
//
//   • 0 is not a lap. "0", "00:00.000" and "0:00" all parse to a legitimate
//     zero, and a zero would win Best Time outright AND stand as the venue's
//     track record, unbeatable, from one slip of the keyboard.
//   • Infinity is not a lap. "Infinity" and "1e400" both survive Number(), and
//     rendered straight back out they read "Infinity:NaN:NaN.NaN".
//
// Neither is a crash, which is exactly what makes them worth catching here:
// they look like data. A rejected lap keeps its text on the sheet and is shown
// as unreadable, so it can be corrected rather than silently disappearing.
export function lapSeconds(text) {
  const seconds = parseTime(text);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Every lap as { lap, text, seconds } — `lap` is the 1-based number shown on
// the sheet, `seconds` null for a blank or unusable entry.
export function lapRows(laps) {
  return normalizeLaps(laps).map((text, i) => ({ lap: i + 1, text, seconds: lapSeconds(text) }));
}

// The driver's single quickest lap. Ties keep the EARLIER lap — the first time
// it was set is when the record was set, the same rule the track records use.
export function bestLap(laps) {
  let best = null;
  for (const row of lapRows(laps)) {
    if (row.seconds == null) continue;
    if (best == null || row.seconds < best.seconds) best = row;
  }
  return best ? { lap: best.lap, seconds: best.seconds, time: formatTime(best.seconds) } : null;
}

// The average lap time, per the session's `averageLaps` window (see above).
// Returns null when there aren't enough timed laps to answer.
export function bestAverage(laps, averageLaps = AVERAGE_ALL_LAPS) {
  const window = normalizeAverageLaps(averageLaps);
  const timed = lapRows(laps).filter(r => r.seconds != null);
  if (!timed.length) return null;

  if (!window) {
    const total = timed.reduce((sum, r) => sum + r.seconds, 0);
    const seconds = total / timed.length;
    return { seconds, time: formatTime(seconds), count: timed.length, from: timed[0].lap, to: timed[timed.length - 1].lap };
  }

  // Consecutive means consecutive on the timing sheet: a driver who set laps
  // 1, 2 and 4 has no 3-lap run through the gap, since the missing lap is a lap
  // that wasn't completed. Runs are taken from the timed laps in lap order,
  // requiring their numbers to be adjacent.
  if (timed.length < window) return null;
  let best = null;
  for (let i = 0; i + window <= timed.length; i++) {
    const run = timed.slice(i, i + window);
    if (run[run.length - 1].lap - run[0].lap !== window - 1) continue;
    const seconds = run.reduce((sum, r) => sum + r.seconds, 0) / window;
    if (best == null || seconds < best.seconds) {
      best = { seconds, time: formatTime(seconds), count: window, from: run[0].lap, to: run[run.length - 1].lap };
    }
  }
  return best;
}

// ── The sheet ───────────────────────────────────────────────────────────────

// One driver's row, decorated with everything the table renders and sorts on.
// `best_lap` is the lap NUMBER of their quickest lap, which is what the grid
// bolds — the highlight is derived here rather than in the markup so the sheet,
// the expanded lap list and the export all agree on which lap it is.
export function summarizeEntry(entry, { averageLaps = AVERAGE_ALL_LAPS } = {}) {
  const laps = normalizeLaps(entry?.laps);
  const best = bestLap(laps);
  const avg = bestAverage(laps, averageLaps);
  const timed = lapRows(laps).filter(r => r.seconds != null);
  return {
    ...entry,
    laps,
    laps_run: laps.length,
    laps_timed: timed.length,
    best_lap: best?.lap ?? null,
    best_seconds: best?.seconds ?? null,
    best_time: best?.time ?? null,
    avg_seconds: avg?.seconds ?? null,
    avg_time: avg?.time ?? null,
    avg_laps_counted: avg?.count ?? 0,
  };
}

export function summarizeEntries(entries = [], opts = {}) {
  return entries.map(e => summarizeEntry(e, opts));
}

// Sort key → the field it reads. "best" is the outright quickest lap; "average"
// the average column. Both are lower-is-better, and a driver with no time at
// all sorts to the bottom whichever way the column is pointed — an empty row is
// never "the fastest", and never blocks the view of the real order.
const SORT_FIELDS = { best: "best_seconds", average: "avg_seconds" };

export function rankEntries(rows = [], { key = "best", asc = true } = {}) {
  const field = SORT_FIELDS[key] || SORT_FIELDS.best;
  return [...rows].sort((a, b) => {
    const av = a[field], bv = b[field];
    if (av == null && bv == null) return String(a.name || "").localeCompare(String(b.name || ""));
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return String(a.name || "").localeCompare(String(b.name || ""));
    return asc ? av - bv : bv - av;
  });
}

// Positions for a ranked sheet: 1, 2, 3… over the drivers who set a time, and
// no position at all for those who didn't. Used by the export to Qualifying,
// which must not put a driver with no lap on the grid ahead of one who ran.
export function placedOrder(rows = [], { key = "best" } = {}) {
  const field = SORT_FIELDS[key] || SORT_FIELDS.best;
  return rankEntries(rows, { key, asc: true })
    .filter(r => r[field] != null)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

// ── Which sessions belong to the scope being viewed ─────────────────────────
//
// The hub narrows to the Game / Series / Season the top bar is on. A trial is
// not a race, though, and the difference matters here: a placement night is
// routinely run BEFORE the season it feeds exists, so it names no season — and
// a night that sorts drivers into several series belongs to all of them, not to
// the one it happens to have been created under.
//
// So a trial is in scope when it either names that level and matches, or names
// nothing at that level at all. Dropping the unattached ones would hide exactly
// the sessions this feature exists for, which is precisely what happened.
export function trialMatchesScope(trial = {}, { gameId = "", seriesId = "", seasonId = "" } = {}) {
  // Every series/season this night touches, not just the one it was created
  // under: the series it places into, and the seasons those build rosters in.
  const seriesSeasons = trial.series_seasons || {};
  const seriesIds = [trial.series_id, ...(trial.series_ids || [])].filter(Boolean);
  const seasonIds = [trial.season_id, ...Object.values(seriesSeasons)].filter(Boolean);

  // "Names nothing here" is in scope; "names something else" is not.
  const matches = (wanted, held) => !wanted || !held.length || held.includes(wanted);

  return matches(gameId, [trial.game_id].filter(Boolean))
    && matches(seriesId, seriesIds)
    && matches(seasonId, seasonIds);
}

// ── Placements ──────────────────────────────────────────────────────────────
//
// A division is not always a class. Plenty of leagues run their divisions as
// separate SERIES — a Pro Series and an Amateur Series, each with its own
// seasons, schedule and championship — rather than as classes inside one
// season. A placement night has to be able to sort a field into either, so a
// trial carries two independent placement targets:
//
//   • `series_ids`  — the series to place into. Each names the season whose
//                     roster it builds (`series_seasons`), because a roster
//                     belongs to a season, not to a series.
//   • `class_ids`   — the classes to place into, inside whichever season a
//                     driver's row ends up targeting.
//
// They compose rather than compete: a driver placed into the Pro Series can
// still be placed into GT3 *within it*, and a league that runs classes alone
// simply never picks a series (which is exactly what every trial did before
// series placement existed).

// Split the ranked field evenly across N buckets, fastest first: with 11
// drivers and 3 buckets the top 4 go to the first, then 4, then 3 — the
// remainder always lands on the quicker end, which is how a placement night is
// actually run (nobody wants the slow division to be the big one).
//
// Only drivers with a time are placed. Somebody who never set a lap keeps
// whatever they already had — a blank sheet is not evidence of pace, and the
// admin can assign them by hand.
export function splitEvenly(rows = [], ids = [], { key = "best", keyOf = row => row.id } = {}) {
  const buckets = ids.filter(Boolean);
  const assignment = {};
  if (!buckets.length) return assignment;
  const ranked = placedOrder(rows, { key });
  if (!ranked.length) return assignment;

  const per = Math.floor(ranked.length / buckets.length);
  const extra = ranked.length % buckets.length;
  let i = 0;
  buckets.forEach((id, group) => {
    const size = per + (group < extra ? 1 : 0);
    for (let n = 0; n < size && i < ranked.length; n++, i++) {
      assignment[keyOf(ranked[i])] = id;
    }
  });
  return assignment;
}

// Sort the field into classes / divisions.
export function autoAssignClasses(rows = [], classIds = [], opts = {}) {
  return splitEvenly(rows, classIds, opts);
}

// Sort the field into separate SERIES — the same even split, for the leagues
// whose divisions are series rather than classes.
export function autoAssignSeries(rows = [], seriesIds = [], opts = {}) {
  return splitEvenly(rows, seriesIds, opts);
}

// Sort into classes *within* each series, for a trial doing both at once.
// The split runs once per series over only that series' drivers, so the top of
// the Pro Series fills Pro Series' first division rather than the whole field's
// fastest drivers taking every quick division across every series.
//
// `classIdsFor(seriesId)` supplies the classes available in the season that
// series is placing into — they belong to that season, so they differ per
// series and can't be one shared list.
export function autoAssignClassesWithinSeries(rows = [], classIdsFor, { key = "best", keyOf = row => row.id } = {}) {
  const bySeries = new Map();
  for (const row of rows) {
    const seriesId = row.assigned_series_id || "";
    if (!bySeries.has(seriesId)) bySeries.set(seriesId, []);
    bySeries.get(seriesId).push(row);
  }
  const assignment = {};
  for (const [seriesId, group] of bySeries) {
    Object.assign(assignment, splitEvenly(group, classIdsFor(seriesId) || [], { key, keyOf }));
  }
  return assignment;
}

// The season whose roster a row's placement builds: the season behind the
// series they were placed into, else the trial's own season. This is the one
// rule that decides where a driver's roster entry is written, and the same one
// decides which season's classes their Division cell may offer — so the class
// stamped on an entry always exists in the season that entry lives in.
export function targetSeasonFor(row = {}, { trialSeasonId = "", seasonBySeries = {} } = {}) {
  const seriesId = row.assigned_series_id || "";
  return (seriesId && seasonBySeries[seriesId]) || trialSeasonId || "";
}

// The sheet grouped by the season each row's roster entry belongs to. A trial
// placing into three series builds three rosters, so the roster run works one
// season at a time. Rows with no resolvable season (a series with no season
// picked, on a trial not attached to one) collect under "" and are reported
// rather than written anywhere.
export function groupByTargetSeason(rows = [], opts = {}) {
  const groups = new Map();
  for (const row of rows) {
    const seasonId = targetSeasonFor(row, opts);
    if (!groups.has(seasonId)) groups.set(seasonId, []);
    groups.get(seasonId).push(row);
  }
  return groups;
}

// How the placement result reads back: class id -> the drivers assigned to it,
// in their ranked order. Drivers with no class land under "" (unassigned), so
// the screen can show who still needs a division before the roster is built.
export function groupByAssignedClass(rows = [], { key = "best" } = {}) {
  const groups = new Map();
  for (const row of rankEntries(rows, { key, asc: true })) {
    const classId = row.assigned_class_id || "";
    if (!groups.has(classId)) groups.set(classId, []);
    groups.get(classId).push(row);
  }
  return groups;
}

// ── Roster generation ───────────────────────────────────────────────────────

// What a "Complete Session → build the roster" run would do to a season's
// roster, decided before anything is written.
//
// Identity is matched the way the rest of the app matches drivers: the global
// driver_id first, then the linked account, then the lowercased name (see
// lib/rosterImport.js). A driver already on the roster is UPDATED — their class
// is set to the one the trial placed them in — rather than duplicated, so the
// action is safe to run twice and safe to re-run after re-sorting the field.
//
// `rows` are the trial's drivers (each with an `assigned_class_id`), `existing`
// the season's current entries. `requireClass` is the placement rule: on a
// placement session a driver with no division assigned is left alone entirely
// (there is nothing to place them into yet), while an ordinary trial can still
// push its field onto the roster unclassified. It may be a function of the row
// rather than one answer for the sheet, which is what a night placing into
// SERIES needs: a driver sorted into the Pro Series has been placed — the
// series is their division — whether or not they also drew a class inside it.
// Returns { create, update, skipped, placed }:
//   create  — payload fields for a new roster entry
//   update  — { id, class_id, class_ids } patches for entries already there
//   skipped — everyone the run deliberately leaves untouched, and why
//   placed  — the source ROWS that end this run with a roster spot, which is
//             not the same list as create + update. A driver already in the
//             division the trial placed them in is "skipped" (there is nothing
//             to write) and is still on the roster; so is the second row of a
//             duplicated pair. The Placements Queue clears against this, and
//             "we didn't write anything for them" is the wrong reason to leave
//             somebody queued for a session they have already raced.
export function identityKeys(row) {
  const keys = [];
  if (row.driver_id) keys.push(`d:${row.driver_id}`);
  if (row.user_id) keys.push(`u:${row.user_id}`);
  const name = String(row.name || "").trim().toLowerCase();
  if (name) keys.push(`n:${name}`);
  return keys;
}

// Every roster entry reachable by any of its identity keys, so a trial row can
// be looked up however it happens to name the driver. Built once and asked many
// times — an export walks the whole sheet.
export function entryIndex(entries = []) {
  const index = new Map();
  for (const entry of entries) {
    for (const k of identityKeys(entry)) if (!index.has(k)) index.set(k, entry);
  }
  return index;
}

// The roster entry a trial row belongs to, or null when the driver isn't on
// that roster at all. Never guesses: a near-miss on a name is a different
// person as far as this is concerned, and the caller reports it so the admin
// can add them rather than filing a lap against the wrong driver.
export function matchEntry(row, index) {
  for (const k of identityKeys(row)) {
    const found = index.get(k);
    if (found) return found;
  }
  return null;
}

export function planRosterBuild(rows = [], existing = [], { requireClass = false } = {}) {
  const needsClass = typeof requireClass === "function" ? requireClass : () => !!requireClass;
  // Every existing entry, reachable by any of its identity keys.
  const byKey = new Map();
  for (const entry of existing) {
    for (const k of identityKeys(entry)) if (!byKey.has(k)) byKey.set(k, entry);
  }

  const create = [];
  const update = [];
  const skipped = [];
  const placed = [];
  const claimed = new Set();

  for (const row of rows) {
    const keys = identityKeys(row);
    if (!keys.length) { skipped.push({ name: row.name || "", reason: "no name" }); continue; }
    // Two rows for the same person in one trial (a duplicate entry) resolve to
    // one roster change, not two. The person is still placed — the row that
    // claimed those keys is the one that landed.
    if (keys.some(k => claimed.has(k))) {
      skipped.push({ name: row.name || "", reason: "duplicate" });
      placed.push(row);
      continue;
    }
    const classId = row.assigned_class_id || "";
    if (!classId && needsClass(row)) { skipped.push({ name: row.name || "", reason: "no class assigned" }); continue; }
    for (const k of keys) claimed.add(k);
    // Past both refusals: this row gets a roster spot, whether that takes a
    // create, an update, or nothing at all because it is already right.
    placed.push(row);

    const found = keys.map(k => byKey.get(k)).find(Boolean);
    if (found) {
      // Already on the roster. Only the class is touched — their car number,
      // team and locked-in car are the season's business, not the trial's — and
      // only when the trial actually placed them somewhere new.
      if (classId && found.class_id !== classId) {
        update.push({ id: found.id, name: found.name ?? row.name ?? "", class_id: classId, class_ids: [classId] });
      } else {
        skipped.push({ name: found.name ?? row.name ?? "", reason: classId ? "already in that class" : "no class assigned" });
      }
      continue;
    }

    create.push({
      name: String(row.name || "").trim(),
      ...(row.number != null && String(row.number).trim() !== "" ? { number: String(row.number).trim() } : {}),
      ...(row.driver_id ? { driver_id: row.driver_id } : {}),
      ...(row.user_id ? { user_id: row.user_id } : {}),
      class_id: classId,
      class_ids: classId ? [classId] : [],
      team_id: "",
    });
  }

  return { create, update, skipped, placed };
}

// ── Export to Qualifying ────────────────────────────────────────────────────

// The qualifying grid a trial produces: fastest lap = pole, in order, with each
// driver's best lap as their qualifying time. Drivers who set no lap are left
// off entirely rather than filling the back of the grid with empty rows.
//
// `entryIdFor` resolves a trial row to the target season's roster entry id —
// the trial and the race can be in different seasons, and a result is only ever
// filed against a roster entry. Rows it can't resolve are reported rather than
// dropped silently, so the admin is told who needs adding to the roster first.
export function planQualifyingExport(rows = [], entryIdFor, { key = "best" } = {}) {
  const grid = [];
  const unmatched = [];
  for (const row of placedOrder(rows, { key })) {
    const entryId = entryIdFor(row);
    if (!entryId) { unmatched.push(row.name || "Unknown"); continue; }
    grid.push({
      entry_id: entryId,
      finish_pos: grid.length + 1,
      qual_time: key === "average" ? row.avg_time : row.best_time,
      // The lap itself is the driver's fastest of the session either way — the
      // Best Average column only decides the ORDER, never what time is filed
      // as the lap they set.
      fastest_lap_time: row.best_time || null,
      name: row.name || "",
    });
  }
  return { grid, unmatched };
}

// ── Track Records ───────────────────────────────────────────────────────────
//
// A time trial IS a lap around a venue, so its laps belong in that venue's
// record books even though the session counts toward no racing statistic. This
// turns a set of trials and their entries into one candidate per driver — their
// fastest lap of the session — in the same shape a race lap arrives in, so the
// venue's "keep the fastest" rules do the rest without knowing where a lap came
// from.
//
// Matched to the venue exactly as races are: by `track_id`, plus legacy/free
// text trials that only named the track. Pure, so the venue page can run it in
// the browser over a raw bundle; lib/timeTrialsServer.js feeds it from Firestore
// for anything still server-side.
export const TRIAL_SESSION_LABEL = "Time Trial";

export function trackRecordLapsFrom({ trials = [], entries = [], trackId, trackName }) {
  const wantedName = String(trackName || "").trim();
  const trialsById = new Map();
  for (const t of trials) {
    if (t.track_id === trackId) trialsById.set(t.id, t);
    // A trial pinned to a DIFFERENT venue's id must not be folded in by name.
    else if (wantedName && !t.track_id && t.track === wantedName) trialsById.set(t.id, t);
  }
  if (!trialsById.size) return [];

  const laps = [];
  for (const entry of entries) {
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
      // A driver placed into a series belongs to THAT series for the purpose of
      // scoping this lap — a Pro Series placement lap is a Pro Series lap, and
      // the venue's records narrow by the same Series/Season dropdowns every
      // other record does. Falls back to the trial's own scope for an ordinary
      // (class-placement or plain hot-lap) session.
      series_id: entry.assigned_series_id || trial.series_id || null,
      season_id: (entry.assigned_series_id && trial.series_seasons?.[entry.assigned_series_id])
        || trial.season_id || null,
      // A trial's class is the one the driver was PLACED in (a placement night)
      // or entered under. Blank leaves the lap out of the per-class breakdown,
      // exactly as an unclassified race lap is.
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
  return laps;
}
