// Two rules about laps completed, both of which exist because a wrong number
// entered here is a wrong number in the championship:
//
//   1. A heat weekend runs three distances off one event doc. The Feature's
//      `total_laps` is the public one — the Schedule, the Calendar and the Race
//      Info card print it and nothing else — while `heat_laps` and
//      `consolation_laps` are preliminary distances the RESULTS GRID counts off
//      and no reader ever sees. Left unset, a preliminary session counts off the
//      Feature distance exactly as it did before either field existed.
//
//   2. Classes sharing one grid do not all complete the same number of laps —
//      the slower class takes the flag having run fewer than the outright
//      leader. So a multi-class grid auto-fills nothing from the scheduled
//      distance; each class's figure is typed by the statistician and only that
//      typed figure fills a column.
//
// The lib rules are checked behaviourally. The grid's wiring is checked at
// source level, the way resultsGridSafety.test.mjs checks its own — the
// component needs a live DOM to drive, and what has to hold here is which
// distance each derivation is handed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LENGTH_LAPS, LENGTH_ROUNDS, LENGTH_TIME,
  hasSessionLaps, raceLengthLabel, scheduledLaps,
  sessionLapsBody, sessionLapsForm, sessionScheduledLaps,
} from "@/lib/raceLength";
import { deriveLaps } from "@/lib/raceTime";
import { COPIED_RACE_FIELDS } from "@/lib/raceCopy";
import { classesOnGrid, fillClassLaps, rowsMissingLaps, seedClassLaps } from "@/lib/sessionLaps";
import { SessionLapsFields } from "@/components/SessionLapsFields";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// ── 1. Which distance each session counts off ─────────────────────────────

const weekend = {
  length_type: LENGTH_LAPS, total_laps: 50, heat_laps: 8, consolation_laps: 15,
  heat_format: true, heats: ["Heat 1", "Heat 2"], consolations: ["B-Main"],
};

eq("the Feature counts off the event's own distance", sessionScheduledLaps(weekend, "feature"), 50);
eq("a standard race counts off the same", sessionScheduledLaps(weekend, "race"), 50);
eq("a heat counts off the heat distance", sessionScheduledLaps(weekend, "heat"), 8);
eq("a consolation counts off the consolation distance", sessionScheduledLaps(weekend, "consolation"), 15);
eq("qualifying isn't a distance session either way", sessionScheduledLaps(weekend, "qualifying"), 50);
eq("no session type named reads as the main race", sessionScheduledLaps(weekend), 50);

// The whole compatibility promise: an event that never sets one is unmoved.
const noPrelims = { length_type: LENGTH_LAPS, total_laps: 50, heat_format: true };
eq("an unset heat distance falls back to the feature's", sessionScheduledLaps(noPrelims, "heat"), 50);
eq("…and so does an unset consolation distance", sessionScheduledLaps(noPrelims, "consolation"), 50);
eq("a zero reads as unset, not as zero laps", sessionScheduledLaps({ ...noPrelims, heat_laps: 0 }, "heat"), 50);
eq("so does a blank", sessionScheduledLaps({ ...noPrelims, heat_laps: "" }, "heat"), 50);
eq("and so does nonsense", sessionScheduledLaps({ ...noPrelims, heat_laps: "eight" }, "heat"), 50);

// An event with no distance at all has nothing for any session to count off.
eq("no feature distance and no heat distance is still nothing", sessionScheduledLaps({ length_type: LENGTH_LAPS }, "heat"), null);
eq("a heat distance alone still answers for the heats", sessionScheduledLaps({ length_type: LENGTH_LAPS, heat_laps: 8 }, "heat"), 8);

// A race measured by the clock or in rounds has no scheduled distance for ANY
// of its sessions — a stale preliminary figure must not resurrect one.
const timed = { length_type: LENGTH_TIME, race_minutes: 45, heat_laps: 8 };
const rounds = { length_type: LENGTH_ROUNDS, total_rounds: 6, consolation_laps: 15 };
eq("a timed event's heats are still typed by hand", sessionScheduledLaps(timed, "heat"), null);
eq("a timed event's feature too", sessionScheduledLaps(timed, "feature"), null);
eq("a rounds event's consolations are typed by hand", sessionScheduledLaps(rounds, "consolation"), null);
eq("a missing race is nothing, not a crash", sessionScheduledLaps(null, "heat"), null);

