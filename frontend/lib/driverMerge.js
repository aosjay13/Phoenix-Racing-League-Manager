// Folding one driver profile into another.
//
// A duplicate isn't only a spare row in a list. It is half of somebody's
// career: some of their races are filed against one profile and the rest
// against the other, so their win count, their average finish, their Skill
// Rating and their championship history are all wrong on both. Merging is how
// that gets put right, and it has exactly one rule — NOTHING may be lost.
//
// Two halves make up a merge, and they're deliberately separate:
//
//   • the RACE HISTORY moves by re-pointing the duplicate's roster entries at
//     the survivor. Results reference entries rather than drivers, so every
//     result, every point and every statistic travels with them untouched.
//     That half needs a database and lives in /api/admin/drivers/merge.
//   • the PROFILE — the names, the connected accounts, the per-game names, the
//     ratings — has to be reconciled field by field, because both profiles
//     carry a version of each. That half is decided here, where it's pure and
//     can be checked without a database (lib/__tests__/driverMerge.test.mjs).
//
// The rule for every field is the same one, stated once: the PRIMARY is the
// truth, and the duplicate fills in only what the primary doesn't have. An
// admin picked which profile survives; a merge must never quietly overwrite
// their choice with the loser's data. But nor may it drop the loser's Xbox
// gamertag simply because the survivor never had one — that gamertag is how
// the next import will recognise this person.

import { normalizeAliases } from "@/lib/aliases";
import { normalizeGameNames } from "@/lib/driverNames";
import { POSSIBLE_SCORE, compactName, driverNames, findDriverMatches, matchReason } from "@/lib/driverMatch";

