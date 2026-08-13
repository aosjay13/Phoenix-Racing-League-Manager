// Approving a sign-up is the one admin action whose result lands out of sight:
// a driver appears on ONE season's roster, on a screen the admin may not be
// scoped to. The badge and panel that announce it have to be right about three
// things, or they're worse than nothing:
//
//   1. only what's actually NEW is announced — a badge that re-announces the
//      league's whole back catalogue is one nobody reads;
//   2. only people who JOINED are announced — approving a car-number change
//      moves a number on a roster entry that already existed, and calling that
//      "added to a roster" sends an admin looking for a driver who was already
//      there;
//   3. the announcement names the roster it landed on, since the whole point is
//      knowing where to go.
import assert from "node:assert";
import {
  additionDetail, additionRow, additionsTitle, groupBySeason, newAdditions,
  pendingElsewhere, pendingElsewhereTitle,
} from "../rosterAdditions.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const approved = (over = {}) => ({
  id: "r1", status: "approved", kind: "signup",
  name: "Ana Ruiz", number: "7", car: "Ferrari 296 GT3", class_names: ["Pro"],
  season_id: "s4", season_name: "Season 4",
  series_id: "fp", series_name: "Formula Phoenix",
  game_id: "ir", game_name: "iRacing",
  resolved_at: "2026-03-02T10:00:00Z",
  ...over,
});

// ── 1. Only what's new ─────────────────────────────────────────────────────
const rows = [
  approved({ id: "old", name: "Bo Chen", resolved_at: "2026-01-01T09:00:00Z" }),
  approved({ id: "new1", name: "Ana Ruiz", resolved_at: "2026-03-02T10:00:00Z" }),
  approved({ id: "new2", name: "Cyd Okafor", resolved_at: "2026-03-03T10:00:00Z" }),
];
const seen = "2026-02-01T00:00:00Z";
check("only approvals since the stamp", newAdditions(rows, seen).map(a => a.id), ["new2", "new1"]);
check("newest first", newAdditions(rows, seen).map(a => a.name), ["Cyd Okafor", "Ana Ruiz"]);
check("no stamp yet means everything is new", newAdditions(rows, "").length, 3);
check("a stamp after everything means nothing is new", newAdditions(rows, "2027-01-01T00:00:00Z"), []);
// The stamp is an exact instant: the row resolved AT it has already been seen.
check("the row on the stamp itself is not re-announced",
  newAdditions([approved({ id: "onTheDot", resolved_at: seen })], seen), []);
check("nothing at all is safe", newAdditions(), []);
check("a row with no resolved_at is not announced",
  newAdditions([approved({ id: "unstamped", resolved_at: "" })], seen), []);

// ── 2. Only people who JOINED ──────────────────────────────────────────────
// A number change is somebody already racing who wanted a different number.
// Announcing it as "added to a roster" sends an admin hunting for a new driver
// who isn't there.
const withNumberChange = [
  approved({ id: "joined", name: "Ana Ruiz" }),
  approved({ id: "moved", kind: "number_change", name: "Bo Chen", resolved_at: "2026-03-04T10:00:00Z" }),
];
check("a number change is not an addition",
  newAdditions(withNumberChange, seen).map(a => a.id), ["joined"]);

// ── 3. It names where the driver landed ────────────────────────────────────
const row = additionRow(approved());
check("the season", [row.series_name, row.season_name], ["Formula Phoenix", "Season 4"]);
check("the ids needed to steer the scope menus",
  [row.game_id, row.series_id, row.season_id], ["ir", "fp", "s4"]);
check("and who it was", row.name, "Ana Ruiz");
// Stamped on the request at submission, so a series renamed since still reads
// as it did when they signed up rather than breaking the row.
check("a request with nothing on it still renders",
  [additionRow({}).name, additionRow({}).season_name, additionRow({}).series_name],
  ["Driver", "Season", "Series"]);
ok("somebody new to the league is flagged", additionRow(approved({ new_driver: { name: "X" } })).is_new_driver);
ok("an existing driver is not", !additionRow(approved()).is_new_driver);

