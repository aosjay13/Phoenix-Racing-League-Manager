// The duplicate eliminator has to be right in two directions at once, and the
// two failures are not symmetrical.
//
// Missing a duplicate leaves things exactly as they are now: one circuit filed
// under three names, three small wrong histories, and a driver's Daytona record
// split across all of them. Annoying, and the admin can still merge by hand.
//
// Offering a WRONG merge is worse, because it is the one thing in this app that
// a press cannot undo: weld Richmond Raceway's races onto Richmond Dragway and
// the only way back is to rebuild both by hand. And the shape that does it is
// not exotic — it is two real circuits in one town, or the oval and the road
// course at the same venue, which is the exact thing the tool is searching for.
//
// So this pins both: the duplicates that must be FOUND and ticked, and the
// look-alikes that must arrive unticked with a reason written on them.
import assert from "node:assert";
import {
  conflictBetween, countTrackRaces, findDuplicateTrackGroups, layoutWords, planGroupMerge,
  suggestedMergeName, suggestedSurvivor, trackKey, trackSimilarity, venueCore,
} from "../trackMerge.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── Reading a venue name ────────────────────────────────────────────────────

check("shorthand spelled out", trackKey("Daytona Int'l Spdwy"), "daytona international speedway");
check("case and punctuation dropped", trackKey("DAYTONA — International  Speedway"), "daytona international speedway");
check("accents folded", trackKey("Autódromo José Carlos Pace"), "autodrome jose carlos pace");
check("venue words stripped", venueCore("Daytona International Speedway"), "daytona");
check("a bare name is already its core", venueCore("Daytona"), "daytona");
check("a name that is nothing but venue words keeps them", venueCore("The Speedway"), "the speedway");
check("layout words survive the core", venueCore("Road Atlanta"), "road atlanta");
check("layouts read off a name", layoutWords("Charlotte Motor Speedway - Roval"), ["roval"]);
check("no layout named", layoutWords("Talladega Superspeedway"), []);

ok("long and short forms match", trackSimilarity("Daytona", "Daytona International Speedway") > 0.9);
ok("shorthand matches the full name", trackSimilarity("Daytona Intl Spdwy", "Daytona International Speedway") === 1);
ok("a typo still matches", trackSimilarity("Talledega Superspeedway", "Talladega Superspeedway") > 0.86);
ok("two different circuits do not", trackSimilarity("Bristol Motor Speedway", "Martinsville Speedway") < 0.7);
// Nearly every venue name ends in the same few words, so comparing them whole
// makes unrelated circuits look related: "Charlotte Motor Speedway" and
// "Atlanta Motor Speedway" share two thirds of their letters and are three
// hundred miles apart. Left unchecked this dragged five separate venues into
// one review group.
ok("a shared “Motor Speedway” is not a match",
  trackSimilarity("Charlotte Motor Speedway", "Atlanta Motor Speedway") < 0.7);
ok("nor is a shared “International Speedway”",
  trackSimilarity("Michigan International Speedway", "Daytona International Speedway") < 0.7);
// But a typo IN the venue word, where the cores no longer line up, still is.
ok("a misspelt venue word still matches",
  trackSimilarity("Daytona International Speedwy", "Daytona International Speedway") > 0.86);
ok("same town, different venue, stays under the confident bar",
  trackSimilarity("Texas Motor Speedway", "Texas World Speedway") < 0.86);

// ── What must never be merged without a human saying so ─────────────────────

const oval = { id: "t1", name: "Daytona International Speedway", track_type: "Superspeedway" };
const road = { id: "t2", name: "Daytona International Speedway Road Course", track_type: "Road Course" };
ok("a type disagreement is flagged", conflictBetween(oval, road).includes("Superspeedway"));
ok("and it reads as English", conflictBetween({ id: "a", name: "A", track_type: "Oval" },
  { id: "b", name: "B", track_type: "Short Track" }).includes("is an Oval and “B” is a Short Track"));
ok("a layout disagreement is flagged",
  conflictBetween({ id: "a", name: "Daytona Oval" }, { id: "b", name: "Daytona Road Course" }).includes("layout"));
ok("naming a layout on one side only is flagged",
  conflictBetween({ id: "a", name: "Indianapolis Motor Speedway" },
                  { id: "b", name: "Indianapolis Motor Speedway Road Course" }).includes("layout"));
