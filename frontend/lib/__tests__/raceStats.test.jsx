// Caution flags and lead changes: a RACE statistic, not a driver one, and one
// that most events simply don't have.
//
// The whole rule is the hiding. Not every league counts these, and not every
// game reports them, so a blank box has to read as "this event doesn't have
// one" everywhere — never as a zero printed beside a real figure. A 0 counts as
// blank for the same reason: once the box is empty, "nobody counted the
// cautions" and "there were no cautions" are the same event, and printing
// "Caution Flags 0" would claim the second.
//
// The lib rules are checked behaviourally; the results page's wiring is checked
// at source level, the way sessionLaps.test.jsx checks the grid's — the screen
// needs a live bundle and a router to drive, and what has to hold is that the
// strip is rendered off the filtered list rather than off the raw race doc.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RACE_STAT_FIELDS, cautionFlags, hasRaceStats, leadChanges,
  raceStats, raceStatValue, raceStatsBody, raceStatsForm,
} from "@/lib/raceStats";
import { COPIED_RACE_FIELDS, copyRaceDoc } from "@/lib/raceCopy";
import { RaceStatsFields } from "@/components/RaceStatsFields";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// ── 1. One figure off a race doc ──────────────────────────────────────────

const run = { name: "Round 4", track: "Bristol", caution_flags: 6, lead_changes: 14 };

eq("a recorded caution count reads back", cautionFlags(run), 6);
eq("so does a lead change count", leadChanges(run), 14);
eq("one of each is enough", cautionFlags({ caution_flags: 1 }), 1);

// Every way "no figure" arrives has to land on null — that is what keeps the
// stat off the page.
eq("an event that never recorded one has none", cautionFlags({ name: "Round 5" }), null);
eq("a blank box is not a figure", cautionFlags({ caution_flags: "" }), null);
eq("a stored 0 reads as unset, not as zero cautions", cautionFlags({ caution_flags: 0 }), null);
eq("…and the same for lead changes", leadChanges({ lead_changes: 0 }), null);
eq("a negative is not a count", cautionFlags({ caution_flags: -3 }), null);
eq("nor is nonsense", cautionFlags({ caution_flags: "six" }), null);
eq("nor is null", cautionFlags({ caution_flags: null }), null);
eq("no race at all has nothing", cautionFlags(undefined), null);
eq("a stored string number still counts", cautionFlags({ caution_flags: "6" }), 6);
eq("a fraction of a caution is rounded to one", raceStatValue({ caution_flags: 6.4 }, "caution_flags"), 6);
eq("an unknown field is never a stat", raceStatValue(run, "total_laps"), null);

// ── 2. What the page is handed ────────────────────────────────────────────

eq("both stats print, cautions first",
  raceStats(run).map(s => [s.label, s.value]),
  [["Caution Flags", 6], ["Lead Changes", 14]]);
eq("an event with only cautions prints only cautions",
  raceStats({ caution_flags: 6 }).map(s => s.label), ["Caution Flags"]);
eq("an event with only lead changes prints only those",
  raceStats({ lead_changes: 14 }).map(s => s.label), ["Lead Changes"]);
eq("an event with neither prints nothing at all", raceStats({ name: "Round 5" }), []);
eq("a 0 in one and a figure in the other prints one chip",
  raceStats({ caution_flags: 0, lead_changes: 3 }).map(s => [s.label, s.value]), [["Lead Changes", 3]]);
eq("zeros in both print nothing", raceStats({ caution_flags: 0, lead_changes: 0 }), []);
ok("every printed stat carries its field key, an icon and a tooltip",
  raceStats(run).every(s => RACE_STAT_FIELDS.includes(s.key) && s.icon && s.title));

ok("an event with a figure has stats", hasRaceStats(run));
ok("an event with one figure has stats", hasRaceStats({ lead_changes: 2 }));
ok("an event with none does not", !hasRaceStats({ caution_flags: 0, name: "Round 5" }));
ok("nor does no event at all", !hasRaceStats());

// ── 3. Form ↔ doc ─────────────────────────────────────────────────────────

eq("a saved event fills both boxes", raceStatsForm(run), { caution_flags: "6", lead_changes: "14" });
eq("an event that recorded neither opens blank, not on 0",
  raceStatsForm({ name: "Round 5" }), { caution_flags: "", lead_changes: "" });
eq("a stored 0 opens blank", raceStatsForm({ caution_flags: 0, lead_changes: 0 }), { caution_flags: "", lead_changes: "" });
eq("no race at all is blank", raceStatsForm(), { caution_flags: "", lead_changes: "" });

eq("typed figures are written as numbers",
  raceStatsBody({ caution_flags: "6", lead_changes: "14" }), { caution_flags: 6, lead_changes: 14 });
eq("blanks are written back as unset",
  raceStatsBody({ caution_flags: "", lead_changes: "" }), { caution_flags: 0, lead_changes: 0 });
eq("clearing a figure really clears it", raceStatsBody({ caution_flags: "0" }), { caution_flags: 0, lead_changes: 0 });
eq("a negative is not a count", raceStatsBody({ caution_flags: "-3" }), { caution_flags: 0, lead_changes: 0 });
eq("nonsense is unset", raceStatsBody({ caution_flags: "six" }), { caution_flags: 0, lead_changes: 0 });
eq("nothing typed at all is unset", raceStatsBody(), { caution_flags: 0, lead_changes: 0 });
eq("the body carries these two fields and nothing else",
  Object.keys(raceStatsBody({ caution_flags: "6", name: "Round 4" })), RACE_STAT_FIELDS);

