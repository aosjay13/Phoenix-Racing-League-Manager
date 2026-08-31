// The Placements Queue: everybody who has been approved for a placement-graded
// tier and is on no roster yet.
//
// A sign-up into a tier marked "Placements Required" is approved into a
// PLACEMENT rather than onto a grid — status `approved_for_placements`, no
// roster entry, nothing else changed (see lib/signupQueue.js). That is the
// whole point of the gate, and it leaves three jobs that this module is the
// rules for:
//
//   • LIST them.    Who is waiting, for which series/season/class, and how
//                   long have they been waiting? — the Placement Roster on
//                   /approvals (components/AwaitingPlacements.jsx).
//   • POOL them.    A placement night ticks its destinations ("Gold Series",
//                   "Silver Series"), and everybody in the queue who signed up
//                   for any of them belongs on that one sheet — one session,
//                   the whole field, sorted together. That's
//                   "Import from Placements Queue".
//   • CLEAR them.   Once the night's board has been turned into rosters, the
//                   people it placed are racing. Leaving them in the queue
//                   would have the next admin run a second session for drivers
//                   who already have a grid slot.
//
// Pure — no React, no Firestore — so the panel that lists the queue, the button
// that pools it and the roster run that clears it can never disagree about who
// is in it (see lib/__tests__/placementQueue.test.mjs).

import { isNumberChange } from "@/lib/signupQueue";
import { identityKeys } from "@/lib/timeTrials";

// ── Who a queue row is about ───────────────────────────────────────────────
//
// A queue row names its person three ways and any of them can be missing: the
// driver profile (absent until the approval creates one — though by this state
// it always has), the account, and the name they race under. Mapped onto the
// same shape a trial row uses so ONE identity rule (lib/timeTrials.js) decides
// "is this the same person?" everywhere — the sheet, the roster build and this.
export function queuePerson(row = {}) {
  return {
    driver_id: row.driver_id || "",
    user_id: row.user_id || row.uid || "",
    name: row.name || row.driver_name || "",
  };
}

// Every key this person can be recognised by. Empty for a row that names
// nobody, which is what stops a blank row matching another blank row.
export function queueIdentityKeys(row = {}) {
  return identityKeys(queuePerson(row));
}

function keySet(rows = [], keysOf = identityKeys) {
  const out = new Set();
  for (const row of rows) for (const k of keysOf(row)) out.add(k);
  return out;
}

// ── Where a placement night is sending people ──────────────────────────────
//
// The destinations an admin ticked, as the three ids a queue row can be matched
// on. A league's divisions are series for some leagues and classes for others,
// and a session can place into both at once — so all three are read, and a row
// matching ANY of them belongs on the sheet.
//
// `season_ids` covers both halves of that: the session's own season (whose
// classes it sorts into) and the season behind each series it places into. A
// driver who signed up for the Gold Series' current season is pooled by that
// alone, even when the sign-up predates the classes this night uses.
export function trialDestinations(trial = {}) {
  return {
    series_ids: [...new Set((trial.series_ids || []).filter(Boolean).map(String))],
    season_ids: [...new Set([
      trial.season_id,
      ...Object.values(trial.series_seasons || {}),
    ].filter(Boolean).map(String))],
    class_ids: [...new Set((trial.class_ids || []).filter(Boolean).map(String))],
  };
}

// Has this session been told where it's sending people yet?
//
// It matters because of what the answer "no" must NOT do. A session with
// nothing ticked has no destinations to match against, and a matcher that
// treats "no filter" as "everything" would pool the entire league's waiting
// drivers onto one sheet on a single click. So an empty destination set matches
// NOBODY, and the button says to pick destinations first.
export function hasDestinations(dest = {}) {
  return !!(dest.series_ids?.length || dest.season_ids?.length || dest.class_ids?.length);
}

// Is this waiting driver one of the people this session is being run for?
//
// True when what they signed up for is any of the destinations ticked — their
// series, their season, or any class they asked for. Deliberately generous
// across the three: an admin who ticks "Gold Series" means "everybody waiting
// on Gold", however the sign-up happens to name it.
export function queueRowMatchesDestinations(row, dest = {}) {
  if (!row || !hasDestinations(dest)) return false;
  // A number change is a driver already racing — there is never anything to
  // place them into, and one should never reach this state anyway.
  if (isNumberChange(row)) return false;
  const seriesId = String(row.series_id || "");
  const seasonId = String(row.season_id || "");
  if (seriesId && (dest.series_ids || []).includes(seriesId)) return true;
  if (seasonId && (dest.season_ids || []).includes(seasonId)) return true;
  return (row.class_ids || []).map(String).some(id => (dest.class_ids || []).includes(id));
}

export function matchingQueueRows(rows = [], dest = {}) {
  return rows.filter(row => queueRowMatchesDestinations(row, dest));
}

// ── Pooling them onto the sheet ────────────────────────────────────────────