check("nothing to disagree about", conflictBetween(
  { id: "a", name: "Daytona", track_type: "Superspeedway" },
  { id: "b", name: "Daytona International Speedway", track_type: "Superspeedway" }), "");
check("a blank type is not a disagreement", conflictBetween(
  { id: "a", name: "Daytona", track_type: "" },
  { id: "b", name: "Daytona International Speedway", track_type: "Superspeedway" }), "");

// ── The scan ────────────────────────────────────────────────────────────────

// The real shape of the mess: one circuit entered afresh every time somebody
// set up a round there, plus an unrelated venue that must be left alone.
const pool = [
  { id: "d1", name: "Daytona", location: "", track_type: "" },
  { id: "d2", name: "Daytona International Speedway", location: "Daytona Beach, FL", track_type: "Superspeedway", length: "2.5 mi" },
  { id: "d3", name: "DAYTONA INTL SPEEDWAY", location: "", track_type: "" },
  { id: "m1", name: "Martinsville Speedway", location: "Ridgeway, VA", track_type: "Short Track" },
];
const groups = findDuplicateTrackGroups(pool, { raceCounts: { d1: 2, d2: 9, d3: 1, m1: 6 } });

// The regression that made a scan useless: unrelated venues sharing a generic
// suffix chain-unioned into one giant group, because A matched B matched C on
// nothing but the words "Motor Speedway".
const suffixes = findDuplicateTrackGroups([
  { id: "c", name: "Charlotte Motor Speedway", track_type: "Oval" },
  { id: "a", name: "Atlanta Motor Speedway", track_type: "Superspeedway" },
  { id: "b", name: "Bristol Motor Speedway", track_type: "Short Track" },
  { id: "t", name: "Texas Motor Speedway", track_type: "Oval" },
], {});
check("a shared suffix groups nothing", suffixes, []);

check("one circuit, one group", groups.length, 1);
check("every copy is in it", groups[0].tracks.map(t => t.id).sort(), ["d1", "d2", "d3"]);
check("the copy with the most races survives", groups[0].survivor_id, "d2");
check("the fullest name is offered", groups[0].suggested_name, "Daytona International Speedway");
check("all three are ticked", groups[0].tracks.filter(t => t.suggested).length, 3);
check("the group is clean", groups[0].clean, true);
check("the unrelated venue is left out", groups.flatMap(g => g.tracks.map(t => t.id)).includes("m1"), false);
check("races at stake are totalled", groups[0].races, 12);

// A SHOUTED name loses to the same name in normal case — it ends up in a page
// title.
check("shouting loses the naming", suggestedMergeName([
  { id: "a", name: "DAYTONA INTERNATIONAL SPEEDWAY" },
  { id: "b", name: "Daytona International Speedway" },
]), "Daytona International Speedway");

// Nothing has raced anywhere yet, so the fullest profile is the one to keep.
check("detail breaks a tie with no races", suggestedSurvivor([
  { id: "a", name: "Daytona" },
  { id: "b", name: "Daytona International Speedway", location: "Daytona Beach, FL", track_type: "Superspeedway" },
], {}).id, "b");

// The transitive case: a misspelling and a bare name that never meet each
// other, but both meet the correctly spelled full name. One group, one merge.
const spelling = findDuplicateTrackGroups([
  { id: "a", name: "Talladega" },
  { id: "b", name: "Talladega Superspeedway" },
  { id: "c", name: "Talledega Superspeedway" },
], {});
check("a chain of near-matches is one group", spelling.length, 1);
check("all three come along", spelling[0].tracks.length, 3);

// The oval and the road course at one venue: found, shown together, and NOT
// ticked — merging them would skew exactly the per-track stats this feature
// exists to unskew.
const layouts = findDuplicateTrackGroups([
  { id: "o", name: "Daytona International Speedway", track_type: "Superspeedway" },
  { id: "r", name: "Daytona International Speedway Road Course", track_type: "Road Course" },
], { raceCounts: { o: 8, r: 1 } });
check("the layouts are reviewed together", layouts[0].tracks.length, 2);
check("the road course is not ticked", layouts[0].tracks.find(t => t.id === "r").suggested, false);
ok("and it says why", layouts[0].tracks.find(t => t.id === "r").conflict.length > 0);
check("so the group is not clean", layouts[0].clean, false);
check("and the unticked name cannot name the merge", layouts[0].suggested_name, "Daytona International Speedway");

