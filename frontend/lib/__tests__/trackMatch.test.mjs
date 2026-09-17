// Checking an imported venue against the tracks a league already has.
//
// The schedule importer creates rows in the Tracks library, and a track is the
// one thing in this app that accumulates: lap records, a history, every race
// ever run there. Get it wrong and a season's rounds hang off a venue nobody
// races at, next to the real one. So this file pins the four things the check
// has to be right about:
//
//   1. every name a track answers to counts — the one it's called, the venues a
//      merge folded into it, and the names other sites use for it, which is how
//      a league keeps its OWN naming instead of SimRacerHub's;
//   2. an automatic match needs an exact name, once case and punctuation are
//      set aside. Nothing else matches by itself;
//   3. the near miss that matters is a different LAYOUT of the same venue —
//      "Charlotte Motor Speedway Oval" and "…Roval" are one letter apart and
//      two different tracks — so it is offered, labelled as what it is, and
//      never taken;
//   4. and an unanswered question creates the venue rather than quietly
//      pointing a season at a layout nobody confirmed.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTrackDecisions, matchTrack, planTrackImport, splitTrackName,
  trackNames, trackTypeFromName, MATCH_REASONS,
} from "../trackMatch.js";
import { TRACK_TYPES } from "../trackTypes.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// A league that has raced Charlotte both ways and calls the road course by a
// short name of its own — which an earlier import has already taught it the
// SimRacerHub name for.
const roval = { id: "t-roval", name: "Charlotte Roval", merged_names: ["Charlotte Motor Speedway Roval 2019"] };
const oval = { id: "t-oval", name: "Charlotte Motor Speedway Oval" };
const glen = { id: "t-glen", name: "The Glen" };
const limerock = { id: "t-limerock", name: "Lime Rock" };
const tracks = [roval, oval, glen, limerock];

// The venue list layouts are split against: iRacing's own, read off
// SimRacerHub's track directory (see parseSrhTrackDirectory).
const baseNames = [
  "Charlotte Motor Speedway", "Daytona International Speedway", "Lime Rock Park",
  "Indianapolis Motor Speedway", "Indianapolis Raceway Park", "Watkins Glen International",
];
const opts = { baseNames };

// ── 1. Every name a track answers to ───────────────────────────────────────

check("a track answers to its name and to the names it has been raced under",
  trackNames(roval), ["Charlotte Roval", "Charlotte Motor Speedway Roval 2019"]);
check("a track with no history answers to one name", trackNames(oval), ["Charlotte Motor Speedway Oval"]);
check("blanks and padding don't become names",
  trackNames({ name: "  Bristol  ", merged_names: ["", "   ", "Bristol Dirt"] }), ["Bristol", "Bristol Dirt"]);
check("a merged_names that isn't a list is ignored rather than crashing",
  trackNames({ name: "Bristol", merged_names: "Bristol Dirt" }), ["Bristol"]);
check("nothing at all is no names", trackNames(null), []);

// ── 2. An automatic match needs an exact name ─────────────────────────────

const recorded = matchTrack("Charlotte Motor Speedway Roval 2019", tracks, opts);
check("the name a previous import recorded is an outright match", recorded.status, "matched");
check("…and it resolves to the track the league named itself", [recorded.track_id, recorded.matched_name],
  ["t-roval", "Charlotte Roval"]);
// That is the whole payoff: an admin who renames a venue answers the question
// once, and every later import of that series has nothing to review.
check("a venue called exactly what the league calls it is a match too",
  matchTrack("Charlotte Motor Speedway Oval", tracks, opts).track_id, "t-oval");
check("case and punctuation are not a different venue",
  matchTrack("charlotte  MOTOR-speedway, oval", tracks, opts).track_id, "t-oval");

check("a venue the league has never raced is new", matchTrack("Autodromo Nazionale Monza", tracks, opts).status, "new");
check("…and nothing is pretended about which track it is",
  matchTrack("Autodromo Nazionale Monza", tracks, opts).track_id, null);
check("an empty cell is not a venue", matchTrack("   ", tracks, opts),
  { raw: "", status: "new", track_id: null, matched_name: "", candidates: [] });
