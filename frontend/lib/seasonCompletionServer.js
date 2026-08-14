import { db } from "@/lib/firebase";
import { postMessage } from "@/lib/messagesServer";
import {
  completionContext, completionRecipients, seasonJustCompleted,
} from "@/lib/seasonCompletion";

// The Firestore half of "tell the drivers the season is over" — the rules it
// runs on are pure and tested in lib/seasonCompletion.js.
//
// Hung off the seasons PATCH as an afterUpdate hook (see lib/entityApi.js and
// app/api/seasons/[id]/route.js) rather than written into the admin screen's
// button, because "Mark Completed" is not the only way a season's status can be
// saved and a rule that lives in one button is a rule with a hole in it.

// Announce a season an admin has just marked complete.
//
// NEVER throws into the caller, and never fails the save. The status change is
// already committed and is the decision; failing to announce it must not undo
// it, exactly as postMessage() has always worked. A missing card is a gap in the
// conversation, not a corrupted season.
//
// Returns how many players were told, which the hook ignores and the tests read.
export async function announceSeasonCompleted({ id, before, updates, user } = {}) {
  const after = { ...(before || {}), ...(updates || {}) };
  if (!id || !seasonJustCompleted(before, after)) return 0;

  try {
    const season = { id, ...after };
    const [entries, classes, series] = await Promise.all([
      rosterOf(id),
      classesOf(id),
      docOf("series", season.series_id),
    ]);
    const game = await docOf("games", season.game_id || series?.game_id);

    const recipients = completionRecipients(await withAccounts(entries), classes);

    // A few at a time rather than one after another: this is the only
    // announcement that writes a card per DRIVER of a whole season, and forty of
    // them in series is several seconds an admin spends watching a button. The
    // batch is small on purpose — the point is to stop the clicks stacking up,
    // not to throw a season's roster at Firestore at once. postMessage swallows
    // its own failures, so one card that doesn't land never takes the rest with
    // it.
    for (let i = 0; i < recipients.length; i += 10) {
      await Promise.all(recipients.slice(i, i + 10).map(recipient => postMessage({
        uid: recipient.uid,
        leagueId: season.league_id || series?.league_id || null,
        kind: "season_completed",
        admin: { uid: user?.uid || null, name: user?.name || user?.email || null },
        // No email. One press of one button announces to a whole field at once,
        // and a league that mails its entire roster every time a season ends is
        // a league whose mail gets filtered into the bin — which would cost the
        // decisions that DO need to arrive that way. The board is where this
        // belongs, and it's where the player is already reading. (The placement
        // announcements skip email for the same reason.)
        email: null,
        context: completionContext({ season, series, game, recipient }),
      })));
    }
    return recipients.length;
  } catch (err) {
    console.error("Announcing a completed season failed", err);
    return 0;
  }
}

// The season's roster — everybody who is entered, whatever they scored, since
// "your season is over" is owed to a driver who signed up and never turned a
// lap just as much as to the champion.
async function rosterOf(seasonId) {
  const snap = await db().collection("entries").where("season_id", "==", seasonId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The season's classes in display order, so a driver in two of them reads them
// the same way round here as on every other screen.
async function classesOf(seasonId) {
  const snap = await db().collection("classes").where("season_id", "==", seasonId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

async function docOf(collection, id) {
  if (!id) return null;
  try {
    const doc = await db().collection(collection).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch {
    return null;
  }
}

// Resolve each roster row to the account behind it. An entry usually names the
// DRIVER rather than the account — the account hangs off the driver profile —
// and only entries that resolve to one have anybody to tell. Each profile is
// read once however many entries point at it, since a season's roster is the
// one place a league reliably has dozens of rows.
async function withAccounts(entries) {
  const driverIds = [...new Set(entries
    .filter(e => !String(e.user_id ?? "").trim())
    .map(e => String(e.driver_id ?? "").trim())
    .filter(Boolean))];
  const drivers = await Promise.all(driverIds.map(driverId => docOf("drivers", driverId)));
  const uidByDriver = Object.fromEntries(
    driverIds.map((driverId, i) => [driverId, drivers[i]?.user_id || ""]));
  return entries.map(entry => ({
    ...entry,
    user_id: String(entry.user_id ?? "").trim() || uidByDriver[entry.driver_id] || "",
  }));
}