// The round trip an admin actually performs: open the event, change nothing,
// save. Both figures must come back exactly as they went in.
eq("open → save with no edit leaves the event untouched",
  raceStatsBody(raceStatsForm(run)), { caution_flags: 6, lead_changes: 14 });

// ── 4. The form fields ────────────────────────────────────────────────────

const form = renderToStaticMarkup(
  <RaceStatsFields value={raceStatsForm(run)} onPatch={() => {}} idPrefix="t" />
);
ok("a caution flags box is rendered", form.includes('id="t_caution_flags"'));
ok("a lead changes box is rendered", form.includes('id="t_lead_changes"'));
ok("both are numeric", (form.match(/type="number"/g) || []).length === 2);
ok("both are optional, and say so", (form.match(/\(optional\)/g) || []).length === 2);
ok("the saved caution count shows", form.includes('value="6"'));
ok("the saved lead change count shows", form.includes('value="14"'));
ok("the fields say a blank is left off the page", /left off the page/i.test(form.replace(/<[^>]+>/g, " ")));
const blank = renderToStaticMarkup(<RaceStatsFields value={{}} onPatch={() => {}} idPrefix="t" />);
ok("an event with nothing recorded still offers both boxes, empty",
  blank.includes('id="t_caution_flags"') && blank.includes('id="t_lead_changes"') && !blank.includes('value="0"'));

// ── 5. Where they are, and are not, read ──────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
// Strip comments before searching source, so the prose explaining a rule can
// never be what satisfies the check for it.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

// The public results page: the strip is rendered off the FILTERED list, so an
// event with no figures (or a 0) renders no strip at all.
const viewer = strip(read("app/races/[id]/RaceResultsScreen.jsx"));
ok("the results header builds its stats through raceStats()", /const eventStats = raceStats\(event\)/.test(viewer));
ok("the strip is rendered only when there is something in it", /eventStats\.length > 0 &&/.test(viewer));
ok("the header never reads a raw caution count off the race doc", !/event\.caution_flags/.test(viewer));
ok("nor a raw lead change count", !/event\.lead_changes/.test(viewer));

// They're admin-entered on the event's own Race Info tab, and saved with it.
const editor = strip(read("app/races/[id]/edit/RaceEditScreen.jsx"));
ok("Race Info offers the two boxes", /<RaceStatsFields/.test(editor));
ok("…hydrated from the saved event", /\.\.\.raceStatsForm\(race\)/.test(editor));
ok("…and written back on save", /\.\.\.raceStatsBody\(form\)/.test(editor));

// A field the API doesn't know is a field that silently fails to save.
const api = strip(read("lib/entityApi.js"));
for (const field of RACE_STAT_FIELDS) {
  ok(`${field} is a writable race field`, new RegExp(`${field}: \\{ number: true \\}`).test(api));
}

// Nothing that scores, ranks or rolls up an event may read them: they are a
// record of the race, not an input to the championship.
for (const [file, what] of [
  ["lib/standings.js", "the standings"],
  ["lib/eventCompute.js", "the event's own scorer"],
  ["lib/raceSummaryServer.js", "the event roll-up"],
  ["lib/careerCompute.js", "a driver's career record"],
  ["lib/trackCompute.js", "the track records"],
  ["lib/skillRatingServer.js", "the skill ratings"],
]) {
  const src = strip(read(file));
  for (const field of RACE_STAT_FIELDS) {
    ok(`${what} never reads ${field}`, !src.includes(field));
  }
}

// ── 6. Copying an event ───────────────────────────────────────────────────
//
// The stats describe the race that was RUN, so they travel with its results and
// only with them. A copy taken as a fresh round to enter results into must not
// open already claiming six cautions it never ran.

for (const field of RACE_STAT_FIELDS) {
  ok(`${field} is not an unconditionally copied field`, !COPIED_RACE_FIELDS.includes(field));
}

const copyArgs = { season_id: "s2", round_number: 3 };
const withResults = copyRaceDoc(run, { ...copyArgs, include_results: true });
eq("a copy that brings the results brings the cautions", withResults.caution_flags, 6);
eq("…and the lead changes", withResults.lead_changes, 14);

const empty = copyRaceDoc(run, { ...copyArgs, include_results: false });
eq("a copy taken as an empty round carries no caution count", empty.caution_flags, undefined);
eq("…and no lead change count", empty.lead_changes, undefined);
eq("a caller that doesn't say defaults to not carrying them",
  copyRaceDoc(run, copyArgs).caution_flags, undefined);
eq("the event itself still copies", empty.name, "Round 4");
eq("an event with no stats copies none even with its results",
  copyRaceDoc({ name: "Round 5" }, { ...copyArgs, include_results: true }).caution_flags, undefined);

// The route has to pass the admin's choice through, or the rule above is dead
// code.
const route = strip(read("app/api/races/copy/route.js"));
ok("the copy route hands copyRaceDoc the include_results choice",
  /copyRaceDoc\(race, \{[\s\S]*?include_results,[\s\S]*?\}\)/.test(route));

console.log(`raceStats: ${n} assertions passed`);
