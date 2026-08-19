// Laps completed, on a grid that holds more than one class.
//
// The rule these exist to enforce: classes sharing one results grid do NOT all
// complete the same number of laps. The slower class takes the checkered flag
// having run fewer than the outright leader — that is what a multi-class race
// is. So the scheduled distance is filled in for nobody there; each class's
// figure is typed by the statistician, and only that typed figure fills a
// column. (A grid that is one class by construction — a per-class session, a
// "<class> only" round, a single-class season — is unaffected and still counts
// off the scheduled distance exactly as it always has.)
//
// The pieces live here rather than inside SessionEditor because they're the
// part of it worth testing on its own: given rows in, which rows change and to
// what. See lib/raceLength.js for which distance a given SESSION is scheduled
// for, which is the other half of the same question.

import { deriveLaps, parseLapsDown } from "@/lib/raceTime";

// A row's class, with the unclassified bucket as "" — the same key the boxes
// and the per-class fill are keyed by.
const classKey = row => row.class_id || "";

// Rows in finishing order, blanks last. Local to this file so the ordering the
// per-class boxes appear in can't drift from the ordering the grid shows.
function byFinish(rows) {
  return [...rows].sort((a, b) => {
    const av = a.finish_pos === "" || a.finish_pos == null ? Infinity : Number(a.finish_pos);
    const bv = b.finish_pos === "" || b.finish_pos == null ? Infinity : Number(b.finish_pos);
    return av - bv;
  });
}

// The classes actually on this grid, each with the name to label its box with,
// ordered by where that class's best finisher sits. Read off the ROWS rather
// than off the season's class list, so the bar only ever asks for a distance
// for classes that turned up, and grows as drivers are entered.
//
// A class the season no longer lists (deleted, or renamed away) still gets a
// box — its drivers are on the grid and their laps still have to be entered —
// labelled as unclassified, which is how the rest of the grid reads it too.
export function classesOnGrid(rows = [], classes = []) {
  const seen = [];
  for (const r of byFinish(rows)) {
    if (!r.entry_id) continue;
    const id = classKey(r);
    if (!seen.includes(id)) seen.push(id);
  }
  return seen.map(id => ({ id, name: classes.find(c => c.id === id)?.name ?? "Unclassified" }));
}

// Put one class's distance onto that class's rows.
//
// Each row derives from it exactly the way it always has off a scheduled total:
// a lead-lap finisher gets the figure itself, a car N laps down (Int "3L") gets
// it minus N, and a DNF / DNS / DQ is left alone — the lap they stopped on is
// theirs, and nothing can infer it.
//
// A blank or non-positive figure changes NOTHING. Clearing the box must not be
// able to wipe a column the statistician has already filled, so this only ever
// writes a value in, never takes one out. Returns the same array reference when
// nothing moved, so React state settles rather than re-rendering in a loop.
export function fillClassLaps(rows = [], classId, laps) {
  const total = Number(laps);
  if (!(total > 0)) return rows;
  const key = classId || "";
  let changed = false;
  const next = rows.map(r => {
    if (!r.entry_id || classKey(r) !== key) return r;
    const d = deriveLaps(r, total);
    if (d == null || String(d) === r.laps) return r;
    changed = true;
    return { ...r, laps: String(d) };
  });
  return changed ? next : rows;
}

// Reopening a saved multi-class sheet: what each class's distance evidently
// was, read back off the rows — the highest Laps figure among that class's
// lead-lap finishers, which is the distance that class ran. Cars laps down and
// retirements are skipped: their lap count is short by definition, so it can't
// speak for the class.
//
// Keyed by class id ("" for unclassified), as strings, because it fills text
// inputs. Used for nothing but showing the boxes: a reopened sheet says what it
// was entered with instead of coming up blank and looking unset.
export function seedClassLaps(rows = []) {
  const out = {};
  for (const r of rows) {
    if (!r.entry_id || r.status !== "finished") continue;
    if (parseLapsDown(r.interval) != null) continue;
    const n = Number(r.laps);
    if (!(n > 0)) continue;
    const key = classKey(r);
    if (!(Number(out[key]) >= n)) out[key] = String(n);
  }
  return out;
}

// Rows with a driver but no lap count. A blank Laps cell saves as 0, and 0 laps
// completed is a number the stats will believe — so on a grid where nothing
// fills it in on the admin's behalf, these are named on screen rather than left
// to be noticed later.
export function rowsMissingLaps(rows = []) {
  return rows.filter(r => r.entry_id && String(r.laps ?? "").trim() === "");
}
