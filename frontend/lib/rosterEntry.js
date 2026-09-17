// One roster entry per driver, per season.
//
// A season's `entries` are its roster: one document per driver, the record every
// result keys off (`results.entry_id`) and the row every championship table
// scores. A driver holding TWO of them in the same season is the shape of a bug
// nobody sees until weeks later — their races split across the two, so the
// standings list them twice with a share of their points on each row, the stats
// pages fold them back into one and disagree with the standings, and the results
// grid offers the same name twice with no way to tell which is which.
//
// Every screen that adds a driver already asks whether they're on the roster
// first, but "already asks" has been true of three different screens with three
// copies of the rule, and the copies are not the same: the one in the "＋ Create
// new driver" dialog answered "use the driver you already have" by writing a
// SECOND entry for them, which is exactly how a duplicate gets made by an admin
// doing the careful thing. So the rule lives here, in one place, and the API
// applies it on the way in (see app/api/entries/route.js) — a duplicate can then
// only arrive by writing to Firestore directly.
//
// Pure: no Firestore, so the matching rule is testable on its own.

import { entryClassIds } from "@/lib/classFilter";
import { entryIdentityKeys } from "@/lib/teams";

// Are these two roster rows the same person?
//
// Compared on the most specific identity BOTH sides carry — the global driver
// profile, then the linked account, then the name. Two rows that each name a
// DIFFERENT driver profile are never the same person however alike their names
// read, which is what keeps two drivers who share a gamertag apart; a row with
// no profile at all (a legacy entry, or one typed in before the pool existed)
// still matches on the name, which is how the roster and the standings already
// fold it in.
export function sameRosterDriver(a = {}, b = {}) {
  if (a.driver_id && b.driver_id) return a.driver_id === b.driver_id;
  if (a.user_id && b.user_id) return a.user_id === b.user_id;
  // The same name key the rest of the app unifies drivers by (lib/teams.js), so
  // "already on this roster" here and "one row in the standings" there can never
  // answer differently.
  const [ak] = entryIdentityKeys({ name: a.name });
  const [bk] = entryIdentityKeys({ name: b.name });
  return !!ak && ak === bk;
}

// The entry this driver already holds in the season, or null. `roster` is the
// season's entries; `candidate` is the entry being created.
export function findRosterEntry(roster = [], candidate = {}) {
  return roster.find(e => sameRosterDriver(e, candidate)) ?? null;
}

// What reusing that entry changes on it — an empty object when nothing does.
//
// Additive only: the classes being asked for are ADDED to the ones the entry
// already races (adding a driver to a class's grid is what makes them show up in
// it), and a car number fills a blank. Nothing already on the entry is
// overwritten, because this is a create that turned out to be a duplicate, not
// an edit somebody asked for — the roster screen is where an entry is changed.
export function reusePatch(entry = {}, candidate = {}) {
  const patch = {};
  const have = entryClassIds(entry);
  const wanted = entryClassIds(candidate);
  const added = wanted.filter(c => !have.includes(c));
  if (added.length) {
    patch.class_ids = [...have, ...added];
    patch.class_id = patch.class_ids[0] || "";
  }
  const number = candidate.number == null ? "" : String(candidate.number).trim();
  if (number && (entry.number == null || entry.number === "")) patch.number = number;
  return patch;
}
