// The Chg column on the Standings: places gained or lost since the latest round.
//
// "Before" is the same championship with the latest round's results taken out,
// scored the same way, so the column always agrees with the table it sits in.
// The rules held here:
//
//   • the latest round is the last in the Schedule's order that scored points
//     in the scope being viewed — a class measures from its own latest round;
//   • a round with nothing scored yet, or one that pays no points, is never it;
//   • before a second round has scored there is nothing to compare, so null;
//   • a driver or team whose first points came in the latest round is null;
//   • a driver on the roster twice is still matched to their earlier place.
//
// The share graphic draws the same number as a green ▲ +N or red ▼ −N, and the
// page puts the column immediately right of Pos on screen and in the exporter.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { standingsFromBundle } from "@/lib/standingsCompute";
import { toGraphicTable } from "@/lib/shareGraphic";
import { GraphicCard } from "@/components/ShareGraphicModal";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// P1 100 · P2 90 · P3 80 · P4 70 · P5 60
const season = {
  id: "s1", name: "Season 1", game_id: "g1", series_id: "sr1",
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70, 5: 60 }),
  qual_points: "{}", bonus_points: {},
};

const result = (id, race, entry, pos, cls) => ({
  id, season_id: "s1", race_id: race, entry_id: entry, session: "Race", session_type: "race", finish_pos: pos, class_id: cls,
});

// Round 1: Cy, Ana, Bo, Di.   Round 2: Di, Bo, Cy, Ana, Eli (Eli's first).
// Round 3 is Amateur only: Eli, Di, Cy, Fay (Fay's first).
// Round 4 hasn't been run. Round 5 is an exhibition that pays nothing.
const RESULTS = [
  result("x1", "r1", "e3", 1, "am"), result("x2", "r1", "e1", 2, "pro"),
  result("x3", "r1", "e2", 3, "pro"), result("x4", "r1", "e4", 4, "am"),
  result("x5", "r2", "e4", 1, "am"), result("x6", "r2", "e2", 2, "pro"),
  result("x7", "r2", "e3", 3, "am"), result("x8", "r2", "e1", 4, "pro"),
  result("x9", "r2", "e5", 5, "am"),
  result("x10", "r3", "e5", 1, "am"), result("x11", "r3", "e4", 2, "am"),
  result("x12", "r3", "e3", 3, "am"), result("x13", "r3", "e6", 4, "am"),
  result("x14", "r5", "e1", 1, "pro"), result("x15", "r5", "e6", 2, "am"),
];

function bundleThrough(raceIds, results = RESULTS) {
  // Listed out of order on purpose: the Schedule's round order decides which
  // round is the latest, not the order the documents arrive in.
  const races = [
    { id: "r3", season_id: "s1", name: "Round 3", round_number: 3, date: "2025-01-15", sessions: ["Race"], class_id: "am" },
    { id: "r5", season_id: "s1", name: "Exhibition", round_number: 5, date: "2025-01-29", sessions: ["Race"],
      session_points_enabled: { Race: false }, session_stats: { Race: false } },
    { id: "r1", season_id: "s1", name: "Round 1", round_number: 1, date: "2025-01-01", sessions: ["Race"] },
    { id: "r4", season_id: "s1", name: "Round 4", round_number: 4, date: "2025-01-22", sessions: ["Race"] },
    { id: "r2", season_id: "s1", name: "Round 2", round_number: 2, date: "2025-01-08", sessions: ["Race"] },
  ];
  return {
    scope: "season", league_id: null, game_id: "g1", series_id: "sr1", season_id: "s1",
    seasons: [season],
    series: [{ id: "sr1", game_id: "g1", name: "Cup" }],
    games: [{ id: "g1", name: "AMS2" }],
    tracks: [], team_seasons: [], drivers: [], account_names: {}, points_templates: [],
    time_trials: [], time_trial_entries: [],
    teams: [
      { id: "t1", name: "Team One" }, { id: "t2", name: "Team Two" },
      { id: "t3", name: "Team Three" }, { id: "t4", name: "Team Four" },
    ],
    classes: [
      { id: "pro", season_id: "s1", name: "Pro", sort_order: 1 },
      { id: "am", season_id: "s1", name: "Amateur", sort_order: 2 },
    ],
    races: races.filter(r => raceIds.includes(r.id)),
    entries: [
      { id: "e1", season_id: "s1", name: "Ana", class_ids: ["pro"], class_id: "pro", team_id: "t1" },
      { id: "e2", season_id: "s1", name: "Bo", class_ids: ["pro"], class_id: "pro", team_id: "t1" },
      { id: "e3", season_id: "s1", name: "Cy", class_ids: ["am"], class_id: "am", team_id: "t2" },
      { id: "e4", season_id: "s1", name: "Di", class_ids: ["am"], class_id: "am", team_id: "t3" },
      { id: "e5", season_id: "s1", name: "Eli", class_ids: ["am"], class_id: "am", team_id: "t3" },
      { id: "e6", season_id: "s1", name: "Fay", class_ids: ["am"], class_id: "am", team_id: "t4" },
    ],
    results: results.filter(r => raceIds.includes(r.race_id)),
  };
}

