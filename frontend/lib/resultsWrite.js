// Writing one session's results — the single place that turns review-grid rows
// into results documents.
//
// It exists because there are now two ways a session gets saved:
//
//   • POST /api/results — the results grid's Save, one session at a time, which
//     is how every result has always been entered
//   • POST /api/import-srh-season-results — a whole season of SimRacerHub
//     results in one press, which writes the same sessions in bulk
//
// Both must produce byte-identical documents. A season imported in bulk that
// stored its laps, its statuses or its class a shade differently from the same
// night typed in by hand would score differently in the standings, and the
// difference would only show up weeks later in a championship table. So the
// shape of a result — and the rule for which stored rows a save replaces —
// lives here once, and both callers ask this module rather than each other.
//
// What deliberately stays with the callers: fetching, batching and the Skill
// Rating recalc. A bulk import reads a race's results once and writes every
// session of it in one batch, then recalculates ratings a single time at the
// end; the grid's Save does all three for its one session. Those are different
// jobs. Building a row is not.
//
// Server-only: it touches Firestore, so import it from route handlers.

import { db } from "@/lib/firebase";
import { classIdForScope, isClassScoped, primaryClassId, resultInSessionClass } from "@/lib/classFilter";
import { bangerFieldsForSave } from "@/lib/bangerRacing";

// A stored figure that isn't a number would be NaN, and a NaN in a points
// field spreads through the driver's total and the whole championship column
// with no screen able to say which row caused it. The scorer refuses to read
// one (see `num` in lib/standings.js); this refuses to write one, so it can
// never get in from an API call or a restored backup in the first place.
const num = (raw, fallback = 0) => {
  const n = Number(raw == null || raw === "" ? fallback : raw);
  return Number.isFinite(n) ? n : fallback;
};

export const SESSION_TYPES = ["qualifying", "race", "heat", "consolation", "feature"];

// The session type a request asked for, or "race" when it named nothing this
// app knows.
export const sessionTypeOf = value => (SESSION_TYPES.includes(value) ? value : "race");

// Session-list metadata used to resolve which stored docs belong to the
// session being written: legacy docs may lack the session field, in which
// case they're treated as the event's first standard session.
export async function sessionContext(raceId) {
  const raceDoc = await db().collection("races").doc(raceId).get();
  const data = raceDoc.exists ? raceDoc.data() : {};
  const sessions = Array.isArray(data.sessions) && data.sessions.length ? data.sessions : ["Race"];
  // `raceClassId` is the "<class> only" round set on Race Info — the class the
  // whole event is run in, and so the class of every result written for it that
  // doesn't name one of its own.
  return { firstSession: sessions[0], seasonId: data.season_id || null, raceClassId: data.class_id || "" };
}

// class_id per roster entry, used to resolve the class of a result saved before
// classes existed (or before this driver was classified) — the same fallback
// classOfResult applies everywhere else. A driver entered in several classes
// falls back to their primary one; a combined session's Class dropdown on the
// row is how the other class gets recorded.
export async function classByEntryForSeason(seasonId) {
  if (!seasonId) return {};
  const snap = await db().collection("entries").where("season_id", "==", seasonId).get();
  return Object.fromEntries(snap.docs.map(d => [d.id, { class_id: primaryClassId(d.data()) || "" }]));
}

// Docs that count as "this session". Qualifying is isolated by type, but all
// race-like types (race/heat/consolation/feature) match each other by session
// name: the event page merges them by name, so a leftover set saved under
// another type (e.g. before the event was switched to heat format) would
// render as duplicate finishing positions.
//
// `sessionClass` narrows that to ONE class's slice of the session (see
// lib/classFilter.js): a per-class save replaces only its own class's rows and
// leaves the other classes racing the same event untouched. Left unset — the
// combined mode every event used before per-class sessions existed — the whole
// session is replaced regardless of class.
export function matchesSession(data, sessionType, savingSession, firstSession, sessionClass, entriesById) {
  const docType = data.session_type || "race";
  const docSession = data.session || firstSession;
  if (docSession !== savingSession) return false;
  if (!resultInSessionClass(data, sessionClass, entriesById)) return false;
  return sessionType === "qualifying" ? docType === "qualifying" : docType !== "qualifying";
}

// Every row must name a driver and where they finished. Returns the complaint
// to answer a bad request with, or "" when the rows are usable.
export function rowsError(rows) {
  if (!Array.isArray(rows)) return "rows[] required";
  for (const row of rows) {
    if (!row.entry_id || !row.finish_pos) return "each row needs entry_id and finish_pos";
  }
  return "";
}

