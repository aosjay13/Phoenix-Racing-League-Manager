// Guard: the screens that can create a driver must MOUNT, and the warning they
// now carry must say something an admin can act on.
//
// The duplicate rules themselves are unit-tested in driverMatch.test.mjs. What
// that can't catch is a screen that imports one of them wrongly — a component
// with a missing binding dies on mount behind the error boundary, and the
// screens involved here are the results grid mid-race-entry and the Driver
// Roster, i.e. the two an admin is most likely to be standing in front of on a
// race night. So every one of them is rendered with react-dom/server (see
// register-jsx.mjs), which resolves imports exactly as the browser does.
//
// The second half asserts on the words. A prompt that says "possible duplicate"
// and nothing else is one you learn to click past; the whole point of this work
// is that it names the driver it found and the name it recognised them by.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AddDriverToRace } from "@/components/AddDriverToRace";
import { DriverCreateModal } from "@/components/DriverCreateModal";
import { DriverMatchNote, DuplicateDriverPrompt } from "@/components/DuplicateDriverPrompt";
import { RosterImportModal } from "@/components/RosterImportModal";
import { duplicateReport } from "@/lib/driverMatch";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };

function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

// Ryan is in the app once, under three names.
const pool = [
  {
    id: "d-ryan",
    name: "Ryan Maynard",
    game_names: [{ game_id: "beamng", name: "Ryanbirdman" }],
    aliases: [{ label: "PSN Username", value: "Ryan_Bird_77" }],
  },
  { id: "d-ana", name: "Ana Ruiz" },
];
const games = { beamng: "BeamNG" };

// ── Everything that can create a driver mounts ─────────────────────────────
render("AddDriverToRace", (
  <AddDriverToRace
    seasonId="s1" seriesName="Formula Phoenix" existingNames={new Set()}
    onCreated={() => {}} onError={() => {}}
  />
));
render("DriverCreateModal", (
  <DriverCreateModal seasonId="s1" seriesName="Formula Phoenix" initialName="Ryanbirdman"
    onClose={() => {}} onCreated={() => {}} />
));
render("RosterImportModal", (
  <RosterImportModal seasonId="s2" seriesId="fp" seasonName="Season 2" seriesName="Formula Phoenix"
    onClose={() => {}} onImported={() => {}} />
));
render("DuplicateDriverPrompt", (
  <DuplicateDriverPrompt
    typedName="Ryanbirdman"
    status="linked"
    matches={duplicateReport(pool, { name: "Ryanbirdman" }, { games }).matches}
    onUse={() => {}} onCreateAnyway={() => {}} onCancel={() => {}}
  />
));

// ── The live note under a driver-name field ────────────────────────────────
// A name the app already knows, typed into "Add Driver": it has to say WHO,
// before the button is pressed. This is the notice that didn't exist.
const linked = render("DriverMatchNote · linked", (
  <DriverMatchNote pool={pool} games={games} name="Ryanbirdman" />
));
ok("names the driver it recognised", linked.includes("Ryan Maynard"));
ok("…and which of his names gave him away", linked.includes("BeamNG name"));
ok("…and says their history stays in one place", /history stays in one place/.test(linked));

const viaPsn = render("DriverMatchNote · alias", (
  <DriverMatchNote pool={pool} games={games} name="ryan_bird_77" />
));
ok("a PSN username is recognised too", viaPsn.includes("Ryan Maynard"));
ok("…and named as a PSN username", viaPsn.includes("PSN Username"));

const near = render("DriverMatchNote · near miss", (
  <DriverMatchNote pool={pool} games={games} name="Ryan Maynrad" />
));
ok("a near miss warns rather than claims", near.includes("Ryan Maynard") && /you.{0,10}ll be asked/.test(near));

// An ordinary new driver must stay completely silent — a warning on every add
// is a warning nobody reads.
const quiet = render("DriverMatchNote · new driver", (
  <DriverMatchNote pool={pool} games={games} name="Cyd Okafor" />
));
ok("a genuinely new name says nothing at all", quiet === "");
ok("and neither does an empty box", render("DriverMatchNote · blank", <DriverMatchNote pool={pool} name="" />) === "");

console.log(`driverDedupeFlow: ${n} assertions passed`);