const standings = (raceIds, params = {}) => standingsFromBundle(bundleThrough(raceIds), { seasonId: "s1", ...params }).body;
const table = rows => rows.map(r => `${r.rank} ${r.driver_name ?? r.team} ${r.rank_change}`);

// ── 1. One round in: nothing to compare with yet ───────────────────────────
eq("after the first round every driver reads null",
  table(standings(["r1"]).drivers), ["1 Cy null", "2 Ana null", "3 Bo null", "4 Di null"]);
eq("and so does every team", standings(["r1"]).teams.map(r => r.rank_change), [null, null, null]);

// ── 2. Round 2: gained, lost, unchanged, and a debut ───────────────────────
// Before: Cy 100, Ana 90, Bo 80, Di 70.
// After:  Cy 180, Di 170 (a win), Bo 170, Ana 160, Eli 60.
eq("round 2 measures against the table after round 1",
  table(standings(["r1", "r2"]).drivers),
  ["1 Cy 0", "2 Di 2", "3 Bo 0", "4 Ana -2", "5 Eli null"]);

// ── 3. The whole season: the latest round is Round 3 ───────────────────────
// Round 4 has no results and the exhibition pays no points, so neither is it.
// After round 3: Cy 260, Di 260, Bo 170, Eli 160 (a win), Ana 160, Fay 70.
const all = ["r1", "r2", "r3", "r4", "r5"];
eq("the full season measures from Round 3",
  table(standings(all).drivers),
  ["1 Cy 0", "2 Di 0", "3 Bo 0", "4 Eli 1", "5 Ana -1", "6 Fay null"]);

// ── 4. A class measures from ITS latest round ──────────────────────────────
// Round 3 was Amateur only, so Pro's latest round is Round 2 — where Bo passed
// Ana. Measuring Pro from Round 3 would show no movement at all.
eq("Pro measures from its own latest round",
  table(standings(all, { classId: "pro", className: "Pro" }).drivers), ["1 Bo 1", "2 Ana -1"]);
eq("Amateur measures from Round 3",
  table(standings(all, { classId: "am", className: "Amateur" }).drivers),
  ["1 Cy 0", "2 Di 0", "3 Eli 0", "4 Fay null"]);

// ── 5. Teams get the same column ───────────────────────────────────────────
// After round 2: One 330, Three 230, Two 180. After round 3: Three 490,
// One 330, Two 260, Four 70.
eq("team places gained and lost",
  table(standings(all).teams), ["1 Team Three 1", "2 Team One -1", "3 Team Two 0", "4 Team Four null"]);
eq("team movement at round 2",
  table(standings(["r1", "r2"]).teams), ["1 Team One 0", "2 Team Three 1", "3 Team Two -1"]);