// One review-grid row → the document stored for it.
export function resultDoc(row, {
  race_id, season_id, leagueId, session, sessionType,
  scoped, scopeClassId, raceClassId, classByEntry, points_template_id, now, uid,
}) {
  return {
    race_id,
    season_id,
    ...(leagueId ? { league_id: leagueId } : {}),
    session,
    session_type: sessionType,
    entry_id: row.entry_id,
    // The class this driver RAN in, recorded on the result itself so a class
    // championship stays historically correct even if the driver is later
    // moved. An explicit class on the row wins (the results grid's Class
    // dropdown); then the class the ROUND is run in, when it's a "<class> only"
    // event — that's the whole event's class, so it beats a roster guess for a
    // driver who races several; otherwise it's taken from the driver's current
    // roster entry. Blank = unclassified. A per-class save overrides the lot
    // with the class being entered.
    class_id: scoped
      ? scopeClassId
      : ((row.class_id != null && row.class_id !== "")
        ? row.class_id
        : (raceClassId || classByEntry[row.entry_id] || "")),
    finish_pos: num(row.finish_pos),
    start_pos: row.start_pos === "" || row.start_pos == null ? null : num(row.start_pos, null),
    qual_time: row.qual_time || null,
    race_time: row.race_time || null,
    interval: row.interval || null,
    laps: num(row.laps),
    laps_led: num(row.laps_led),
    incidents: num(row.incidents),
    fastest_lap: !!row.fastest_lap,
    // Driver's best single lap time for this session, as a clock string
    // ("1:23.456"). Independent of the `fastest_lap` flag (which just marks
    // who set the session's quickest lap): the fastest of these across every
    // race at a venue is that track's lap record. See lib/trackCompute.js.
    fastest_lap_time: row.fastest_lap_time || null,
    halfway_leader: !!row.halfway_leader,
    hard_charger: !!row.hard_charger,
    // Who led the most laps. Derived in the grid from the Led column and
    // ticked automatically, but stored rather than re-derived at read time so
    // an admin's override survives — see lib/autoFlags.js and
    // decorateRaceBonuses(), which falls back to deriving it for results
    // saved before this field existed.
    most_laps_led: !!row.most_laps_led,
    provisional: !!row.provisional,
    // Demo Derby / Banger Racing stats (takedowns, survival bonus, most
    // lethal). Written for every result — zeros/falses outside a banger
    // series, which score nothing and aggregate to nothing — so the stats
    // engine never has to ask what kind of series a result came from. See
    // lib/bangerRacing.js.
    ...bangerFieldsForSave(row),
    bonus_points: num(row.bonus_points),
    penalty_points: num(row.penalty_points),
    // Signed per-result adjustment (penalties/corrections), applied on top of
    // scored points without changing the finishing position. Negative docks.
    points_adjustment: num(row.points_adjustment),
    // Flat, admin-entered points for a provisional entry (a driver who didn't
    // make the race). Overrides position-based scoring; null for normal rows.
    manual_points: row.manual_points === "" || row.manual_points == null ? null : num(row.manual_points, null),
    status: row.status || "finished",
    points_template_id: points_template_id || null,
    created_at: now,
    created_by: uid,
  };
}

// Replace one session's results inside a batch the caller commits.
//
// `existing` is every results doc already stored for the race — read once by
// the caller, because a bulk import writes five sessions of the same race and
// re-reading them per session would be four extra round trips for an answer
// that cannot have changed. The rows this session replaces are deleted and the
// new ones set; nothing else in the batch is touched.
//
// Returns the documents written, which is what the routes answer with.
export function stageSessionWrite({
  batch, existing, race_id, season_id, leagueId, session, sessionType,
  session_class = null, points_template_id = null, rows, firstSession,
  raceClassId = "", entriesById = {}, uid, now = new Date().toISOString(),
}) {
  // A per-class save is that class's session: every row it writes belongs to
  // the class being entered, whatever the roster or the row's own Class cell
  // says, so a mis-set dropdown can't leak a driver into another class's grid.
  const scoped = isClassScoped(session_class);
  const scopeClassId = classIdForScope(session_class);
  const classByEntry = Object.fromEntries(Object.entries(entriesById).map(([id, e]) => [id, e.class_id]));

  // Replace this session's existing rows — or, for a per-class save, only this
  // class's slice of them. SR is recomputed from scratch by the caller (a full
  // chronological replay of the game), so no per-session reversal is needed —
  // corrections and re-saves are handled by that recalc.
  existing
    .filter(d => matchesSession(d.data(), sessionType, session, firstSession, session_class, entriesById))
    .forEach(d => batch.delete(d.ref));

  const col = db().collection("results");
  const saved = [];
  for (const row of rows) {
    const ref = col.doc();
    const doc = resultDoc(row, {
      race_id, season_id, leagueId, session, sessionType,
      scoped, scopeClassId, raceClassId, classByEntry, points_template_id, now, uid,
    });
    batch.set(ref, doc);
    saved.push({ id: ref.id, ...doc });
  }
  return saved;
}
