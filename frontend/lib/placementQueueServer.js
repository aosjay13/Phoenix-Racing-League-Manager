// Firestore reads and writes around the Placements Queue rules in
// lib/placementQueue.js — the same split as signupQueue/carSelectionServer, so
// the browser can apply the rules without pulling firebase-admin into its
// bundle.
//
// The queue is not a collection of its own: it is `signup_requests` in the
// `approved_for_placements` state (see lib/signupQueue.js). Everything here
// reads that one status.

import { db } from "@/lib/firebase";
import { scopeByLeague } from "@/lib/serverAuth";
import { APPROVED, APPROVED_FOR_PLACEMENTS } from "@/lib/signupQueue";
import { queueIdentityKeys, queueRowsPlacedBy, trialDestinations } from "@/lib/placementQueue";
import { identityKeys } from "@/lib/timeTrials";
import { postMessage } from "@/lib/messagesServer";

// Everyone in the league waiting on a placement session, oldest first.
//
// Oldest first is not cosmetic: whoever has been waiting longest is the driver
// the next session is owed to, and every screen that shows this queue orders it
// that way. Uncapped for the same reason the panel is — silently truncating a
// to-do list hides exactly the people it exists to remember.
export async function fetchPlacementQueue(leagueId = "") {
  const snap = await scopeByLeague(
    db().collection("signup_requests").where("status", "==", APPROVED_FOR_PLACEMENTS),
    leagueId,
  ).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

// The waiting driver as the Placement Roster and the import both read them.
//
// Trimmed on the way out: the queue row carries an account id, an email and
// every platform username the sign-up collected, and none of that is needed to
// answer "who is waiting, for what, and since when". The name, photo and email
// stay because an admin working a roster needs to recognise a person and reach
// them.
export function placementQueueRow(row = {}) {
  return {
    id: row.id,
    name: row.name || row.driver_name || "Driver",
    driver_id: row.driver_id || "",
    uid: row.uid || "",
    user_email: row.user_email || null,
    user_photo: row.user_photo || null,
    game_id: row.game_id || "",
    game_name: row.game_name || "",
    series_id: row.series_id || "",
    series_name: row.series_name || "",
    season_id: row.season_id || "",
    season_name: row.season_name || "",
    class_ids: row.class_ids || [],
    class_names: row.class_names || [],
    number: row.number ?? "",
    car: row.car || "",
    created_at: row.created_at || null,
    // Implied by the status itself — nobody reaches this list any other way —
    // but stated so a row reads the same as one from the pending queue.
    placements_required: true,
  };
}

// ── Clearing the queue after a roster has been built ───────────────────────
//
// The last step of a placement night. The board has been turned into rosters,
// so the drivers it placed are racing — and a registration that has been
// answered must stop asking. Left in the queue they would be run through a
// second session by the next admin to look at the list, which is the exact
// failure the list exists to prevent in the other direction.
//
// They move to `approved` — the ordinary "on the roster" outcome — rather than
// to a state of their own, because that is now simply true of them, and because
// it is what un-claims their car number: the number is held by the roster entry
// from here on, and leaving it claimed by the request as well would have the
// season's own screens reporting a clash with nobody (see OPEN_STATUSES).
//
// `placed_from_trial` is stamped so the row still says HOW it was answered — a
// registration approved at the queue and one earned in a session are different
// events, and the record should not read as though an admin waved them through.
//
// Never allowed to fail the roster build: by the time this runs the entries are
// written and the drivers are racing. A queue row that survives is a stale
// to-do an admin can clear by hand; a thrown error here would be a completed
// placement night reported as a failure.
export async function clearPlacementQueue({
  trial, trialId, placedRows = [], leagueId = "", admin = null,
}) {
  const dest = trialDestinations(trial);
  const queue = await fetchPlacementQueue(leagueId);
  const clearing = queueRowsPlacedBy(queue, placedRows, dest);
  if (!clearing.length) return { cleared: [] };

  const now = new Date().toISOString();
  // Chunked like every other bulk write in the app: a placement night has no
  // fixed size, and Firestore batches cap at 500.
  for (let i = 0; i < clearing.length; i += 400) {
    const batch = db().batch();
    for (const row of clearing.slice(i, i + 400)) {
      batch.update(db().collection("signup_requests").doc(row.id), {
        status: APPROVED,
        resolved_at: now,
        resolved_by: admin?.uid || null,
        placed_from_trial: trialId || null,
      });
    }
    await batch.commit();
  }

  // And tell them. They were told, in as many words, that they were NOT on the
  // roster and were waiting on a session — so the session finishing is the
  // moment that stops being true, and nothing else in the app would ever say
  // so. Posted per driver against the season they were actually placed into,
  // which is not always the one they signed up for.
  const placedBy = placedIndex(placedRows);
  for (const row of clearing) {
    const landed = placedBy(row);
    await postMessage({
      uid: row.uid,
      leagueId: row.league_id || leagueId || null,
      kind: "signup_approved",
      admin: { uid: admin?.uid || null, name: admin?.name || admin?.email || null },
      // No email: the board is where every other decision about them landed,
      // and a placement night mails a whole field at once.
      email: null,
      context: {
        season_id: landed?.target_season_id || row.season_id || "",
        season_name: landed?.target_season_name || row.season_name || "Season",
        series_id: landed?.assigned_series_id || row.series_id || "",
        series_name: landed?.assigned_series_name || row.series_name || "Series",
        game_id: row.game_id || "",
        game_name: row.game_name || "",
        number: String(row.number ?? "").trim(),
        car: row.car || "",
        driver_name: row.driver_name || row.name || "",
        class_name: landed?.assigned_class_name || "",
        placed_from_trial: trialId || "",
      },
    });
  }

  return { cleared: clearing.map(r => ({ id: r.id, name: r.name || "Driver", uid: r.uid || "" })) };
}

// Which sheet row a queue row was placed by, so the message can name the season
// they actually landed in. The one identity rule the whole app matches people
// with (identityKeys in lib/timeTrials.js) — never a second reading of it.
function placedIndex(placedRows = []) {
  const byKey = new Map();
  for (const row of placedRows) {
    for (const key of identityKeys(row)) if (!byKey.has(key)) byKey.set(key, row);
  }
  return queueRow => queueIdentityKeys(queueRow).map(k => byKey.get(k)).find(Boolean) || null;
}
