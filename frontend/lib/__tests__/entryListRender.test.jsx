// The entry list, mounted. The rules behind it are in entryList.test.mjs; this
// is the part those can't see — that the table actually renders the payload
// /api/entry-list sends, and that the rows opening one say what they open.
//
// What has to hold on screen:
//   1. the field is listed in the order the API sent it, numbers and all;
//   2. a column only appears when something is in it — a season with no
//      classes, teams or cars is a plain numbered list, not a grid of dashes;
//   3. a waiting sign-up is listed apart, never as a row of the field;
//   4. the player's own row is marked.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { EntryListContent, EntryListRows } from "@/components/EntryList";

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

const base = {
  season: { id: "s1", name: "Season 4", status: "active", logo_url: "" },
  series: { id: "sr1", name: "Formula Phoenix", logo_url: "" },
  game_name: "iRacing",
  open: true,
  viewer: { staff: false, standing: "entered" },
};

// ── 1 & 2. A full multi-class field ────────────────────────────────────────
const full = render("full field", <EntryListContent data={{
  ...base,
  classes: [{ id: "c1", name: "Pro" }, { id: "c2", name: "Am" }],
  entries: [
    { entry_id: "e1", driver_id: "d1", number: "2", name: "Driver A", class_names: ["Pro"],
      team: { id: "t1", name: "Team X", logo_url: "", color: "" }, cars: ["Porsche 911 GT3 R"], wants_number: null, mine: false },
    { entry_id: "e2", driver_id: null, number: "10", name: "Driver B", class_names: ["Am"],
      team: null, cars: [], wants_number: "11", mine: true },
  ],
  pending: [
    { id: "r1", number: "21", name: "Driver C", class_names: ["Am"], car: "BMW M4", awaiting_placement: false, mine: false },
  ],
}} />);
ok("titled with the series and season", full.includes("Formula Phoenix · Season 4"));
ok("says how many are in and waiting", full.includes("2 entries · 1 waiting on approval"));
ok("lists the first driver", full.includes("Driver A"));
ok("linked to their profile", full.includes('href="/drivers/d1"'));
ok("a driver with no profile is still listed", full.includes("Driver B"));
ok("in the order sent", full.indexOf("Driver A") < full.indexOf("Driver B"));
ok("with a class column", full.includes("<th>Class</th>"));
ok("a team column", full.includes("<th>Team</th>") && full.includes("Team X"));
ok("and a car column", full.includes("<th>Car</th>") && full.includes("Porsche 911 GT3 R"));
ok("a class tally", full.includes("Pro · 1") && full.includes("Am · 1"));
ok("a number change is shown beside the number", full.includes("→ #11"));
ok("the player's own row is marked", full.includes("(you)"));

// ── 3. Waiting sign-ups sit apart ──────────────────────────────────────────
ok("waiting sign-ups get their own heading", full.includes("Signed up, not on the roster yet"));
ok("and come after the field", full.indexOf("Driver C") > full.indexOf("Signed up, not on the roster yet"));
ok("each says what it's waiting on", full.includes("Waiting on approval"));

// ── 2. A plain numbered list ───────────────────────────────────────────────
const plain = render("plain field", <EntryListContent data={{
  ...base,
  classes: [],
  entries: [{ entry_id: "e1", driver_id: "d1", number: "7", name: "Solo", class_names: [], team: null, cars: [], wants_number: null, mine: false }],
  pending: [],
}} />);
ok("no class column without classes", !plain.includes("<th>Class</th>"));
ok("no team column without teams", !plain.includes("<th>Team</th>"));
ok("no car column without cars", !plain.includes("<th>Car</th>"));
ok("no waiting section when nobody is waiting", !plain.includes("Signed up, not on the roster yet"));
ok("one entry reads as one", plain.includes("1 entry"));

const empty = render("empty field", <EntryListContent data={{ ...base, classes: [], entries: [], pending: [] }} />);
ok("an empty season says so", empty.includes("Nobody is on the roster yet."));

const over = render("finished season", <EntryListContent data={{ ...base, open: false, classes: [], entries: [], pending: [] }} />);
ok("a finished season is labelled", over.includes("Season over"));

// ── The rows that open one ────────────────────────────────────────────────
const rows = render("rows", <EntryListRows
  seasons={[{ season_id: "s1", season_name: "Season 4", series_name: "Formula Phoenix", logo_url: "", game_name: "iRacing" }]}
  sub={s => s.game_name}
/>);
ok("a row names its season", rows.includes("Formula Phoenix · Season 4"));
ok("and says what it opens", rows.includes("Entry list →"));
ok("and is a button, not a link away", rows.includes('<button type="button"'));
ok("no dialog is open until one is clicked", !rows.includes("📋 Entry List"));

console.log(`entryListRender: ${n} checks passed`);