eq("heats have a distance of their own to set", hasSessionLaps("heat"), true);
eq("consolations do too", hasSessionLaps("consolation"), true);
eq("the feature's distance IS total_laps", hasSessionLaps("feature"), false);
eq("and a standard race's is as well", hasSessionLaps("race"), false);

// ── 2. The grid derives the same way off a preliminary distance ────────────
//
// The rules that already governed a feature (lead lap → the full distance, "3L"
// → distance − 3, a retirement → typed by hand) must hold identically once the
// distance handed in is the heat's.

const heatLaps = sessionScheduledLaps(weekend, "heat");
eq("a lead-lap heat finisher gets the heat distance", deriveLaps({ status: "finished", interval: "+1.2" }, heatLaps), 8);
eq("two laps down in a heat is the heat distance minus two", deriveLaps({ status: "finished", interval: "2L" }, heatLaps), 6);
eq("a heat DNF stays manual", deriveLaps({ status: "dnf", interval: "" }, heatLaps), null);
eq("laps down can't go below zero", deriveLaps({ status: "finished", interval: "20L" }, heatLaps), 0);
eq("the same driver in the feature counts off fifty", deriveLaps({ status: "finished", interval: "" }, sessionScheduledLaps(weekend, "feature")), 50);

// ── 3. Nothing public reads a preliminary distance ─────────────────────────
//
// The visibility rule, asserted where it can actually be broken: the label the
// Schedule / Calendar / Race Info card all print, and the scheduled figure the
// event roll-up carries.

eq("the printed length is the feature's, on a weekend with heats set", raceLengthLabel(weekend), "50 Laps");
eq("…and is unchanged by heat laps existing at all", raceLengthLabel(weekend), raceLengthLabel({ length_type: LENGTH_LAPS, total_laps: 50 }));
eq("an event with ONLY a heat distance still prints nothing", raceLengthLabel({ length_type: LENGTH_LAPS, heat_laps: 8 }), null);
eq("scheduledLaps stays the feature's", scheduledLaps(weekend), 50);

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
// Strip comments before searching source, so the prose explaining a rule can
// never be what satisfies the check for it.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

for (const [file, screen] of [
  ["app/schedule/page.js", "the Schedule"],
  ["app/calendar/page.js", "the Calendar"],
  ["app/races/[id]/page.js", "the event's Race Info card"],
  ["lib/raceSummaryServer.js", "the event roll-up"],
  ["lib/trackStatsServer.js", "the track records"],
  ["lib/icsFeed.js", "the calendar feed"],
]) {
  const src = strip(read(file));
  ok(`${screen} never reads heat_laps`, !src.includes("heat_laps"));
  ok(`${screen} never reads consolation_laps`, !src.includes("consolation_laps"));
}

// They do travel with a copied race, though — they describe how this weekend is
// run, and a copy that dropped them is a copy an admin has to re-type.
ok("a copied race carries its heat distance", COPIED_RACE_FIELDS.includes("heat_laps"));
ok("…and its consolation distance", COPIED_RACE_FIELDS.includes("consolation_laps"));

// ── 4. Form ↔ doc ─────────────────────────────────────────────────────────

eq("a saved event fills both boxes", sessionLapsForm(weekend), { heat_laps: "8", consolation_laps: "15" });
eq("an event that set neither opens blank, not on 0", sessionLapsForm(noPrelims), { heat_laps: "", consolation_laps: "" });
eq("a stored 0 reads as unset", sessionLapsForm({ heat_laps: 0, consolation_laps: 0 }), { heat_laps: "", consolation_laps: "" });
eq("no race at all is blank", sessionLapsForm(), { heat_laps: "", consolation_laps: "" });

eq("typed figures are written as numbers",
  sessionLapsBody({ length_type: LENGTH_LAPS, heat_laps: "8", consolation_laps: "15" }, true),
  { heat_laps: 8, consolation_laps: 15 });
