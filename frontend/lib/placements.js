// Placement night, as a board.
//
// A placement session asks one question — which division does each of these
// drivers belong in? — and the honest shape of that question is a pile of
// driver cards and a row of trays to drop them into. It is not a spreadsheet
// column of dropdowns, which is what it used to be: forty rows deep, one
// <select> per row, no way to see the shape of a division without counting,
// and no way to move somebody without hunting for their row.
//
// So this module turns a trial's destinations into BUCKETS and its drivers
// into cards, and answers the four questions the board asks:
//
//   • what buckets are there?          buildBuckets
//   • which bucket is this driver in?  bucketKeyForRow / groupRowsByBucket
//   • what changes when I drop them?   assignRowToBucket
//   • fill them for me, by time        autoPlace
//
// It's pure — no React, no database — so the board, the "Auto-Place" preview
// and the roster run that follows can never disagree about where somebody was
// put (see lib/__tests__/placements.test.mjs).
//
// A DESTINATION is deliberately either kind of division, because leagues run
// both: some split a field into CLASSES inside one season ("Pro" / "Amateur"),
// others into separate SERIES each with its own championship. A bucket is one
// of those, or a class within one of those, and the rest of the app already
// understands both (see lib/timeTrials.js).

import { placedOrder, rankEntries, splitEvenly } from "@/lib/timeTrials";

// A bucket's identity: the (series, class) pair a driver placed there carries.
// Both halves are optional — a series with no divisions inside it is a bucket,
// and so is a class in the session's own season.
export function bucketKey(seriesId = "", classId = "") {
  return `${String(seriesId || "")}::${String(classId || "")}`;
}

export function bucketKeyForRow(row = {}) {
  return bucketKey(row.assigned_series_id, row.assigned_class_id);
}

// The trays on the board, in the order they're drawn — which is the order the
// admin picked them, fastest division first by convention, and the order
// "Auto-Place" fills them in.
//
// The rule is simply "one bucket per destination the admin ticked":
//
//   • a ticked SERIES with ticked classes inside it becomes one bucket per
//     class — that's a league sorting into Pro Series ▸ GT3 and Pro Series ▸
//     LMP2;
//   • a ticked SERIES with no classes ticked becomes one bucket, the series
//     itself — that's a league whose divisions ARE its series;
//   • the session's own season contributes one bucket per ticked class — the
//     ordinary "Pro / Amateur inside this season" placement.
//
// A series whose season IS the session's own season is folded into that last
// group rather than listed twice: it's the same season's classes either way,
// and two columns for one division would let the same driver be "in" both.
export function buildBuckets({
  placementSeries = [], placementClasses = [], classIds = [], trialSeasonId = "", seasonName = "",
} = {}) {
  const picked = new Set((classIds || []).filter(Boolean).map(String));
  const buckets = [];
  const seenClasses = new Set();

  for (const series of placementSeries) {
    if (!series?.series_id) continue;
    // Same season as the sheet's own: its classes are already offered below.
    if (series.season_id && trialSeasonId && series.season_id === trialSeasonId) continue;

    const all = series.classes || [];
    // Only the classes the admin ticked, when they ticked any of this season's.
    const chosen = all.filter(c => picked.has(String(c.id)));
    const divisions = chosen.length ? chosen : [];

    if (!divisions.length) {
      buckets.push({
        key: bucketKey(series.series_id, ""),
        series_id: series.series_id,
        class_id: "",
        label: series.series_name || "Series",
        sub: series.season_name ? `Roster: ${series.season_name}` : "No season picked yet",
        season_id: series.season_id || "",
        season_name: series.season_name || "",
        kind: "series",
        // A destination with no season behind it can't build a roster, and the
        // board says so rather than letting an admin fill it and find out at
        // the end of the night.
        incomplete: !series.season_id,
      });
      continue;
    }
    for (const cls of divisions) {
      if (seenClasses.has(String(cls.id))) continue;
      seenClasses.add(String(cls.id));
      buckets.push({
        key: bucketKey(series.series_id, cls.id),
        series_id: series.series_id,
        class_id: cls.id,
        label: cls.name || "Division",
        sub: `${series.series_name || "Series"}${series.season_name ? ` · ${series.season_name}` : ""}`,
        season_id: series.season_id || "",
        season_name: series.season_name || "",
        kind: "class",
        incomplete: !series.season_id,
      });
    }
  }

  for (const cls of placementClasses) {
    if (!cls?.id || seenClasses.has(String(cls.id))) continue;
    seenClasses.add(String(cls.id));
    buckets.push({
      key: bucketKey("", cls.id),
      series_id: "",
      class_id: cls.id,
      label: cls.name || "Division",
      sub: seasonName ? `${seasonName}` : "This session's season",
      season_id: trialSeasonId,
      season_name: seasonName,
      kind: "class",
      incomplete: !trialSeasonId,
    });
  }

  return buckets;
}