// ── Grouped by the roster they landed on ───────────────────────────────────
// One trip to a season's roster settles every driver who joined it, so the
// panel offers one button per season rather than one per person.
const mixed = newAdditions([
  approved({ id: "a", name: "Ana", season_id: "s4", resolved_at: "2026-03-01T10:00:00Z" }),
  approved({ id: "b", name: "Bo", season_id: "s4", resolved_at: "2026-03-05T10:00:00Z" }),
  approved({ id: "c", name: "Cyd", season_id: "w1", season_name: "Winter Cup",
             series_name: "Banger Bash", resolved_at: "2026-03-03T10:00:00Z" }),
], seen);
const groups = groupBySeason(mixed);
check("one group per season", groups.map(g => g.season_id), ["s4", "w1"]);
check("the season with the most recent arrival leads", groups[0].season_id, "s4");
check("everyone who joined it is in that group", groups[0].drivers.map(d => d.name), ["Bo", "Ana"]);
check("and the other season has its own", groups[1].drivers.map(d => d.name), ["Cyd"]);
check("nothing to group", groupBySeason([]), []);
// Rows written before season_id was stamped must not all collapse into one
// group keyed on an empty id.
const unstamped = groupBySeason(newAdditions([
  approved({ id: "x", season_id: "", season_name: "Season 1", series_name: "A" }),
  approved({ id: "y", season_id: "", season_name: "Season 2", series_name: "B" }),
], seen));
check("seasons with no id are still told apart", unstamped.length, 2);

// ── What the badge and the rows say ────────────────────────────────────────
check("both numbers, because they answer different questions",
  additionsTitle(mixed), "3 drivers added to 2 rosters");
check("one of each reads naturally",
  additionsTitle(newAdditions([approved()], seen)), "1 driver added to 1 roster");
check("nothing waiting", additionsTitle([]), "No new drivers on your rosters");
check("called with nothing", additionsTitle(), "No new drivers on your rosters");

check("a full detail line", additionDetail(additionRow(approved())), "#7 · Ferrari 296 GT3 · Pro");
// A series that runs no numbers and no car list would otherwise get a row of
// separators around nothing.
check("a season that asks for neither",
  additionDetail(additionRow(approved({ number: "", car: "", class_names: [] }))), "");
check("a new driver is called out",
  additionDetail(additionRow(approved({ number: "", car: "", class_names: [], new_driver: { name: "X" } }))),
  "new to the league");
check("leading zeros survive into the badge",
  additionDetail(additionRow(approved({ number: "007", car: "", class_names: [] }))), "#007");

// ── Waiting somewhere you aren't looking ───────────────────────────────────
// The queue panel on the roster is scoped to ONE season, so a sign-up for any
// other season was invisible until the admin happened to steer the dropdowns
// at it. This is what tells them it's there.
const waiting = [
  { id: "w1", kind: "signup", name: "Dee", season_id: "s4", season_name: "Season 4",
    series_name: "Formula Phoenix", created_at: "2026-03-01T09:00:00Z" },
  { id: "w2", kind: "signup", name: "Eli", season_id: "s4", season_name: "Season 4",
    series_name: "Formula Phoenix", created_at: "2026-02-01T09:00:00Z" },
  { id: "w3", kind: "signup", name: "Fay", season_id: "w1", season_name: "Winter Cup",
    series_name: "Banger Bash", created_at: "2026-03-05T09:00:00Z" },
  { id: "w4", kind: "number_change", name: "Gus", season_id: "s4", season_name: "Season 4",
    series_name: "Formula Phoenix", created_at: "2026-03-06T09:00:00Z" },
];
check("the season already on screen is left out — its own panel has it",
  pendingElsewhere(waiting, "s4").map(g => g.season_id), ["w1"]);
check("with no season scoped, every waiting season is elsewhere",
  pendingElsewhere(waiting, "").map(g => g.season_id).sort(), ["s4", "w1"]);
check("a number change is not somebody waiting to get in",
  pendingElsewhere(waiting, "w1")[0].drivers.map(d => d.name), ["Eli", "Dee"]);
check("longest wait first, since that's the order the queue works in",
  pendingElsewhere(waiting, "w1")[0].drivers.map(d => d.name), ["Eli", "Dee"]);
check("nothing waiting anywhere else", pendingElsewhere([], "s4"), []);
check("called with nothing", pendingElsewhere(), []);
check("the strip's heading counts people and seasons",
  pendingElsewhereTitle(pendingElsewhere(waiting, "")), "3 sign-ups waiting in 2 other seasons");
check("one of each reads naturally",
  pendingElsewhereTitle(pendingElsewhere(waiting, "s4")), "1 sign-up waiting in 1 other season");
check("nothing to say", pendingElsewhereTitle([]), "");

// Pending rows carry created_at, not resolved_at, and must still order and
// group properly — one `at` field covers both strips.
check("waiting rows group by their season", pendingElsewhere(waiting, "").length, 2);
ok("and the most recent season leads",
  pendingElsewhere(waiting, "")[0].season_id === "w1");

console.log(`rosterAdditions: ${n} assertions passed`);
