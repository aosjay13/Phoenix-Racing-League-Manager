// Guard: the placement screens must MOUNT, and the board must say what it is
// for without anybody having to be told.
//
// The rules behind the board are unit-tested in placements.test.mjs. What that
// can't catch is a component that imports one of them wrongly — a missing
// binding kills the whole screen behind the error boundary, and this is the
// screen an admin runs a placement night on with forty drivers waiting. So
// each one is rendered with react-dom/server (see register-jsx.mjs), which
// resolves imports exactly as the browser does.
//
// The rest asserts on the words and the affordances, because "highly visual so
// non-tech-savvy admins can easily assign drivers" is the requirement, and a
// board that renders but offers no way to move anybody meets none of it.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacementBoard } from "@/components/PlacementBoard";
import { AutoPlaceModal } from "@/components/AutoPlaceModal";
import { PlacementDestinationsModal } from "@/components/PlacementDestinationsModal";
import { PlacementTargetFields } from "@/components/PlacementTargetFields";
import { AddDriverToTrial } from "@/components/AddDriverToTrial";
import { DriverMergeTool } from "@/components/DriverMergeTool";
import { PLACEMENT_METRICS, buildBuckets, previewAutoPlace } from "@/lib/placements";

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

const buckets = buildBuckets({
  placementClasses: [{ id: "c-pro", name: "Pro Class" }, { id: "c-am", name: "Amateur Class" }],
  trialSeasonId: "sea-1", seasonName: "Season 4",
});
const rows = [
  { id: "r1", name: "Ana Ruiz", number: "7", best_time: "1:20.100", avg_time: "1:21.900", best_seconds: 80.1, avg_seconds: 81.9, assigned_class_id: "c-pro" },
  { id: "r2", name: "Ben Okoro", best_time: "1:20.900", avg_time: "1:21.000", best_seconds: 80.9, avg_seconds: 81.0, assigned_class_id: "" },
  { id: "r3", name: "Cyd Okafor", best_time: null, avg_time: null, best_seconds: null, avg_seconds: null, assigned_class_id: "" },
];

// ── The board ───────────────────────────────────────────────────────────────
const board = render("PlacementBoard", (
  <PlacementBoard rows={rows} buckets={buckets} metric="best" onMove={() => {}} />
));
ok("every destination is a column", board.includes("Pro Class") && board.includes("Amateur Class"));
ok("the unplaced field has a column of its own", board.includes("Unplaced drivers"));
ok("cards carry the driver", board.includes("Ana Ruiz") && board.includes("Cyd Okafor"));
ok("…and the time the placement is being made on", board.includes("1:20.100"));
// Drag is the nice way to move somebody; it must never be the only way, or the
// board is unusable on a tablet and with a keyboard.
ok("cards are draggable", board.includes("draggable=\"true\""));
ok("…and every card also has a move menu", (board.match(/placement-card-move/g) || []).length === rows.length);
ok("a driver with no lap is marked rather than hidden", board.includes("is-timeless"));

// A board with no destinations must say what to do about it, not render an
// empty frame.
const empty = render("PlacementBoard · no destinations", (
  <PlacementBoard rows={rows} buckets={[]} onMove={() => {}} />
));
ok("an empty board points at Destinations", empty.includes("Destinations"));

// Read-only (a completed session, or a non-admin): everything still shows, but
// nothing can be dragged or re-assigned.
const locked = render("PlacementBoard · read-only", (
  <PlacementBoard rows={rows} buckets={buckets} canEdit={false} onMove={() => {}} />
));
ok("a locked board still shows the field", locked.includes("Ana Ruiz"));
ok("…but offers no way to move anybody", !locked.includes("placement-card-move") && !locked.includes("draggable=\"true\""));

// ── Auto-place ──────────────────────────────────────────────────────────────
// Modals render through a portal to document.body, so on the server they
// produce nothing — mounting them is what's being checked here. The question
// they ask is pinned below, on the shared list both the modal and the board
// header read from, so the two can't drift apart.
render("AutoPlaceModal", (
  <AutoPlaceModal rows={rows} buckets={buckets} onClose={() => {}} onApply={() => {}} />
));
ok("the admin is asked best lap or average lap",
  PLACEMENT_METRICS.map(m => m.label).join("|") === "Best Lap|Average Lap");
ok("…and each option explains itself", PLACEMENT_METRICS.every(m => m.hint.length > 10));
// The split the modal shows is the split it applies — same function, one call.
const preview = previewAutoPlace(rows, buckets, { key: "best" });
ok("the preview counts each division", preview.counts.map(c => c.count).join(",") === "1,1");
ok("…and names who it can't place", preview.noTime.includes("Cyd Okafor"));

// ── Destinations ────────────────────────────────────────────────────────────
render("PlacementDestinationsModal", (
  <PlacementDestinationsModal
    trial={{ id: "t1", season_id: "sea-1", class_ids: [], series_ids: [], series_seasons: {} }}
    seriesList={[{ id: "s-pro", name: "Pro Series" }]}
    classes={[{ id: "c-pro", name: "Pro Class" }]}
    seasonName="Season 4"
    onClose={() => {}} onSaved={() => {}} />
));
const targets = render("PlacementTargetFields", (
  <PlacementTargetFields idPrefix="t" seriesList={[{ id: "s-pro", name: "Pro Series" }]}
    classes={[{ id: "c-pro", name: "Pro Class" }, { id: "c-am", name: "Amateur Class" }]}
    seasonId="sea-1" seasonName="Season 4"
    seriesIds={[]} seriesSeasons={{}} classIds={["c-pro"]} onChange={() => {}} />
));
ok("destinations are checkboxes, not typing", (targets.match(/type="checkbox"/g) || []).length >= 3);
ok("…covering both series and classes", targets.includes("Pro Series") && targets.includes("Amateur Class"));
ok("…and it says where the drivers end up", targets.includes("These drivers are going to"));

// ── The screens either side of it ───────────────────────────────────────────
render("AddDriverToTrial", (
  <AddDriverToTrial pool={[]} drivers={[]} games={{}} taken={new Set()} onAdd={() => {}} />
));
render("DriverMergeTool", <DriverMergeTool />);

console.log(`placementBoardFlow: ${n} assertions passed`);