// One waiting driver as a row on a placement sheet.
//
// They arrive with no laps and NO division: which one they belong in is the
// question the night exists to answer, and pre-filling it from the class they
// asked for would open the board fully placed with nothing left to sort.
//
// `signup_request_id` is the thread back to the queue. The clear-up below
// matches on the person rather than on this (so a driver added to the sheet by
// hand is cleared too), but carrying it means a row can always be traced to the
// registration that put it there.
export function queueRowToSheetRow(row = {}) {
  const person = queuePerson(row);
  return {
    name: person.name,
    // What the sheet and the board SHOW, which for a night that isn't iRacing's
    // is never an iRacing real name (see lib/iracingPrivacy.js). The stored
    // `name` above is untouched — it is what a save writes back.
    display_name: row.display_name || person.name,
    driver_id: person.driver_id,
    user_id: person.user_id,
    number: row.number ?? "",
    signup_request_id: row.id || "",
    assigned_class_id: "",
    assigned_series_id: "",
  };
}

// "Import from Placements Queue", decided before anything is added.
//
// Everybody waiting on one of this session's destinations, minus everybody
// already on the sheet — importing twice is a no-op rather than a second row
// for the same driver, which matters because the obvious way to use the button
// is to press it again after approving a few more registrations.
//
// `already` is reported rather than silently dropped: "Imported 4 drivers, 11
// were already on the sheet" is the sentence that tells an admin the button
// worked when it appears to have done nothing.
export function importFromQueuePlan(queueRows = [], sheetRows = [], dest = {}) {
  const onSheet = keySet(sheetRows);
  const add = [];
  const already = [];
  const claimed = new Set();

  for (const row of matchingQueueRows(queueRows, dest)) {
    const keys = queueIdentityKeys(row);
    if (!keys.length) continue;
    if (keys.some(k => onSheet.has(k))) { already.push(row.display_name || row.name || "Driver"); continue; }
    // Two registrations for one person (two seasons, both being placed tonight)
    // are one driver on the sheet.
    if (keys.some(k => claimed.has(k))) { already.push(row.display_name || row.name || "Driver"); continue; }
    for (const k of keys) claimed.add(k);
    add.push(queueRowToSheetRow(row));
  }

  return { add, already };
}

// ── Clearing them once they've been placed ─────────────────────────────────

// The registrations a completed roster run has answered: the waiting drivers
// who were placed by THIS session, and who therefore now have a roster spot.
//
// Two conditions, both required:
//
//   • the row is one of this session's destinations — so a driver's unrelated
//     registration, in another game, is left exactly where it is; and
//   • the person landed on a roster in this run (`placedRows` — see
//     planRosterBuild, which reports precisely who did).
//
// Matched on the PERSON, not on the import link: an admin who typed a waiting
// driver onto the sheet by hand, or imported them before a name was tidied up,
// has still placed them, and the queue must not keep claiming otherwise.
export function queueRowsPlacedBy(queueRows = [], placedRows = [], dest = {}) {
  const placed = keySet(placedRows);
  if (!placed.size) return [];
  return matchingQueueRows(queueRows, dest)
    .filter(row => queueIdentityKeys(row).some(k => placed.has(k)));
}

// ── The Placement Roster's filters ─────────────────────────────────────────
//
// The queue is league-wide and a placement night is not: the question an admin
// actually has is "who is waiting for the season I am about to run?". These
// drive the Game ▸ Series ▸ Season dropdowns above the roster, and they are
// built from the QUEUE rather than from the league's full hierarchy on purpose
// — a menu of seasons nobody is waiting for is a menu of dead ends.

// The distinct values of one denormalized (id, name) pair across the queue,
// named and sorted. A row missing the id is skipped rather than becoming a
// blank option.
function options(rows, idKey, nameKey, fallback) {
  const seen = new Map();
  for (const row of rows) {
    const id = String(row?.[idKey] || "");
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, name: row?.[nameKey] || fallback });
  }
  return [...seen.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// The three menus, each narrowed by the one above it — picking a game leaves
// only that game's series, and picking a series only its seasons. A filter
// whose parent has moved on is dropped by `applyQueueFilters` below rather than
// leaving the roster showing nothing with no visible reason why.
export function queueFilterOptions(rows = [], { game_id = "", series_id = "" } = {}) {
  const byGame = game_id ? rows.filter(r => String(r.game_id || "") === game_id) : rows;
  const bySeries = series_id ? byGame.filter(r => String(r.series_id || "") === series_id) : byGame;
  return {
    games: options(rows, "game_id", "game_name", "Game"),
    series: options(byGame, "series_id", "series_name", "Series"),
    seasons: options(bySeries, "season_id", "season_name", "Season"),
  };
}

// The queue as filtered. Every filter is optional and they compose downwards;
// an empty string is "all", exactly as the top bar's own scope selectors read.
export function applyQueueFilters(rows = [], { game_id = "", series_id = "", season_id = "" } = {}) {
  return rows.filter(row =>
    (!game_id || String(row.game_id || "") === game_id)
    && (!series_id || String(row.series_id || "") === series_id)
    && (!season_id || String(row.season_id || "") === season_id));
}

// How long somebody has been waiting, in the words the roster shows.
//
// A date is not the question this list answers — "three weeks" is, because the
// person who has waited longest is the one the next session is owed to.
export function waitingFor(iso, now = Date.now()) {
  const then = Date.parse(iso ?? "");
  if (!Number.isFinite(then)) return "at some point";
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString();
}
