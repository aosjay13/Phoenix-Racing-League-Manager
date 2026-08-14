// A placement night sorts a field of drivers into divisions, and the board is
// how that's done now: buckets across the screen, driver cards dropped into
// them. Four things have to hold or the night ends with a wrong roster:
//
//   1. the buckets are exactly the destinations the admin ticked — no more (a
//      phantom column invites drivers into a division that doesn't exist) and
//      no fewer (a missing column strands them);
//   2. dropping a driver somewhere sets BOTH halves of their placement
//      coherently — a class belongs to one season, and the series decides
//      which season their roster entry is written to;
//   3. nobody vanishes. A driver whose stored placement no longer matches any
//      bucket comes back to the pool, visible, rather than off the screen;
//   4. Auto-Place splits by the metric that was chosen, evenly, quickest
//      first — and leaves alone anyone who never set a lap.
import assert from "node:assert";
import {
  assignRowToBucket, autoPlace, bucketKey, bucketKeyForRow, buildBuckets,
  groupRowsByBucket, pickedClasses, placementProgress, previewAutoPlace,
} from "../placements.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// A league whose divisions are separate series: a Pro Series and an Amateur
// Series, each building its own season's roster.
const proSeries = {
  series_id: "s-pro", series_name: "Pro Series", season_id: "sea-pro", season_name: "Pro 2026", classes: [],
};
const amSeries = {
  series_id: "s-am", series_name: "Amateur Series", season_id: "sea-am", season_name: "Am 2026", classes: [],
};

// ── The buckets are the destinations ────────────────────────────────────────
const seriesBuckets = buildBuckets({ placementSeries: [proSeries, amSeries] });
check("one bucket per ticked series", seriesBuckets.map(b => b.label), ["Pro Series", "Amateur Series"]);
check("they carry the season whose roster they build",
  seriesBuckets.map(b => b.season_id), ["sea-pro", "sea-am"]);
check("nothing is ticked → no buckets", buildBuckets({}), []);

// A series with divisions inside it: buckets are the ticked classes, and only
// the ticked ones — a season with four classes that the admin ticked two of
// must not offer four trays.
const gtSeries = {
  series_id: "s-gt", series_name: "GT Series", season_id: "sea-gt", season_name: "GT 2026",
  classes: [{ id: "c-gt3", name: "GT3" }, { id: "c-gt4", name: "GT4" }, { id: "c-lmp", name: "LMP2" }],
};
const gtBuckets = buildBuckets({ placementSeries: [gtSeries], classIds: ["c-gt3", "c-lmp"] });
check("only the ticked classes become buckets", gtBuckets.map(b => b.label), ["GT3", "LMP2"]);
check("each says which series and season it belongs to",
  gtBuckets[0].sub, "GT Series · GT 2026");
// Ticking the series but none of its classes places into the series itself.
check("a series with no ticked classes is one bucket",
  buildBuckets({ placementSeries: [gtSeries] }).map(b => b.label), ["GT Series"]);

// The ordinary case: classes inside the session's own season.
const ownBuckets = buildBuckets({
  placementClasses: [{ id: "c-pro", name: "Pro" }, { id: "c-am", name: "Amateur" }],
  trialSeasonId: "sea-1", seasonName: "Season 4",
});
check("one bucket per class of the session's own season",
  ownBuckets.map(b => b.label), ["Pro", "Amateur"]);
check("own-season buckets carry no series", ownBuckets.map(b => b.series_id), ["", ""]);

// A series pointed at the session's OWN season is the same set of divisions —
// listing it twice would let one driver be in two columns at once.
const folded = buildBuckets({
  placementSeries: [{ ...gtSeries, season_id: "sea-1" }],
  placementClasses: [{ id: "c-gt3", name: "GT3" }],
  classIds: ["c-gt3"],
  trialSeasonId: "sea-1",
});
check("a series on this season's own classes isn't duplicated", folded.map(b => b.label), ["GT3"]);
check("…and it stays an own-season bucket", folded[0].series_id, "");

// A destination with no season behind it can't build a roster; the board is
// told so it can say so before the night is spent filling it.
check("a series with no season is flagged",
  buildBuckets({ placementSeries: [{ series_id: "s-x", series_name: "X", classes: [] }] })[0].incomplete, true);

// ── Dropping a driver ───────────────────────────────────────────────────────
check("a class bucket sets both halves",
  assignRowToBucket({}, gtBuckets[0]),
  { assigned_series_id: "s-gt", assigned_class_id: "c-gt3" });
check("an own-season class clears any series",
  assignRowToBucket({ assigned_series_id: "s-old" }, ownBuckets[0]),
  { assigned_series_id: "", assigned_class_id: "c-pro" });
// Moving somebody to another series keeps their division only where the new
// series actually runs it — otherwise it's a class id that season doesn't have.
check("a division that survives the move is kept",
  assignRowToBucket({ assigned_class_id: "c-gt3" }, seriesBuckets[0], { classIdsFor: () => ["c-gt3"] }),
  { assigned_series_id: "s-pro", assigned_class_id: "c-gt3" });
check("a division the new series doesn't run is cleared",
  assignRowToBucket({ assigned_class_id: "c-gt3" }, seriesBuckets[0], { classIdsFor: () => ["c-other"] }),
  { assigned_series_id: "s-pro", assigned_class_id: "" });
