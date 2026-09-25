// A season's entry list — who may read it, and what it says.
//
// What has to hold:
//
//   1. ONLY THE PEOPLE IN IT. A driver on the roster, or one whose sign-up is
//      in flight, reads the list; anybody else doesn't — staff aside, who see
//      every season's. A pending NUMBER CHANGE is not a sign-up and never lets
//      anybody in on its own.
//   2. NOBODY IS LISTED TWICE. A car mirrored onto `selected_car` is the same
//      car, and a number change is a driver already on the list.
//   3. A REQUEST IS NEVER SHOWN AS A SEAT. Waiting sign-ups are counted and
//      pasted apart from the entries.
import assert from "node:assert";
import {
  canViewEntryList, classTally, entryCars, entryListSummary, entryListText, entryStanding,
  joinedSeasons, pendingEntries, standingLabel,
} from "../entryList.js";
import { APPROVED_FOR_PLACEMENTS, NUMBER_CHANGE_KIND, PENDING, SIGNUP_KIND } from "../signupQueue.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── Where the caller stands ────────────────────────────────────────────────

const entries = [
  { id: "e1", driver_id: "d1", user_id: "u1", number: "7" },
  { id: "e2", driver_id: null, user_id: "u2", number: "12" },
];
check("on the roster by driver profile", entryStanding({ entries, uid: "zz", driverId: "d1" }), "entered");
check("on the roster by an older account link", entryStanding({ entries, uid: "u2", driverId: "" }), "entered");
check("a stranger isn't in it", entryStanding({ entries, uid: "u9", driverId: "d9" }), null);
check("nobody is matched on a blank id",
  entryStanding({ entries: [{ id: "x", driver_id: "", user_id: "" }], uid: "", driverId: "" }), null);

const pending = [
  { id: "r1", kind: SIGNUP_KIND, status: PENDING, uid: "u3", driver_id: null, number: "21" },
  { id: "r2", kind: SIGNUP_KIND, status: APPROVED_FOR_PLACEMENTS, uid: "u4", driver_id: "d4", number: "" },
  { id: "r3", kind: NUMBER_CHANGE_KIND, status: PENDING, uid: "u5", driver_id: "d5", entry_id: "e9", number: "3" },
];
check("a sign-up waiting on an admin", entryStanding({ entries, pending, uid: "u3" }), "pending");
check("a registration approved for placements", entryStanding({ entries, pending, driverId: "d4" }), "placement");
check("a number change alone lets nobody in", entryStanding({ entries, pending, uid: "u5", driverId: "d5" }), null);
check("the roster wins over a request", entryStanding({
  entries, pending: [{ kind: SIGNUP_KIND, status: PENDING, uid: "u1" }], uid: "u1", driverId: "d1",
}), "entered");

check("staff read any season's list", canViewEntryList({ staff: true, standing: null }), true);
check("a driver in the series reads it", canViewEntryList({ staff: false, standing: "entered" }), true);
check("so does one still waiting", canViewEntryList({ standing: "pending" }), true);
check("and one awaiting placement", canViewEntryList({ standing: "placement" }), true);
check("nobody else does", canViewEntryList({ staff: false, standing: null }), false);
check("and no answer at all is a no", canViewEntryList(), false);

// ── Cars ───────────────────────────────────────────────────────────────────

check("one season-wide pick", entryCars({ selected_car: "Porsche 911 GT3 R" }), ["Porsche 911 GT3 R"]);
check("the mirror isn't a second car",
  entryCars({ selected_car: "Ferrari 296", selected_cars: { c1: "Ferrari 296" } }), ["Ferrari 296"]);
check("one per class, whatever the case of the mirror",
  entryCars({ selected_car: "ferrari 296", selected_cars: { c1: "Ferrari 296", c2: "BMW M4" } }),
  ["Ferrari 296", "BMW M4"]);
check("no pick, no car", entryCars({}), []);
check("blanks are skipped", entryCars({ selected_car: "  ", selected_cars: { c1: "" } }), []);

// ── Waiting sign-ups ───────────────────────────────────────────────────────