eq("blanks are written back as unset",
  sessionLapsBody({ length_type: LENGTH_LAPS, heat_laps: "", consolation_laps: "" }, true),
  { heat_laps: 0, consolation_laps: 0 });
eq("switching heat racing off clears both — the sessions they describe are gone",
  sessionLapsBody({ length_type: LENGTH_LAPS, heat_laps: "8", consolation_laps: "15" }, false),
  { heat_laps: 0, consolation_laps: 0 });
eq("switching to a timed race clears them too",
  sessionLapsBody({ length_type: LENGTH_TIME, race_minutes: "45", heat_laps: "8", consolation_laps: "15" }, true),
  { heat_laps: 0, consolation_laps: 0 });
eq("a negative is not a distance", sessionLapsBody({ heat_laps: "-4", consolation_laps: "0" }, true), { heat_laps: 0, consolation_laps: 0 });
eq("a fraction of a lap is rounded, not stored", sessionLapsBody({ heat_laps: "8.6" }, true), { heat_laps: 9, consolation_laps: 0 });
eq("nonsense is unset", sessionLapsBody({ heat_laps: "eight" }, true), { heat_laps: 0, consolation_laps: 0 });

// The round trip an admin actually performs: open the event, change nothing,
// save. Both figures must come back exactly as they went in.
eq("open → save with no edit leaves the event untouched",
  sessionLapsBody({ ...sessionLapsForm(weekend), length_type: LENGTH_LAPS }, true),
  { heat_laps: 8, consolation_laps: 15 });

// ── 5. The form fields ─────────────────────────────────────────────────────

const renderFields = value => renderToStaticMarkup(
  <SessionLapsFields value={value} onPatch={() => {}} idPrefix="t" />
);

const lapForm = renderFields({ length_type: LENGTH_LAPS, heat_laps: "8", consolation_laps: "15" });
ok("a heat laps box is rendered", lapForm.includes('id="t_heat_laps"'));
ok("a consolation laps box is rendered", lapForm.includes('id="t_consolation_laps"'));
ok("both are numeric", (lapForm.match(/type="number"/g) || []).length === 2);
ok("both are optional, and say so", (lapForm.match(/\(optional\)/g) || []).length === 2);
ok("the entered heat distance shows", lapForm.includes('value="8"'));
ok("the entered consolation distance shows", lapForm.includes('value="15"'));
ok("the fields state that they are results-entry only", /results entry only/i.test(lapForm.replace(/<[^>]+>/g, " ")));
eq("a timed event has no preliminary distance to set", renderFields({ length_type: LENGTH_TIME }), "");
eq("nor does one run in rounds", renderFields({ length_type: LENGTH_ROUNDS }), "");
ok("an event with no length_type is a lap race, so the fields show", renderFields({}).includes('id="t_heat_laps"'));

// ── 6. The multi-class grid never auto-fills a scheduled distance ──────────
//
// The bug: every driver in every class was filled with the scheduled lap count,
// so a slower class's whole field was recorded as having run the leader's
// distance. What must hold now is that every lap derivation in the grid is
// handed `lapsBasis(row)` — the row's OWN class's typed figure on a multi-class
// grid, and the session's scheduled distance only where one class covers the
// whole field.

const grid = strip(read("components/SessionEditor.jsx"));

ok("the grid asks for THIS session's distance, not the event's headline one",
  /sessionScheduledLaps\(race,\s*sessionType\)/.test(grid));
ok("the old blanket scheduledLaps() read is gone from the grid",
  !/\bscheduledLaps\(race\)/.test(grid));

// The definition of a multi-class grid: unscoped, unpinned, more than one class.
const multiClass = grid.match(/const multiClass = ([^;]+);/)?.[1] ?? "";
ok("multiClass is defined", multiClass.trim().length > 0);
ok("a per-class session is not multi-class", multiClass.includes("!scoped"));
ok("a round pinned to one class is not multi-class", multiClass.includes("!pinnedClassId"));
ok("one class (or none) is not multi-class", /classes\.length\s*>\s*1/.test(multiClass));

