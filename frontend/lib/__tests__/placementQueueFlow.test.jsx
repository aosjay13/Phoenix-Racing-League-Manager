// Guard: the Placement Roster must MOUNT, and it must say who is waiting and
// exactly what they signed up for.
//
// The rules are unit-tested in placementQueue.test.mjs. What that can't catch is
// the screen itself: a component that imports one of them wrongly takes the
// whole page down behind the error boundary, and this page is the only place in
// the app where a driver approved for a placement appears at all — losing it
// loses them, silently, which is the exact failure the list exists to prevent.
//
// The rest asserts on the columns, because "it must clearly display the
// Driver's Name and exactly which Series, Season and Class they signed up for"
// is the requirement, and a table that renders with the names alone meets none
// of it.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AwaitingPlacements, PlacementRosterTable } from "@/components/AwaitingPlacements";

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

const waiting = [
  {
    id: "q1", name: "Ana Ruiz", user_email: "ana@example.com",
    game_name: "iRacing", series_name: "Gold Series", season_name: "Season 4",
    class_names: ["Pro"], number: "24", car: "GT3",
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: "q2", name: "Ben Okoro",
    game_name: "iRacing", series_name: "Silver Series", season_name: "Season 4",
    class_names: [], number: "", car: "",
    created_at: new Date().toISOString(),
  },
];

// ── The roster ─────────────────────────────────────────────────────────────
const table = render("PlacementRosterTable", <PlacementRosterTable rows={waiting} />);
ok("every waiting driver is named", table.includes("Ana Ruiz") && table.includes("Ben Okoro"));
// The three the request names, each its own column — a placement night is
// prepared per season, and a name on its own can't say which one.
ok("the series they signed up for is shown",
  table.includes("Gold Series") && table.includes("Silver Series"));
ok("so is the season", table.includes("Season 4"));
ok("so is the class they asked for", table.includes("Pro"));
ok("and the game above it", table.includes("iRacing"));
ok("what they asked to run is shown", table.includes("#24") && table.includes("GT3"));
ok("as is how long they have been waiting", table.includes("3 days ago"));
// The one thing this table must never let an admin forget, given it is drawn
// exactly like the rosters of people who ARE racing.
ok("every row says they are on no roster",
  (table.match(/Not on a roster/g) || []).length === waiting.length);
// A driver who picked no class is the normal case on a placement-graded series
// — the session is what decides — so the cell explains rather than going blank.
ok("an undecided class reads as undecided", table.includes("the session decides"));

// The action column only exists where there is an action to offer.
ok("no action column without an action", !render("read-only roster",
  <PlacementRosterTable rows={waiting} />).includes("Withdraw"));
ok("…and the withdraw action renders when there is",
  render("roster with actions",
    <PlacementRosterTable rows={waiting} action={() => <button type="button">Withdraw</button>} />)
    .includes("Withdraw"));

// ── The panel it lives in ──────────────────────────────────────────────────
//
// It must mount, and say nothing before its first load: a placement roster is
// empty for most leagues, and a skeleton above every approvals queue would be
// noise. (The Approvals page itself is a .js file, which this suite's transform
// doesn't cover — the panel is the part that can break.)
ok("the panel mounts and stays silent until it has loaded",
  render("AwaitingPlacements", <AwaitingPlacements />) === "");
ok("…and standalone it mounts too",
  render("AwaitingPlacements standalone", <AwaitingPlacements standalone />) === "");

console.log(`placementQueueFlow: ${n} assertions passed`);