check("a track with no id can't be matched to", matchTrack("Sonoma", [{ name: "Sonoma" }], opts).status, "new");

// ── 3. The same venue, a different layout ─────────────────────────────────
//
// The case this module exists for. "Charlotte Motor Speedway Roval" against a
// league that has the Oval: one character in thirty, which any string
// similarity calls a match.

const trap = matchTrack("Charlotte Motor Speedway Roval", tracks, opts);
check("a layout the league doesn't have is never matched outright", trap.status, "suggested");
check("…the Oval it resembles is offered first", trap.candidates[0].id, "t-oval");
check("…as the same venue, a different layout", trap.candidates[0].reason, "layout");
check("…naming the layout the league does have, so an admin can tell them apart",
  trap.candidates[0].layout, "Oval");
// And their own Roval is still on the list, because a close name is worth
// offering even when it isn't the reason the row is here.
check("…with everything else close behind it", trap.candidates.map(c => c.reason), ["layout", "close"]);
check("…including the venue they'd actually pick", trap.candidates[1].id, "t-roval");

check("a base venue with no layout named says so rather than inventing one",
  matchTrack("Charlotte Motor Speedway", [{ id: "t-cms", name: "Charlotte Motor Speedway" }, oval], opts)
    .candidates.map(c => [c.reason, c.layout ?? null]),
  [["exact", null], ["layout", "Oval"]]);

check("a layout is split off the venue behind it",
  splitTrackName("Indianapolis Motor Speedway Road Course", baseNames),
  { full: "Indianapolis Motor Speedway Road Course", base: "Indianapolis Motor Speedway", config: "Road Course" });
check("…by the longest venue name that fits, not the first",
  splitTrackName("Indianapolis Raceway Park Oval", baseNames).base, "Indianapolis Raceway Park");
check("…keeping the layout's own capitals",
  splitTrackName("Lime Rock Park Grand Prix", baseNames).config, "Grand Prix");
check("a venue that names no layout is all venue",
  splitTrackName("Lime Rock Park", baseNames), { full: "Lime Rock Park", base: "Lime Rock Park", config: "" });
// With no list to split against — a track an admin typed in themselves — the
// honest answer is the whole name, not a guess at where the venue's name stops.
check("and with no venue list, a name is not taken apart on a hunch",
  splitTrackName("Some Backyard Oval"), { full: "Some Backyard Oval", base: "Some Backyard Oval", config: "" });
check("nothing splits into nothing", splitTrackName("  ", baseNames), { full: "", base: "", config: "" });

// ── 4. Close is only ever close ───────────────────────────────────────────

const near = matchTrack("The Glenn", tracks, opts);
check("a name a letter out is offered, never applied", near.status, "suggested");
check("…with the reason it's being offered", near.candidates[0].reason, "close");
check("…and the track it resembles", near.candidates[0].id, "t-glen");
check("a name nothing like theirs is offered to nobody",
  matchTrack("Phillip Island", tracks, opts).candidates, []);
// A league's own short name for a venue is NOT guessed at: "Lime Rock" and
// "Lime Rock Park Grand Prix" are a venue and a layout of it, and the app has
// no field that says so. The review table's full track list is how an admin
// says they're the same, and recording the name is what makes it stick.
check("a league's short name for a venue isn't assumed to be the layout that raced",
  matchTrack("Lime Rock Park Grand Prix", tracks, opts).status, "new");
check("…and once an import has recorded it, it matches outright",
  matchTrack("Lime Rock Park Grand Prix", [{ ...limerock, merged_names: ["Lime Rock Park Grand Prix"] }], opts).status,
  "matched");

check("the reasons run worst to best", MATCH_REASONS, ["close", "layout", "exact"]);
const crowd = Array.from({ length: 9 }, (_, i) => ({ id: `t-${i}`, name: `Bristol Motor Speedway ${i}` }));
ok("a long list of near-misses is cut to what a dropdown can show",
  matchTrack("Bristol Motor Speedway", crowd, { baseNames: ["Bristol Motor Speedway"] }).candidates.length === 5);

