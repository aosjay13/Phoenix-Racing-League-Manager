// "Is this person already in the app?"
//
// One human racer answers to a pile of different names: the name on their
// profile, an overall display name, a different name in every game they race,
// a Discord handle, a PSN username, an Xbox gamertag, an iRacing name and
// customer id, and whatever they used to be called before a merge tidied it
// up. Every one of those is a name an admin might type — or a results export
// might list — when adding "a driver".
//
// Until this module existed, only ONE of them counted. `ensureDriverId` matched
// on the pool driver's primary name and nothing else, so:
//
//   • adding "Ryanbirdman" (his BeamNG name) when the pool holds "Ryan Maynard"
//     created a SECOND driver, splitting one person's history in two, and
//   • adding a second "Ryan Maynard" while one already existed was caught, but
//     adding "Ryan Maynard " / "ryan maynard" / "Ryan  Maynard" was not always
//     the same story elsewhere in the app, and
//   • nothing anywhere said a word about it. No prompt, no notice — the
//     duplicate simply appeared.
//
// So the rules live here, once, and every screen that can create a driver asks
// them first. They're pure, so the roster, the race-entry autocomplete, the
// bulk importer and the API route all agree, and they're testable without a
// database (see lib/__tests__/driverMatch.test.mjs).

import { normalizeAliases } from "@/lib/aliases";
import { normalizeGameNames } from "@/lib/driverNames";
import { nameSimilarity } from "@/lib/resultsImport";

// How close two names have to be before we say something.
//
//   CONFIDENT  almost certainly the same person typed slightly differently
//              ("Ryan Maynard" / "Ryan Maynrad") — worth leading with.
//   POSSIBLE   close enough to be worth a glance before creating a second
//              profile ("Jon" / "John"). Below this we stay quiet, because a
//              prompt that fires on every new driver is a prompt nobody reads.
//
// They're set to err towards ASKING, because the two mistakes are not equal: a
// prompt you dismiss costs a click, while a duplicate that slips through splits
// one driver's history across two profiles and needs a merge to undo.
//
// Neither threshold ever BLOCKS anything: they decide what gets shown, and the
// admin still says yes or no. Two genuinely different people with similar names
// are a real thing in a league, and the app must never insist otherwise.
export const CONFIDENT_SCORE = 0.82;
export const POSSIBLE_SCORE = 0.65;

// Comparison form of a name: accents folded, case dropped, punctuation turned
// into single spaces. "Müller" === "muller", "Doe,  Jane" === "doe jane".
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The same, minus the spaces — so "Ryan_Birdman", "ryan birdman" and
// "RyanBirdman" are one name. Gamertags are written all three ways by the same
// person on the same day, and treating them as different people is exactly the
// duplicate this module exists to stop.
export function compactName(value) {
  return normalizeName(value).replace(/ /g, "");
}

// Names carried over from drivers merged INTO this one (see
// /api/admin/drivers/merge). Somebody who has already been cleaned up once must
// not be re-created under the old name by the next import.
function formerNames(driver) {
  const stored = driver?.merged_names;
  return Array.isArray(stored) ? stored.map(n => String(n ?? "").trim()).filter(Boolean) : [];
}

// Every name this driver answers to, most authoritative first, as
// [{ value, source, label, game_id }]:
//
//   name         their profile name — the one the roster and pool show
//   display_name their overall display-name override
//   game_name    the name they're shown under in ONE game
//   alias        a connected-account username (Discord / PSN / Xbox / Steam /
//                iRacing / anything an admin added), labelled with its platform
//   former_name  a name they used to race under, kept by a merge
//
// `games` optionally maps game_id -> game name, so a match can be explained as
// "their BeamNG name" rather than "an in-game name". Duplicated values collapse
// onto the first (most authoritative) source that carries them.
export function driverNames(driver, games = {}) {
  const out = [];
  const seen = new Set();
  const push = (value, source, label, game_id = "") => {
    const v = String(value ?? "").trim();
    if (!v) return;
    const key = compactName(v);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ value: v, source, label, game_id });
  };

  push(driver?.name, "name", "profile name");
  push(driver?.display_name, "display_name", "display name");
  for (const g of normalizeGameNames(driver?.game_names)) {
    push(g.name, "game_name", games[g.game_id] ? `${games[g.game_id]} name` : "in-game name", g.game_id);
  }
  for (const a of normalizeAliases(driver?.aliases)) {
    push(a.value, "alias", a.label || "connected account", a.game_id);
  }
  for (const n of formerNames(driver)) push(n, "former_name", "former name");
  return out;
}

