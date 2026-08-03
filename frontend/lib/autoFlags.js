// Auto-derived race bonus flags for the results grid.
//
// Three of the per-row checkboxes on a race/heat/consolation/feature grid are
// things the admin would otherwise have to work out by eye from data they've
// already typed in:
//
//   • Fastest Lap  — whoever set the quickest Best Lap time (a single entered
//                    lap time is, trivially, the fastest one).
//   • Hard Charger — whoever gained the most positions from start to finish;
//                    ties go to the driver who finished highest.
//   • Most Laps Led — whoever led the most laps, when Led is being tracked at
//                    all. Ties share it, matching how the bonus has always
//                    been scored.
//
// So the grid fills them in as the numbers are entered. None of this changes
// scoring on its own — a flag is only worth points if the season (or the
// session's points structure) puts a value on that bonus.
//
// Every auto pick stays overridable: the moment an admin ticks or unticks one
// of these boxes themselves, that flag is "locked" for the session and the
// grid stops moving it (see detectFlagLocks / applyAutoFlags below). Locks are
// per-flag, so hand-placing the Hard Charger doesn't freeze Fastest Lap.

import { parseTime } from "@/lib/raceTime";

export const AUTO_FLAG_FIELDS = ["fastest_lap", "hard_charger", "most_laps_led"];

// Didn't take the green flag / was thrown out — never an auto Hard Charger,
// however flattering the arithmetic looks. A DNF still counts: they raced, and
// their classified finishing position is real.
const DID_NOT_RACE = new Set(["dns", "dq"]);

const filled = rows => rows.filter(r => r.entry_id);
const laps = r => Number(r.laps_led || 0) || 0;

// Slot that set the quickest Best Lap time. Ties go to the row listed first
// (the better finishing position). Null when no lap times are entered.
export function autoFastestLapSlot(rows) {
  let best = null;
  for (const r of filled(rows)) {
    const t = parseTime(r.fastest_lap_time);
    if (t == null || t <= 0) continue;
    if (best == null || t < best.t) best = { t, slot_id: r.slot_id };
  }
  return best?.slot_id ?? null;
}

// Slot that gained the most positions start → finish. Ties go to whoever
// finished highest. Null when nobody moved forward (or starting positions
// haven't been entered).
export function autoHardChargerSlot(rows) {
  let best = null;
  for (const r of filled(rows)) {
    if (DID_NOT_RACE.has(String(r.status || "").toLowerCase())) continue;
    const start = Number(r.start_pos);
    const finish = Number(r.finish_pos);
    if (!(start > 0) || !(finish > 0)) continue;
    const gained = start - finish;
    if (gained <= 0) continue;
    if (best == null || gained > best.gained || (gained === best.gained && finish < best.finish)) {
      best = { gained, finish, slot_id: r.slot_id };
    }
  }
  return best?.slot_id ?? null;
}

// Slots that led the most laps — plural, because a tie on laps led has always
// been scored as a shared bonus. Empty when laps led isn't being tracked.
export function autoMostLapsLedSlots(rows) {
  const most = filled(rows).reduce((m, r) => Math.max(m, laps(r)), 0);
  if (most <= 0) return [];
  return filled(rows).filter(r => laps(r) === most).map(r => r.slot_id);
}

// The auto value of every flag, as slot_id -> { field: boolean }.
function autoFlags(rows) {
  const fastest = autoFastestLapSlot(rows);
  const charger = autoHardChargerSlot(rows);
  const led = new Set(autoMostLapsLedSlots(rows));
  return row => ({
    fastest_lap: row.slot_id === fastest,
    hard_charger: row.slot_id === charger,
    most_laps_led: led.has(row.slot_id),
  });
}

// Re-derives the auto flags across the grid, leaving any locked flag exactly as
// the admin left it. Returns the SAME array reference when nothing changed, so
// this can be run straight from an effect on every edit without looping.
export function applyAutoFlags(rows, locks = {}) {
  if (AUTO_FLAG_FIELDS.every(f => locks[f])) return rows;
  const flagsFor = autoFlags(rows);
  let changed = false;
  const next = rows.map(row => {
    const want = flagsFor(row);
    let out = row;
    for (const field of AUTO_FLAG_FIELDS) {
      if (locks[field]) continue;
      // An empty slot never carries a flag, whatever the arithmetic says.
      const value = row.entry_id ? want[field] : false;
      if (!!out[field] === value) continue;
      out = { ...out, [field]: value };
      changed = true;
    }
    return out;
  });
  return changed ? next : rows;
}

// Which flags a set of rows has already been hand-set on — used when loading
// saved results, so an admin's earlier override is respected instead of being
// silently re-derived. A flag counts as locked when what's stored differs from
// what the grid would work out on its own; a stored value that already agrees
// with the auto pick keeps following the data as it's edited.
export function detectFlagLocks(rows) {
  const auto = applyAutoFlags(rows, {});
  const locks = {};
  for (const field of AUTO_FLAG_FIELDS) {
    locks[field] = rows.some((r, i) => !!r[field] !== !!auto[i][field]);
  }
  return locks;
}