// ── 5. What a name says about the surface ─────────────────────────────────
//
// Filled in for a venue this import creates, so a new track arrives typed. A
// wrong surface is worse than a blank one, so the order these are read in
// matters more than the count of them.

check("the layout a league names beats the venue's own word for itself",
  ["Daytona International Speedway Oval", "Charlotte Motor Speedway Roval"].map(trackTypeFromName),
  ["Oval", "Road Course"]);
check("dirt is dirt whatever shape it is",
  ["Eldora Speedway Dirt", "Bristol Motor Speedway Dirt", "Knoxville Raceway Dirt"].map(trackTypeFromName),
  ["Dirt Oval", "Dirt Oval", "Dirt Oval"]);
check("…and a dirt road course is not an oval", trackTypeFromName("Bathurst Dirt Road Course"), "Dirt Road Course");
check("the specific surfaces are read before the general ones",
  ["Talladega Superspeedway", "Long Beach Street Circuit", "New Smyrna Speedway Short Track",
    "Thompson Speedway Dragstrip", "Figure 8 Speedway", "Rallycross Hell"].map(trackTypeFromName),
  ["Superspeedway", "Street Circuit", "Short Track", "Drag Strip", "Figure 8", "Rallycross"]);
check("a kart track is a kart track", trackTypeFromName("Kevin Harvick's Kernersville Kart Racing"), "Kart");
check("a road course reads as one",
  ["Lime Rock Park Grand Prix", "Tsukuba Circuit", "Mount Panorama Sports Car"].map(trackTypeFromName),
  ["Road Course", "Road Course", "Road Course"]);
check("a speedway with no layout named is an oval",
  ["Atlanta Motor Speedway", "Lucas Oil Raceway"].map(trackTypeFromName), ["Oval", "Oval"]);
check("a name that says nothing gets nothing, for an admin to fill in",
  ["Autobahn Country Club Full Course", "Nowhere", ""].map(trackTypeFromName), ["", "", ""]);
ok("…and whatever it does say is a type this app actually offers",
  ["Daytona International Speedway Oval", "Eldora Speedway Dirt", "Long Beach Street Circuit",
    "Talladega Superspeedway", "Tsukuba Circuit", "Bathurst Dirt Road Course"]
    .every(name => TRACK_TYPES.includes(trackTypeFromName(name))));

// ── 6. The plan a review table is built from ─────────────────────────────

const schedule = [
  "Charlotte Motor Speedway Roval 2019",  // what an earlier import recorded
  "Charlotte Motor Speedway Oval",        // their own name for it
  "Charlotte Motor Speedway Roval",       // the trap
  "Lime Rock Park Grand Prix",            // a venue they don't have
  "lime rock park grand prix",            // …and the same one written twice
  "  ",
];
const info = {
  "Lime Rock Park Grand Prix": { base: "Lime Rock Park", logo_url: "https://cdn.example/limerock.png" },
};
const plan = planTrackImport(schedule, tracks, { info, baseNames });

check("one row per venue, however many rounds race it", plan.rows.map(r => r.raw),
  ["Charlotte Motor Speedway Roval 2019", "Charlotte Motor Speedway Oval",
    "Charlotte Motor Speedway Roval", "Lime Rock Park Grand Prix"]);
check("each with what it is", plan.rows.map(r => r.status), ["matched", "matched", "suggested", "new"]);
check("and the count an admin reads before pressing anything", plan.summary,
  { total: 4, matched: 2, suggested: 1, new: 1 });

const lime = plan.rows[3];
check("a new venue is named as the source calls it, for the admin to type over",
  lime.suggested_name, "Lime Rock Park Grand Prix");
check("…with the surface its name implies", lime.suggested_type, "Road Course");
check("…the venue behind the layout, as the source knows it", [lime.base, lime.config],
  ["Lime Rock Park", "Grand Prix"]);
check("…and iRacing's own logo for it where there was one", lime.logo_url, "https://cdn.example/limerock.png");
check("a venue the source knows nothing about still gets a row",
  planTrackImport(["Phillip Island"], tracks, opts).rows.map(r => [r.status, r.logo_url]), [["new", ""]]);