// The basis itself: the scheduled distance only when the grid is single-class.
const basis = grid.match(/const lapsBasis = row => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
ok("lapsBasis has a body to inspect", basis.trim().length > 0);
ok("a single-class grid still counts off the scheduled distance", /if \(!multiClass\) return sessionLaps;/.test(basis));
ok("a multi-class grid reads the class's own typed figure", /classLaps\[/.test(basis));
ok("…and yields nothing until one is typed", /return n > 0 \? n : null;/.test(basis));
// Past the single-class early return, the scheduled distance must not appear
// again — that reappearance IS the blanket fill.
ok("lapsBasis never falls back to the scheduled distance for a multi-class grid",
  !basis.split(/if \(!multiClass\) return sessionLaps;/)[1]?.includes("sessionLaps"));

// Every derivation in the grid goes through it — none may be handed the raw
// scheduled figure, which is exactly how the blanket fill happened. Read with a
// paren scanner rather than a regex, since the arguments themselves nest.
function callsTo(src, name) {
  const out = [];
  let at = src.indexOf(`${name}(`);
  while (at >= 0) {
    let depth = 0;
    let i = at + name.length;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")" && --depth === 0) { i += 1; break; }
    }
    out.push(src.slice(at, i));
    at = src.indexOf(`${name}(`, i);
  }
  return out;
}

const derivations = callsTo(grid, "deriveLaps");
ok("the grid still derives laps somewhere", derivations.length >= 4);
for (const call of derivations) {
  // A derivation may count off exactly three things: the row's own basis; the
  // one figure a statistician just typed for a class (setClassLapsFor's
  // `total`); or assignEntry's `totalLaps` parameter, which is itself resolved
  // per row and is checked on its own below.
  ok(`${call.replace(/\s+/g, " ")} counts off a per-row basis, not the scheduled total`,
    /lapsBasis|,\s*total\)|totalLaps\(out\)/.test(call));
}
ok("no derivation is handed the session's scheduled distance directly",
  !derivations.some(c => c.includes("sessionLaps")));

// assignEntry is the one derivation a row goes through before it has a class of
// its own, so it takes the basis as a FUNCTION and resolves it against the row
// it has just classed — the class decides the distance, not the grid.
ok("assignEntry resolves its basis against the row it just built",
  /typeof totalLaps === "function" \? totalLaps\(out\)/.test(grid));
ok("assigning a driver is handed the per-row basis",
  /assignEntry\(row, entry, lapsBasis, pinnedClassId\)/.test(grid));

