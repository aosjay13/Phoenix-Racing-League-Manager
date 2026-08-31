import { db } from "@/lib/firebase";
import { scopeByLeague } from "@/lib/serverAuth";
import { duplicateReport, matchedName, matchReason } from "@/lib/driverMatch";

// Server-side half of the duplicate-driver rules (lib/driverMatch.js): the two
// reads the pure matcher needs, and the shape a refusal takes on the wire.
//
// Both reads are whole small collections rather than indexed queries on
// purpose. A driver answers to names spread across four fields — `name`,
// `display_name`, `game_names[]` and `aliases[]` — and Firestore cannot query
// inside two array fields at once, so "does anyone in this league already go by
// this?" is a question only the matcher can answer, over the whole pool. A
// league's driver pool is hundreds of documents at most, and this runs when
// somebody creates a driver, not on every page view.

// Every driver in the league, in the shape lib/driverMatch.js expects.
export async function loadDriverPool(leagueId) {
  const snap = await scopeByLeague(db().collection("drivers"), leagueId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// game_id -> game name, so a match through a per-game name can be explained as
// "their BeamNG name" instead of the vaguer "in-game name".
export async function loadGameNames(leagueId) {
  const snap = await scopeByLeague(db().collection("games"), leagueId).get();
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data().name || ""]));
}

// The matches, trimmed to what a client needs to draw a "did you mean one of
// these?" prompt: who, why, and how sure.
// `privileged` says whether the caller may see a driver's iRacing real name.
// Admin screens (the duplicate prompt behind "＋ New Driver") may; a player
// filling in a sign-up may not, and gets the safe name and a reason that
// quotes nothing — see matchReason in lib/driverMatch.js.
export function serializeMatches(matches = [], { privileged = false } = {}) {
  return matches.map(m => ({
    driver_id: m.driver_id,
    name: matchedName(m, privileged),
    user_id: m.user_id || "",
    confidence: m.confidence,
    score: Math.round(m.score * 100) / 100,
    via: privileged || !m.via?.iracing ? m.via : { ...m.via, value: "", label: "a name already on file" },
    reason: matchReason(m, { privileged }),
  }));
}

// Would creating this driver duplicate somebody? Returns null when it wouldn't
// (or when the caller has already been asked and said yes), and otherwise the
// whole verdict, ready to be refused with.
export async function duplicateCheck({ name, user_id, exclude_id, leagueId }) {
  const [pool, games] = await Promise.all([loadDriverPool(leagueId), loadGameNames(leagueId)]);
  const report = duplicateReport(pool, { name, user_id, exclude_id }, { games });
  return report.status === "none" ? null : report;
}

// What a refused create says. Deliberately names the driver it found and the
// name that gave them away — "there's already a driver called that" was the
// old message, and it couldn't explain a clash through a PSN username at all.
export function duplicateMessage(report, typedName = "", { privileged = false } = {}) {
  const name = String(typedName ?? "").trim() || "that driver";
  const lead = report.matches
    .slice(0, 3)
    .map(m => `${matchedName(m, privileged)} (${matchReason(m, { privileged })})`)
    .join(", ");
  if (report.status === "linked") {
    return `“${name}” is already in the app as ${lead}. Add them from the driver list instead of creating a second profile — or confirm you really do mean a new driver.`;
  }
  if (report.status === "ambiguous") {
    return `More than one driver already answers to “${name}”: ${lead}. Pick which one this is, or confirm you really do mean a new driver.`;
  }
  return `“${name}” looks like someone you already have: ${lead}. Use that driver, or confirm you really do mean a new one.`;
}