check("a schedule with no tracks on it plans nothing",
  planTrackImport([], tracks, opts), { rows: [], summary: { total: 0, matched: 0, suggested: 0, new: 0 } });
check("and so does no schedule at all", planTrackImport(null).summary.total, 0);

// ── 7. The admin's answers, applied ──────────────────────────────────────

const answered = applyTrackDecisions(plan.rows, {
  // The trap, settled: it IS their Roval, and saying so records the name.
  "Charlotte Motor Speedway Roval": { action: "use", track_id: "t-roval" },
  // And the new one, under the league's own name.
  "Lime Rock Park Grand Prix": { action: "create", name: "Lime Rock GP", track_type: "Road Course" },
});
check("what matched is used, with nothing asked", answered.use.map(u => [u.raw, u.track_id]),
  [["Charlotte Motor Speedway Roval 2019", "t-roval"],
    ["Charlotte Motor Speedway Oval", "t-oval"],
    ["Charlotte Motor Speedway Roval", "t-roval"]]);
check("what the admin named is created as they named it",
  answered.create, [{
    raw: "Lime Rock Park Grand Prix", name: "Lime Rock GP",
    track_type: "Road Course", logo_url: "https://cdn.example/limerock.png",
  }]);
check("and none of it is in question", answered.errors, []);

// The rule that matters most here: a suggestion is a question, and an
// unanswered question is not a yes. A season pointed at a layout nobody
// confirmed is the mistake this whole module exists to stop.
const unanswered = applyTrackDecisions(plan.rows, {});
check("a suggestion left alone creates the venue rather than accepting itself",
  unanswered.create.map(c => c.name), ["Charlotte Motor Speedway Roval", "Lime Rock Park Grand Prix"]);
check("…and only what matched exactly is used", unanswered.use.map(u => u.track_id), ["t-roval", "t-oval"]);
check("…with no complaint, because nothing is wrong with it", unanswered.errors, []);

check("a type the admin cleared stays cleared",
  applyTrackDecisions([plan.rows[3]], { "Lime Rock Park Grand Prix": { action: "create", track_type: "" } })
    .create[0].track_type, "");
check("…and one they never touched keeps what the name implied",
  applyTrackDecisions([plan.rows[3]], { "Lime Rock Park Grand Prix": { action: "create" } })
    .create[0].track_type, "Road Course");

check("“use this one” with no track chosen is an error, not a silent skip",
  applyTrackDecisions(plan.rows, { "Lime Rock Park Grand Prix": { action: "use" } }).errors,
  ["Lime Rock Park Grand Prix: no track chosen"]);
check("a new venue with its name emptied is an error too",
  applyTrackDecisions(plan.rows, { "Lime Rock Park Grand Prix": { action: "create", name: "   " } }).errors,
  ["Lime Rock Park Grand Prix: a new track needs a name"]);
// The duplicate this module exists to prevent, arriving from the review table.
const clash = applyTrackDecisions(plan.rows, {
  "Charlotte Motor Speedway Roval": { action: "create", name: "Charlotte Roval Course" },
  "Lime Rock Park Grand Prix": { action: "create", name: "charlotte  roval course" },
});
check("two venues can't be created under one name", clash.errors.length, 1);
ok("…and the message says which name and what to do", /both be created as/.test(clash.errors[0]));
check("nothing to decide decides nothing", applyTrackDecisions([]), { use: [], create: [], errors: [] });
check("and neither does nothing at all", applyTrackDecisions(null).errors, []);

// ── 8. Wired into the import ─────────────────────────────────────────────
//
// The check is only worth having if the importer actually runs it, writes what
// the admin answered, and records the source's name on the venue they pointed
// at — which is the part that makes the SECOND import of a series need no
// review, and the part that lets a league keep its own naming.
const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
const route = read("app/api/import-srh-season/route.js");
// The venue answers are applied, and the tracks written, by ONE module now —
// shared by this importer and the pasted-schedule one, so these rules cover
// both rather than only the route they started in. See lib/scheduleWrite.js.
const writer = read("lib/scheduleWrite.js");
const pasteRoute = read("app/api/import-schedule-paste/route.js");
// The review table is shared too, and so is the rule for when its answers are
// complete — the two importers render the one table and gate their Create
// buttons on the one rule.
const modal = read("components/ScheduleImportReview.jsx");
const rules = read("lib/scheduleReview.js");
const srhModal = read("components/SrhSeasonImportModal.jsx");
const pasteModal = read("components/PastedScheduleImportModal.jsx");