// How well one query ({ name, user_id }) matches ONE driver, and through which
// of their names. Returns null when there's nothing to compare.
//
// A shared player account is the strongest signal there is — two profiles on
// one account is the same person by definition — so it wins outright and
// doesn't need the names to agree at all.
export function scoreDriver(query, driver, { games = {} } = {}) {
  if (!driver) return null;
  const userId = String(query?.user_id ?? "").trim();
  if (userId && String(driver.user_id ?? "").trim() === userId) {
    return { score: 1, via: { value: driver.name, source: "account", label: "linked player account", game_id: "" } };
  }
  const name = String(query?.name ?? "").trim();
  if (!name) return null;
  const needle = compactName(name);
  if (!needle) return null;

  let best = null;
  for (const rec of driverNames(driver, games)) {
    // Exact once the noise is stripped, or merely similar — `nameSimilarity`
    // (lib/resultsImport.js) is the same blend of edit distance and token
    // overlap the results importer matches names with, so a name the importer
    // would resolve is a name this module flags.
    const score = compactName(rec.value) === needle ? 1 : nameSimilarity(name, rec.value);
    if (!best || score > best.score) best = { score, via: rec };
  }
  return best;
}

// Rank the pool against a query, keeping anything worth mentioning.
//
//   query.name        the name being typed / imported
//   query.user_id     the player account it belongs to, when known
//   query.exclude_id  a driver to leave out — themselves, when re-checking an
//                     existing profile after a rename
//
// `confidence` is "exact" (a name they demonstrably answer to), "strong" (a
// near-certain typo of one) or "possible" (close enough to check).
export function findDriverMatches(pool = [], query = {}, { games = {}, limit = 6, floor = POSSIBLE_SCORE } = {}) {
  const exclude = String(query?.exclude_id ?? "");
  const found = [];
  for (const driver of pool) {
    if (!driver || driver.id === undefined || String(driver.id) === exclude) continue;
    const hit = scoreDriver(query, driver, { games });
    if (!hit || hit.score < floor) continue;
    found.push({
      driver_id: driver.id,
      name: driver.name,
      user_id: driver.user_id || "",
      score: hit.score,
      via: hit.via,
      confidence: hit.score >= 1 ? "exact" : hit.score >= CONFIDENT_SCORE ? "strong" : "possible",
    });
  }
  // Best first. Equal scores keep the order they arrived in — the pool comes
  // back name-sorted (see SPECS.drivers), and Array#sort is stable, so two
  // drivers who match a name equally well are offered alphabetically.
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, limit);
}

// Type-ahead search across every name a driver answers to — what the "add a
// driver to this race" box filters on. Substring rather than similarity,
// because this runs on a half-typed name: "ryanb" has to find Ryan Maynard
// through his Discord handle before it's finished being typed.
//
// Each hit says which name it was found through, so the list can show
// "Ryan Maynard · PSN Username “Ryan_Bird_77”" rather than a name the admin
// didn't type and can't place. Ranked so the profile name wins over an alias,
// and the start of a name wins over its middle.
export function searchDrivers(pool = [], text = "", { games = {}, limit = 8 } = {}) {
  const needle = compactName(text);
  if (!needle) return [];
  const hits = [];
  for (const driver of pool) {
    let best = null;
    for (const rec of driverNames(driver, games)) {
      const hay = compactName(rec.value);
      if (!hay.includes(needle)) continue;
      const rank = (rec.source === "name" ? 0 : 1) + (hay.startsWith(needle) ? 0 : 2);
      if (!best || rank < best.rank) best = { rank, via: rec };
    }
    if (best) hits.push({ driver, via: best.via, rank: best.rank });
  }
  // Stable: equal ranks keep the pool's own (alphabetical) order.
  hits.sort((a, b) => a.rank - b.rank);
  return hits.slice(0, limit);
}