const waiting = pendingEntries(pending, { uid: "u3" });
// r1 carries #21 and r2 no number, so r1 comes first in grid order.
check("number changes are left out", waiting.map(p => p.id), ["r1", "r2"]);
check("the caller's own is marked", waiting.find(p => p.id === "r1").mine, true);
check("somebody else's isn't", waiting.find(p => p.id === "r2").mine, false);
check("placement is said", waiting.find(p => p.id === "r2").awaiting_placement, true);

// ── The summary line ──────────────────────────────────────────────────────

check("one entry reads as one", entryListSummary({ entries: [{}], pending: [] }), "1 entry");
check("an empty list still says so", entryListSummary({ entries: [], pending: [] }), "0 entries");
check("both kinds of waiting are named",
  entryListSummary({ entries: [{}, {}], pending: [{ awaiting_placement: false }, { awaiting_placement: true }] }),
  "2 entries · 1 waiting on approval · 1 awaiting placement");

// ── Class tally ────────────────────────────────────────────────────────────

const classes = [{ id: "c1", name: "Pro" }, { id: "c2", name: "Am" }, { id: "c3", name: "Rookie" }];
check("no classes, no tally", classTally([{ class_names: [] }], []), []);
check("counted in class order, an empty class included, and a driver in two counts in both",
  classTally([
    { class_names: ["Am"] }, { class_names: ["Pro", "Am"] }, { class_names: [] },
  ], classes),
  [{ name: "Pro", count: 1 }, { name: "Am", count: 2 }, { name: "Rookie", count: 0 }, { name: "No class", count: 1 }]);

// ── Pasting it somewhere ──────────────────────────────────────────────────

const text = entryListText({
  title: "Formula Phoenix · Season 4",
  entries: [
    { number: "10", name: "Driver B", class_names: ["Am"], team: null, cars: [] },
    { number: "2", name: "Driver A", class_names: ["Pro"], team: { name: "Team X" }, cars: ["Porsche 911 GT3 R"] },
  ],
  pending: [{ number: "21", name: "Driver C", class_names: [], car: "BMW M4" }],
});
check("numbered, in grid order, with a waiting section apart", text.split("\n"), [
  "Formula Phoenix · Season 4 — Entry List",
  "#2  Driver A · Pro · Team X · Porsche 911 GT3 R",
  "#10 Driver B · Am",
  "",
  "Signed up, not on the roster yet:",
  "#21 Driver C · BMW M4",
]);
ok("an empty list says so rather than pasting nothing",
  entryListText({ title: "S", entries: [], pending: [] }).includes("No entries yet."));
check("a driver with no number isn't given a stray #",
  entryListText({ entries: [{ number: "", name: "Solo", class_names: [], cars: [] }] }), "Solo");

// ── The Dashboard's rows ──────────────────────────────────────────────────

const payload = {
  my_seasons: [
    { season_id: "s1", season_name: "Season 4", series_name: "GT", game_name: "iRacing", open: true, number: "7", class_names: ["Pro"] },
    { season_id: "s0", season_name: "Season 3", series_name: "GT", open: false, number: "7", class_names: [] },
  ],
  open_signups: [
    { season_id: "s2", season_name: "Season 1", series_name: "Cup", my_pending: true, my_awaiting_placement: false, roster: [{}, {}] },
    { season_id: "s3", season_name: "Season 1", series_name: "Trucks", my_pending: true, my_awaiting_placement: true, roster: [] },
    { season_id: "s4", season_name: "Season 2", series_name: "Open", my_pending: false, roster: [{}] },
  ],
};
const rows = joinedSeasons(payload);
check("racing first, then waiting; a closed season and one never joined are left out",
  rows.map(r => [r.season_id, r.standing]),
  [["s1", "entered"], ["s2", "pending"], ["s3", "placement"]]);
check("nothing joined, nothing shown", joinedSeasons({ my_seasons: [], open_signups: [{ my_pending: false }] }), []);
check("no payload is no rows", joinedSeasons(null), []);
check("their own place on the list", standingLabel(rows[0]), "You're on the list · #7 · Pro");
check("a sign-up still with the admins", standingLabel(rows[1]), "Your sign-up is waiting on an admin");
ok("a placement registration isn't called a seat", standingLabel(rows[2]).includes("not on the roster yet"));

console.log(`entryList: ${n} assertions passed`);