// What moving a driver into a bucket does to their row.
//
// A class belongs to ONE season, and which season a driver's roster entry is
// written to is decided by the series they're in — so the two halves can never
// be set independently. Dropping somebody into a series keeps the division
// they already had only if that series actually runs it; otherwise it's
// cleared rather than left pointing at another season's class, which is an id
// that season's roster cannot resolve.
export function assignRowToBucket(row = {}, bucket = null, { classIdsFor = () => [] } = {}) {
  if (!bucket) return { assigned_series_id: "", assigned_class_id: "" };
  if (bucket.kind === "series") {
    const allowed = classIdsFor(bucket.series_id).map(String);
    return {
      assigned_series_id: bucket.series_id,
      assigned_class_id: allowed.includes(String(row.assigned_class_id || "")) ? row.assigned_class_id : "",
    };
  }
  return { assigned_series_id: bucket.series_id || "", assigned_class_id: bucket.class_id || "" };
}

// The board's contents: every bucket's drivers in ranked order, plus everyone
// still waiting to be placed.
//
// A driver whose stored placement matches no bucket on the board — sorted into
// a series before its divisions were ticked, or into a destination since
// removed — counts as UNPLACED rather than disappearing. Losing a driver off
// the screen because their assignment went stale is exactly the failure this
// board exists to prevent, so they come back to the pool where they can be
// seen and dropped somewhere real.
export function groupRowsByBucket(rows = [], buckets = [], { key = "best" } = {}) {
  const valid = new Set(buckets.map(b => b.key));
  const byBucket = new Map(buckets.map(b => [b.key, []]));
  const unplaced = [];
  for (const row of rankEntries(rows, { key, asc: true })) {
    const k = bucketKeyForRow(row);
    if (valid.has(k)) byBucket.get(k).push(row);
    else unplaced.push(row);
  }
  return { byBucket, unplaced };
}

// How far through the night the admin is — the one number worth showing at the
// top of the screen.
export function placementProgress(rows = [], buckets = []) {
  const { byBucket, unplaced } = groupRowsByBucket(rows, buckets);
  let placed = 0;
  for (const list of byBucket.values()) placed += list.length;
  return { placed, unplaced: unplaced.length, total: rows.length };
}

// "Auto-Place Drivers": rank the field by the chosen metric and deal it evenly
// across the buckets, quickest first — the top of the field into the first
// bucket listed, and so on down.
//
// `key` is the whole question the modal asks: "best" splits on each driver's
// single fastest lap, "average" on their average. They genuinely disagree —
// one rewards a single hot lap, the other rewards consistency — which is why
// it's asked rather than assumed.
//
// Only drivers who actually set a time are placed. A blank sheet row is not
// evidence of pace, and guessing at it would put somebody in a division on the
// strength of nothing; they stay in the pool for the admin to place by hand.
//
// The result is a starting point, never a verdict: it's returned as an
// assignment for the caller to apply, every card stays draggable afterwards,
// and nothing is written until Save.
export function autoPlace(rows = [], buckets = [], { key = "best" } = {}) {
  return splitEvenly(rows, buckets.map(b => b.key), { key, keyOf: row => row.id });
}

// What Auto-Place would do, in words, before it does it: how many drivers land
// in each bucket and who is left out for having no time. Shown in the modal so
// the split is a decision rather than a surprise.
export function previewAutoPlace(rows = [], buckets = [], { key = "best" } = {}) {
  const assignment = autoPlace(rows, buckets, { key });
  const counts = buckets.map(b => ({
    ...b,
    count: Object.values(assignment).filter(k => k === b.key).length,
  }));
  const ranked = placedOrder(rows, { key });
  return {
    assignment,
    counts,
    placing: ranked.length,
    // Everyone the split leaves alone, by name, so "why is Dave still in the
    // pool?" is answered on the screen that caused it.
    noTime: rows.filter(r => !assignment[r.id]).map(r => r.name || "Unnamed"),
  };
}

// The metric labels, shared by the modal and the board header so the sheet
// never says it sorted on one thing while the buckets were filled by another.
export const PLACEMENT_METRICS = [
  { key: "best", label: "Best Lap", hint: "Their single fastest lap — rewards outright pace." },
  { key: "average", label: "Average Lap", hint: "Their average lap time — rewards consistency over a run." },
];