// Does this driver already go by exactly this name? Used to decide whether
// "＋ Create new driver" is even worth offering.
export function driverAnswersTo(driver, text, games = {}) {
  const needle = compactName(text);
  if (!needle) return false;
  return driverNames(driver, games).some(rec => compactName(rec.value) === needle);
}

// The verdict on "should this create a new driver?", which is the only question
// every caller actually has:
//
//   none       nobody in the pool is close — create away, no prompt needed
//   linked     exactly one driver demonstrably answers to this name (or owns
//              this account): use them, and say so rather than creating a twin
//   ambiguous  SEVERAL drivers answer to it — the app must not guess, so the
//              admin picks
//   possible   nothing exact, but one or more near misses — show them and let
//              the admin decide
//
// `driver_id` is filled only for `linked`: the one case where carrying on
// without asking is provably right.
export function duplicateReport(pool = [], query = {}, opts = {}) {
  const matches = findDriverMatches(pool, query, opts);
  // One player account holds one driver profile — that rule is enforced when a
  // profile is claimed (see /api/claim-requests), so a match through the account
  // is the answer even when somebody else's profile happens to share the name.
  const byAccount = matches.find(m => m.via?.source === "account");
  if (byAccount) return { status: "linked", driver_id: byAccount.driver_id, matches, match: byAccount };
  const exact = matches.filter(m => m.confidence === "exact");
  if (exact.length === 1) return { status: "linked", driver_id: exact[0].driver_id, matches, match: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", driver_id: null, matches, match: null };
  if (matches.length) return { status: "possible", driver_id: null, matches, match: null };
  return { status: "none", driver_id: null, matches: [], match: null };
}

// Why this driver came up, in words an admin can act on: "same name",
// "PSN Username “Ryanbirdman”", "their BeamNG name “Ryanbirdman”". Written to
// sit after the driver's name, so the row reads
// "Ryan Maynard — PSN Username “Ryanbirdman”".
export function matchReason(match) {
  if (!match?.via) return "";
  const { source, label, value } = match.via;
  const quoted = `“${value}”`;
  const exact = match.confidence === "exact";
  switch (source) {
    case "account":
      return "already linked to that player account";
    case "name":
      return exact ? "same name" : `similar name ${quoted}`;
    case "display_name":
      return exact ? `their display name ${quoted}` : `similar display name ${quoted}`;
    case "game_name":
      return exact ? `their ${label} is ${quoted}` : `similar ${label} ${quoted}`;
    case "former_name":
      return exact ? `used to race as ${quoted}` : `used to race as something similar (${quoted})`;
    default:
      return exact ? `their ${label} is ${quoted}` : `similar ${label} ${quoted}`;
  }
}

// One line for a whole verdict — the sentence a toast or a warning panel leads
// with. Deliberately says what WILL happen, not just what was found.
export function duplicateSummary(report, typedName = "") {
  const name = String(typedName ?? "").trim() || "That driver";
  if (!report || report.status === "none") return "";
  if (report.status === "linked") {
    return `“${name}” is already in the app as ${report.match.name} (${matchReason(report.match)}).`;
  }
  if (report.status === "ambiguous") {
    return `More than one driver already answers to “${name}” — pick which one this is.`;
  }
  const n = report.matches.length;
  return `“${name}” looks like ${n === 1 ? "a driver" : `${n} drivers`} you already have — check before creating a new one.`;
}