ok("the preview checks every venue against the league's own tracks",
  /planTrackImport\(plan\.tracks, leagueTracks/.test(route));
ok("…and answers with them, the reasons included", /tracks: trackPlan\.rows/.test(writer));
ok("…and with every track in the league, for a venue the matcher never offered",
  /league_tracks: leagueTracks/.test(writer));
ok("the write applies the admin's answers", /applyTrackDecisions\(trackPlan\.rows, trackDecisions/.test(writer));
ok("…and refuses the lot if any of them can't be", /track_errors: decided\.errors/.test(writer));
ok("…recording the source's name on a track it was pointed at",
  /merged_names: merged/.test(writer) && /aliased\.push/.test(writer));
ok("…but not twice", /if \(!known\.has\(normalizeName\(raw\)\)\)/.test(writer));
ok("a venue it creates is validated like any other new track",
  /spec: SPECS\.tracks/.test(writer));
ok("…and carries the source's name when the admin called it something else",
  /merged_names: \[raw\]/.test(writer));
// Tracks are settled first so each race is LINKED to a real venue rather than
// carrying its name as loose text, which is what gives a new season's rounds a
// track page and lap records from the day they're created.
ok("the venues are settled before the races that race at them",
  writer.indexOf("applyTrackDecisions(") < writer.indexOf("spec: SPECS.races"));
ok("…and every race points at the track the admin settled on",
  /trackIdByName\.get\(race\.track\)/.test(writer) && /track_id: track\.id/.test(writer));
// The pasted-schedule importer runs the same check and the same write, which is
// the whole reason this is one module: a second copy would drift, and the drift
// would fill the Tracks library with near-duplicates.
ok("the pasted-schedule importer checks its venues the same way",
  /planTrackImport\(plan\.tracks, leagueTracks/.test(pasteRoute));
ok("…and writes them through the same writer", /writeScheduleImport\(/.test(pasteRoute));

ok("the review table starts each venue on what the matcher proposed",
  /t\.status === "matched"\s*\?\s*\{ action: "use", track_id: t\.track_id \}/.test(rules));
ok("…which for anything else is a new track under the source's name",
  /\{ action: "create", name: t\.suggested_name, track_type: t\.suggested_type \}/.test(rules));
ok("…and both importers start from that same proposal",
  /initialTrackChoices\(/.test(srhModal) && /initialTrackChoices\(/.test(pasteModal));
ok("…and it says why each candidate is being offered", /CANDIDATE_WHY\[c\.reason\]/.test(modal));
ok("…in words that call a layout a layout", /same venue, different layout/.test(modal));
ok("a new venue is named whatever the league likes", /aria-label=\{`Name for \$\{t\.raw\}`\}/.test(modal));
ok("…and typed, with the surface its name implied offered first", /TRACK_TYPES\.map\(type =>/.test(modal));
ok("every track in the league is reachable, not just the matcher's offers",
  /optgroup label="Every track"/.test(modal));
ok("the answers go with the create",
  /track_decisions: trackChoices/.test(srhModal) && /track_decisions: trackChoices/.test(pasteModal));
ok("…and neither button presses while a venue is unsettled",
  [srhModal, pasteModal].every(m => /&& tracksReady/.test(m.replace(/\n\s*/g, " "))));
ok("…judged by the one shared rule", /trackChoiceProblems\(/.test(rules.length ? srhModal : "")
  && /trackChoiceProblems\(/.test(pasteModal));
ok("…with a duplicate name called out before it's sent", /Two venues would be created under the same name/.test(modal));
ok("each round shows the venue as it will be HERE, not as the source writes it",
  /\$\{sourceLabel\} calls it/.test(modal));

console.log(`trackMatch: ${n} assertions passed`);