// One name sitting inside another is offered for review, never pre-ticked:
// "Spa" inside "Spa Francorchamps" is one circuit, "Texas" inside "Texas World
// Speedway" is two, and the names alone cannot tell them apart.
const inside = findDuplicateTrackGroups([
  { id: "t1", name: "Texas Motor Speedway", track_type: "Oval" },
  { id: "t2", name: "Texas World Speedway", track_type: "Oval" },
], { raceCounts: { t1: 5, t2: 0 } });
check("the look-alike is still shown", inside.length, 1);
check("but it arrives unticked", inside[0].tracks.find(t => t.id === "t2").suggested, false);

// Leagues are separate worlds, and the merge route refuses to cross them — so
// the scan must never offer a pair it could not carry out.
const leagues = findDuplicateTrackGroups([
  { id: "a", name: "Daytona", league_id: "L1" },
  { id: "b", name: "Daytona International Speedway", league_id: "L2" },
], {});
check("two leagues are never one group", leagues.length, 0);

// A venue already cleaned up once answers to its old name, so a fresh copy
// typed under that old name is still found.
const former = findDuplicateTrackGroups([
  { id: "a", name: "Daytona International Speedway", merged_names: ["The Beach"], location: "Daytona Beach, FL" },
  { id: "b", name: "The Beach" },
], { raceCounts: { a: 10 } });
check("a former name still catches a duplicate", former.length, 1);
ok("and the row says which names met", former[0].tracks.find(t => t.id === "b").matched_on.includes("The Beach"));

// ── Counting what is at stake ───────────────────────────────────────────────
//
// These numbers decide which copy of a circuit an admin keeps, so a miscount is
// not cosmetic: it points the merge at the wrong survivor.
const counted = countTrackRaces(
  [
    { id: "d1", name: "Daytona" },
    { id: "d2", name: "Daytona International Speedway", merged_names: ["The Beach"] },
    { id: "m1", name: "Martinsville Speedway" },
  ],
  [
    { id: "r1", track_id: "d2", track: "Daytona International Speedway" },
    { id: "r2", track_id: "d2", track: "Daytona International Speedway" },
    // Legacy: typed as free text before the Tracks database existed.
    { id: "r3", track_id: "", track: "Daytona" },
    { id: "r4", track: "daytona" },                       // however it was cased
    { id: "r5", track: "The Beach" },                     // a name d2 used to use
    // Pinned to Martinsville. The name is Daytona's, but the link is the last
    // word — this race stays where it was put.
    { id: "r6", track_id: "m1", track: "Daytona" },
    { id: "r7", track: "Somewhere Else" },                // no venue in the pool
  ],
);
check("linked races count", counted.d2, 3);
check("free text counts, however it was cased", counted.d1, 2);
check("a linked race is never stolen by a name", counted.m1, 1);

check("a race in another league is left out", countTrackRaces(
  [{ id: "a", name: "Daytona", league_id: "L1" }],
  [{ id: "r", track: "Daytona", league_id: "L2" }],
).a, 0);

// ── What the review panel hands the API ─────────────────────────────────────

const group = groups[0];
check("the plan follows the ticks", planGroupMerge(group, { survivorId: "d2", checkedIds: ["d1", "d3"], name: "" }),
  { into_id: "d2", from_ids: ["d1", "d3"], name: "Daytona International Speedway" });
check("the survivor is never merged into itself",
  planGroupMerge(group, { survivorId: "d2", checkedIds: ["d2", "d1"] }).from_ids, ["d1"]);
check("nothing ticked is nothing to do", planGroupMerge(group, { survivorId: "d2", checkedIds: [] }), null);
check("a typed name wins", planGroupMerge(group, { survivorId: "d2", checkedIds: ["d1"], name: "  Daytona  " }).name, "Daytona");
// Swapping the survivor re-points the merge without losing anyone: the old
// survivor becomes one of the copies folded in.
check("the survivor can be swapped",
  planGroupMerge(group, { survivorId: "d1", checkedIds: ["d2", "d3"] }),
  { into_id: "d1", from_ids: ["d2", "d3"], name: "Daytona International Speedway" });

console.log(`trackMerge: ${n} checks passed`);