check("dropping back into the pool clears both",
  assignRowToBucket({ assigned_series_id: "s-pro", assigned_class_id: "c-gt3" }, null),
  { assigned_series_id: "", assigned_class_id: "" });
check("a row's bucket key is its placement", bucketKeyForRow({ assigned_series_id: "a", assigned_class_id: "b" }), bucketKey("a", "b"));

// ── Nobody vanishes ─────────────────────────────────────────────────────────
const rows = [
  { id: "r1", name: "Ana", best_seconds: 80.1, avg_seconds: 81.9, assigned_series_id: "", assigned_class_id: "c-pro" },
  { id: "r2", name: "Ben", best_seconds: 80.9, avg_seconds: 81.0, assigned_series_id: "", assigned_class_id: "c-am" },
  { id: "r3", name: "Cal", best_seconds: 81.5, avg_seconds: 81.6, assigned_series_id: "", assigned_class_id: "" },
  // Placed into a division that is no longer one of the night's destinations.
  { id: "r4", name: "Dee", best_seconds: 82.0, avg_seconds: 82.4, assigned_series_id: "", assigned_class_id: "c-gone" },
  { id: "r5", name: "Eve", best_seconds: null, avg_seconds: null, assigned_series_id: "", assigned_class_id: "" },
];
const grouped = groupRowsByBucket(rows, ownBuckets);
check("each bucket holds its own drivers", grouped.byBucket.get(bucketKey("", "c-pro")).map(r => r.name), ["Ana"]);
check("a stale placement returns to the pool, not to nowhere",
  grouped.unplaced.map(r => r.name), ["Cal", "Dee", "Eve"]);
check("everyone is accounted for exactly once",
  [...grouped.byBucket.values()].flat().length + grouped.unplaced.length, rows.length);
// The pool and every bucket are in ranked order, so the board reads like the
// sheet does.
check("buckets are ranked quickest first",
  groupRowsByBucket(rows, ownBuckets).unplaced.map(r => r.name), ["Cal", "Dee", "Eve"]);
check("progress counts what's placed", placementProgress(rows, ownBuckets), { placed: 2, unplaced: 3, total: 5 });

// ── Auto-Place ──────────────────────────────────────────────────────────────
// Four drivers with a time (Eve set none) across two buckets: the quickest two
// into the first, the next two into the second.
const byBest = autoPlace(rows, ownBuckets, { key: "best" });
check("the quickest go to the first bucket",
  [byBest.r1, byBest.r2], [bucketKey("", "c-pro"), bucketKey("", "c-pro")]);
check("the rest go to the second",
  [byBest.r3, byBest.r4], [bucketKey("", "c-am"), bucketKey("", "c-am")]);
check("a driver with no lap is left in the pool", byBest.r5, undefined);

// The two metrics genuinely disagree, which is why the admin is asked: Ben's
// average is better than Ana's even though her single lap is quicker.
const byAvg = autoPlace(rows, ownBuckets, { key: "average" });
check("average puts the consistent driver in the top bucket", byAvg.r2, bucketKey("", "c-pro"));
check("…and the one-lap-wonder in the second", byAvg.r1, bucketKey("", "c-am"));

// The remainder lands on the quicker end: nobody wants the slow division to be
// the big one.
const three = rows.slice(0, 3);
const uneven = previewAutoPlace(three, ownBuckets, { key: "best" });
check("an odd field fills the quicker division first", uneven.counts.map(c => c.count), [2, 1]);
check("the preview says how many it will place", uneven.placing, 3);
check("…and who it won't", previewAutoPlace(rows, ownBuckets).noTime, ["Eve"]);
check("no buckets means nothing is placed", autoPlace(rows, []), {});

// ── Regressions ─────────────────────────────────────────────────────────────

// Phantom columns. A night that places only into another series' season still
// carries class ids — just not THIS season's — and reading that as "nothing
// picked" put every class of this season on the board uninvited.
const ownClasses = [{ id: "c-pro", name: "Pro" }, { id: "c-am", name: "Amateur" }];
check("nothing ticked offers them all", pickedClasses(ownClasses, []), ownClasses);
check("a ticked subset is honoured", pickedClasses(ownClasses, ["c-am"]), [ownClasses[1]]);
check("ticks that all belong elsewhere offer NONE of this season's",
  pickedClasses(ownClasses, ["c-gt3", "c-gt4"]), []);
// The same, end to end: only the ticked division becomes a column.
check("…so the board shows only what was ticked",
  buildBuckets({
    placementSeries: [gtSeries],
    placementClasses: pickedClasses(ownClasses, ["c-gt3"]),
    classIds: ["c-gt3"],
    trialSeasonId: "sea-1",
  }).map(b => b.label),
  ["GT3"]);

// Auto-Place must report what it will actually MOVE. Counting drivers who have
// a time instead had the modal offering to "Place 4 Drivers" with nowhere to
// put them and every column count reading zero.
const nowhere = previewAutoPlace(rows, [], { key: "best" });
check("nothing to place when there are no destinations", nowhere.placing, 0);
check("…and the assignment is empty to match", nowhere.assignment, {});
check("placing equals what the assignment actually holds",
  previewAutoPlace(rows, ownBuckets, { key: "best" }).placing, 4);

console.log(`placements: ${n} assertions passed`);