// ── Finding the duplicates in the first place ───────────────────────────────
//
// The app has asked before creating a driver for a while now, so new
// duplicates are rare. The ones that hurt are the OLD ones — made before that
// check existed, or waved through by an admin who didn't recognise the name at
// the time — and nobody goes looking for those, because looking means reading
// four hundred names and remembering which of them are the same person.
//
// So the merge tool looks for them: every driver checked against every other
// through every name each answers to (profile name, display name, per-game
// names, connected accounts, former names — see lib/driverMatch.js). One row
// per PAIR, best first, each carrying why it came up so the admin can judge it
// without opening two profiles.
//
// Suggestions only. Two people with similar names is ordinary in a league, and
// nothing here merges anything — it just stops the search being manual.
export function findDuplicateCandidates(pool = [], { games = {}, limit = 25, floor = POSSIBLE_SCORE } = {}) {
  const best = new Map();
  for (const driver of pool) {
    if (!driver?.id) continue;
    // Search on EVERY name this driver goes by, not only their profile name:
    // the duplicate is usually the one filed under an in-game name.
    for (const rec of driverNames(driver, games)) {
      for (const hit of findDriverMatches(pool, { name: rec.value, exclude_id: driver.id }, { games, limit: 4, floor })) {
        const key = [String(driver.id), String(hit.driver_id)].sort().join("|");
        const existing = best.get(key);
        if (existing && existing.score >= hit.score) continue;
        best.set(key, {
          key,
          score: hit.score,
          confidence: hit.confidence,
          // The pair, ordered so the driver with a linked player account is
          // offered as the primary — an account is the strongest claim to
          // being the profile worth keeping. The admin can still swap them.
          primary: hit.user_id && !driver.user_id ? { id: hit.driver_id, name: hit.name } : { id: driver.id, name: driver.name },
          duplicate: hit.user_id && !driver.user_id ? { id: driver.id, name: driver.name } : { id: hit.driver_id, name: hit.name },
          reason: matchReason(hit),
          via: rec.source === "name" ? "" : rec.label,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// Connected accounts (Discord / PSN / Xbox / iRacing / anything an admin
// added), reconciled by platform label. The primary's username for a platform
// wins; a platform only the duplicate used is carried across; a platform both
// hold but only the duplicate filled in is filled in.
export function mergeAliasSets(primary, duplicate) {
  const rows = normalizeAliases(primary);
  const byLabel = new Map(rows.map((a, i) => [a.label.toLowerCase(), i]));
  const out = [...rows];
  for (const add of normalizeAliases(duplicate)) {
    const at = byLabel.get(add.label.toLowerCase());
    if (at === undefined) {
      if (!add.value && !add.game_id) continue;   // an empty row is not a fact
      byLabel.set(add.label.toLowerCase(), out.length);
      out.push(add);
      continue;
    }
    out[at] = {
      ...out[at],
      value: out[at].value || add.value,
      game_id: out[at].game_id || add.game_id,
      is_display: out[at].is_display || add.is_display,
    };
  }
  return out;
}

// The name shown in each game. One name per game — the primary's, where it has
// one — plus every game only the duplicate raced.
export function mergeGameNames(primary, duplicate) {
  const rows = normalizeGameNames(primary);
  const held = new Set(rows.map(g => g.game_id));
  return [...rows, ...normalizeGameNames(duplicate).filter(g => !held.has(g.game_id))];
}

// Skill Ratings are per game (skill in GT7 doesn't carry to iRacing), so the
// map is merged per game rather than wholesale. The primary's rating for a
// game it has raced stands; a game only the duplicate raced comes across.
//
// This is a stopgap either way: SR is derived, and the merge route replays
// every affected game afterwards, which recomputes both. Carrying it here
// means the profile is never briefly missing a rating in between.
export function mergeSkillRatings(primary, duplicate) {
  const a = primary && typeof primary === "object" ? primary : {};
  const b = duplicate && typeof duplicate === "object" ? duplicate : {};
  return { ...b, ...a };
}

// Every name the surviving profile should answer to afterwards, so an import
// that lists the duplicate under its old name finds the survivor instead of
// re-creating what was just cleaned up. Both profiles' former names carry
// across (a driver merged twice keeps the whole trail), and the survivor's own
// current names are left out — they aren't FORMER names.
export function mergeFormerNames(primary, duplicate, extraNames = []) {
  const held = new Set([
    compactName(primary?.name),
    compactName(primary?.display_name),
  ].filter(Boolean));
  const out = [];
  const seen = new Set();
  const push = value => {
    const text = String(value ?? "").trim();
    const key = compactName(text);
    if (!key || held.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  for (const n of primary?.merged_names || []) push(n);
  push(duplicate?.name);
  push(duplicate?.display_name);
  for (const n of duplicate?.merged_names || []) push(n);
  for (const g of normalizeGameNames(duplicate?.game_names)) push(g.name);
  for (const n of extraNames) push(n);
  return out;
}

// The whole profile side of a merge: what to write onto the surviving driver.
//
// `extraNames` are names the duplicate actually RACED under, read off their
// roster entries by the caller — a driver renamed once already has entries
// under a name neither profile still carries, and that name has to keep
// resolving too.
//
// Returns { updates, carried }: the patch to apply, and a plain-language list
// of what came across, so the screen can tell the admin what a merge did
// rather than leaving them to trust it.
export function planProfileMerge(primary = {}, duplicate = {}, { extraNames = [] } = {}) {
  const updates = {};
  const carried = [];

  // mergeAliasSets keeps the primary's rows at their own indexes and appends
  // the rest, so "added" and "filled in" can both be counted against it.
  const aliasesBefore = normalizeAliases(primary.aliases);
  const aliases = mergeAliasSets(primary.aliases, duplicate.aliases);
  const gainedAliases = (aliases.length - aliasesBefore.length)
    + aliasesBefore.filter((a, i) => !a.value && aliases[i].value).length;
  if (gainedAliases > 0) {
    updates.aliases = aliases;
    carried.push(`${gainedAliases} connected account${gainedAliases === 1 ? "" : "s"}`);
  }

  const gameNames = mergeGameNames(primary.game_names, duplicate.game_names);
  const gainedGameNames = gameNames.length - normalizeGameNames(primary.game_names).length;
  if (gainedGameNames > 0) {
    updates.game_names = gameNames;
    carried.push(`${gainedGameNames} in-game name${gainedGameNames === 1 ? "" : "s"}`);
  }

  // A profile with no player account attached inherits the duplicate's, which
  // is the common shape of this mistake: somebody claimed the second profile
  // by accident and the real one was never linked.
  if (!String(primary.user_id ?? "").trim() && String(duplicate.user_id ?? "").trim()) {
    updates.user_id = String(duplicate.user_id).trim();
    carried.push("their linked player account");
  }

  for (const field of ["display_name", "notes"]) {
    if (!String(primary[field] ?? "").trim() && String(duplicate[field] ?? "").trim()) {
      updates[field] = String(duplicate[field]).trim();
      carried.push(field === "notes" ? "their notes" : "their display name");
    }
  }

  const ratings = mergeSkillRatings(primary.skillRatings, duplicate.skillRatings);
  const gainedRatings = Object.keys(ratings).length - Object.keys(primary.skillRatings || {}).length;
  if (gainedRatings > 0) {
    updates.skillRatings = ratings;
    carried.push(`${gainedRatings} game skill rating${gainedRatings === 1 ? "" : "s"}`);
  }

  const merged_names = mergeFormerNames(primary, duplicate, extraNames);
  updates.merged_names = merged_names;
  const gainedNames = merged_names.length - (primary.merged_names || []).length;
  if (gainedNames > 0) {
    carried.push(`${gainedNames} former name${gainedNames === 1 ? "" : "s"}`);
  }

  return { updates, carried, merged_names };
}