// ── 6. A driver on the roster twice keeps their earlier place ──────────────
// Gus ran rounds 1 and 2 on an entry with no number, then round 3 on the one
// carrying his number. That entry now leads his row, and it wasn't in the
// table before round 3 at all — he must still read as having held his place.
{
  const b = bundleThrough(["r1", "r2", "r3"], [
    result("y1", "r1", "e1", 1, "pro"), result("y2", "r1", "g2", 2, "pro"),
    result("y3", "r2", "e1", 1, "pro"), result("y4", "r2", "g2", 2, "pro"),
    result("y5", "r3", "e1", 1, "pro"), result("y6", "r3", "g1", 2, "pro"),
  ]);
  b.entries.push(
    { id: "g1", season_id: "s1", name: "Gus", number: "7", driver_id: "d-gus", created_at: "2025-01-10" },
    { id: "g2", season_id: "s1", name: "Gus", driver_id: "d-gus", created_at: "2025-01-01" },
  );
  const rows = standingsFromBundle(b, { seasonId: "s1" }).body.drivers;
  const gus = rows.find(r => r.driver_name === "Gus");
  eq("the row is led by the numbered entry", gus.entry_id, "g1");
  eq("and still reads as holding second", gus.rank_change, 0);
}

// ── 7. The exporter carries the raw number and draws the arrow ────────────
const rows = [
  { rank: 1, rank_change: 2, driver_name: "Cy", adjusted_points: 260 },
  { rank: 2, rank_change: -1, driver_name: "Di", adjusted_points: 250 },
  { rank: 3, rank_change: 0, driver_name: "Bo", adjusted_points: 170 },
  { rank: 4, rank_change: null, driver_name: "Fay", adjusted_points: 70 },
];
const graphic = toGraphicTable([["rank", "Pos"], ["rank_change", "Chg"], ["driver_name", "Driver"], ["adjusted_points", "Points"]],
  rows, { nameKey: "driver_name" });
eq("the Chg column is marked for the card to draw", graphic.columns[1].format, "change");
eq("its cells stay numbers", graphic.rows.map(r => r.cells[1]), [2, -1, 0, null]);
eq("no other column is", graphic.columns.filter(c => c.format).map(c => c.key), ["rank_change"]);

const theme = {
  pageBg: "#0b0b12", cardBg: "#14141f", ink: "#eeeef5", muted: "#bfbfd4",
  faint: "#9a9ab4", border: "rgba(255,255,255,0.09)", headBg: "rgba(0,180,216,0.12)",
  headInk: "#7fe3ff", stripe: "rgba(255,255,255,0.025)", accent: "#00b4d8",
  up: "#34d399", down: "#f87171",
};
const html = renderToStaticMarkup(
  <GraphicCard theme={theme} title="Standings" columns={graphic.columns} rows={graphic.rows}
    totalRows={graphic.rows.length} shownCount={graphic.rows.length} />
);
const cells = html.split("<tr").slice(2).map(tr => tr.split("<td")[2]);
ok("a gain is a green up arrow and +N",
  cells[0].includes("color:#34d399") && cells[0].includes("▲") && cells[0].includes(">+2<"));
ok("a loss is a red down arrow and −N",
  cells[1].includes("color:#f87171") && cells[1].includes("▼") && cells[1].includes(">−1<"));
ok("no change is a quiet dash", cells[2].includes("—") && !/[▲▼]/.test(cells[2]));
ok("nothing to compare is a quiet dash too", cells[3].includes("—") && !/[▲▼]/.test(cells[3]));
ok("the word \"positions\" is never printed", !/position/i.test(html.replace(/<[^>]+>/g, " ")));

// ── 8. The page puts it right of Pos, on screen and in the exporter ───────
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../../app/standings/page.js"), "utf8");
const header = page.slice(page.indexOf("<thead>"), page.indexOf("</thead>"));
const betweenPosAndChg = header.slice(header.indexOf("Pos{arrow(rankKey)}"), header.indexOf('Chg{arrow("rank_change")}'));
ok("the Chg header comes straight after Pos",
  betweenPosAndChg.length > 0 && (betweenPosAndChg.match(/<th\b/g) || []).length === 1
  && header.indexOf("Chg{") < header.indexOf("{nameLabel}"));
const body = page.slice(page.indexOf("<tbody>"), page.indexOf("</tbody>"));
ok("the Chg cell comes straight after the rank badge",
  body.indexOf("<RankBadge") < body.indexOf("<PositionChange") && body.indexOf("<PositionChange") < body.indexOf("renderName(r)"));
ok("the exporter offers it right after Pos",
  /\["rank", "Pos"\],\s*\["rank_change", "Chg"\],/.test(page));

console.log(`positionChange: ${n} checks passed — the Chg column shows places gained and lost since the last round`);