// The rows built on load take no blanket distance on a multi-class grid either.
ok("buildRows is handed nothing to fill from when the grid holds several classes",
  /buildRows\(entries, mains, multiClass \? null : sessionLaps/.test(grid));

// What the statistician types instead is wired to lib/sessionLaps.js, checked
// behaviourally in §7 below.
ok("the class's typed figure is what fills the column",
  /setRows\(prev => fillClassLaps\(prev, classId, value\)\)/.test(grid));
ok("the per-class boxes come from the classes actually on the grid",
  /classesOnGrid\(rows, classes\)/.test(grid));
ok("…and only on a multi-class race grid", /multiClass && !isQual \? classesOnGrid/.test(grid));
ok("rows with no laps entered are counted", /multiClass && !isQual \? rowsMissingLaps\(rows\)/.test(grid));
ok("…and named on screen", /missingLapsRows\.length > 0 &&/.test(grid));
ok("a reopened sheet shows the distances it was entered with", /setClassLaps\(seedClassLaps\(built\)\)/.test(grid));
ok("the per-class laps boxes are rendered", /Laps completed per class/.test(grid));
ok("a blank row saving as 0 is spelled out", /0 laps/.test(read("components/SessionEditor.jsx")));

// ── 7. Filling one class's laps, and only that class's ─────────────────────
//
// A two-class feature: Pro ran 50, Amateur — the slower class — took the flag
// on 47. The bug was every one of these rows being written 50.

const row = (over = {}) => ({
  entry_id: `e${over.finish_pos ?? 0}`, driver_name: "D", finish_pos: "1",
  class_id: "pro", interval: "", laps: "", status: "finished", ...over,
});
const sheet = [
  row({ finish_pos: "1", class_id: "pro" }),
  row({ finish_pos: "2", class_id: "pro", interval: "+1.204" }),
  row({ finish_pos: "3", class_id: "pro", interval: "2L" }),
  row({ finish_pos: "4", class_id: "pro", status: "dnf" }),
  row({ finish_pos: "5", class_id: "am" }),
  row({ finish_pos: "6", class_id: "am", interval: "1L" }),
  row({ finish_pos: "7", class_id: "" }),
  { ...row({ finish_pos: "8" }), entry_id: null, driver_name: "" },
];

const lapsOf = rows => rows.map(r => r.laps);
const pro = fillClassLaps(sheet, "pro", "50");
eq("Pro's winner takes the figure typed for Pro", pro[0].laps, "50");
eq("a lead-lap Pro finisher takes it too", pro[1].laps, "50");
eq("two laps down subtracts from it", pro[2].laps, "48");
eq("a Pro retirement is left for the admin", pro[3].laps, "");
eq("Amateur is untouched by Pro's figure", lapsOf(pro.slice(4)), ["", "", "", ""]);

const both = fillClassLaps(pro, "am", 47);
eq("Amateur's own figure fills Amateur", both[4].laps, "47");
eq("…and its laps-down car subtracts from Amateur's, not Pro's", both[5].laps, "46");
eq("Pro keeps what Pro was given", lapsOf(both.slice(0, 4)), ["50", "50", "48", ""]);
eq("the unclassified row still waits for its own figure", both[6].laps, "");
eq("an empty slot is never filled", both[7].laps, "");

const unclassed = fillClassLaps(both, "", "44");
eq("the unclassified bucket fills from its own box", unclassed[6].laps, "44");

// Clearing the box must not be able to wipe a filled column.
eq("a blank figure changes nothing", fillClassLaps(both, "pro", ""), both);
eq("a zero changes nothing", fillClassLaps(both, "pro", "0"), both);
eq("a negative changes nothing", fillClassLaps(both, "pro", "-5"), both);
eq("nonsense changes nothing", fillClassLaps(both, "pro", "fifty"), both);
eq("re-typing the same figure is the same array", fillClassLaps(both, "am", "47"), both);
eq("a class with nobody in it changes nothing", fillClassLaps(both, "trucks", "40"), both);
eq("laps down can't drive a row below zero", fillClassLaps(sheet, "pro", "1")[2].laps, "0");

// ── 8. Which classes get a box, and what it opens showing ──────────────────

eq("a box per class on the grid, best finisher first",
  classesOnGrid(sheet, [{ id: "am", name: "Amateur" }, { id: "pro", name: "Pro" }]),
  [{ id: "pro", name: "Pro" }, { id: "am", name: "Amateur" }, { id: "", name: "Unclassified" }]);
eq("an empty grid asks for nothing", classesOnGrid([], [{ id: "pro", name: "Pro" }]), []);
eq("a class the season no longer lists still needs its laps entered",
  classesOnGrid([row({ class_id: "gone" })], []), [{ id: "gone", name: "Unclassified" }]);

eq("reopening reads each class's distance back off the sheet",
  seedClassLaps(both), { pro: "50", am: "47" });
eq("a laps-down car can't speak for its class",
  seedClassLaps([row({ class_id: "pro", interval: "3L", laps: "47" })]), {});
eq("nor can a retirement",
  seedClassLaps([row({ class_id: "pro", status: "dnf", laps: "31" })]), {});
eq("a sheet with no laps entered seeds nothing", seedClassLaps(sheet), {});

eq("every driver on a fresh sheet is waiting on laps", rowsMissingLaps(sheet).length, 7);
eq("filling both classes leaves only the unclassified row and the retirement",
  rowsMissingLaps(both).map(r => r.finish_pos), ["4", "7"]);
eq("empty slots are never counted as missing", rowsMissingLaps([{ entry_id: null, laps: "" }]).length, 0);

console.log(`sessionLaps: ${n} checks passed — heats count off their own distance, and no class is filled with another's`);
