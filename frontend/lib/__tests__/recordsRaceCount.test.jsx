// The Records page's scope figures: how many races the chosen scope holds, and
// the average field those races drew.
//
// The rule this suite exists for is that the race count follows the Game /
// Series / Season / Class menus EXACTLY — the same scope the record holders
// beside it were crowned in. A "Most Wins" of 4 means something different over
// one 8-race season than over 120 races of league history, so the count has to
// narrow with the dropdowns and widen back out to every race the league has run
// when they're set to "All". A count that quietly stayed league-wide inside a
// class would caption the record book with the wrong denominator.
//
// It is a CALENDAR count, not a results count: an event still to be run is a
// race the scope holds. The average beside it is drawn only from races with
// finalized results, which is why the card prints both.
//
// The card itself is checked at source level, the way raceStats.test.jsx checks
// the results header's — the page needs a live bundle and the league dropdowns
// to drive, and what has to hold is that it renders the scoped figure rather
// than a hard-coded or league-wide one.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildStats } from "@/lib/statsCompute";
import { indexBundle } from "@/lib/rawIndex";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// ── A two-game league ─────────────────────────────────────────────────────
//
// GT7 runs one season with two classes (Pro and Am) over five events; iRacing
// runs one season of three. Dates straddle "today" so completed and upcoming
// both have something in them, and one GT7 event is left undated — a round on
// the calendar with no date set yet, which still counts as a race the season
// holds.

const PAST = "2020-01-05";
const FUTURE = "2099-06-01";

const games = [{ id: "g-gt7", name: "GT7" }, { id: "g-ir", name: "iRacing" }];
const series = [
  { id: "ser-gt", name: "Phoenix GT", game_id: "g-gt7" },
  { id: "ser-oval", name: "Phoenix Oval", game_id: "g-ir" },
];
const seasons = [
  { id: "sea-gt", name: "Season 1", series_id: "ser-gt", game_id: "g-gt7" },
  { id: "sea-oval", name: "Season 1", series_id: "ser-oval", game_id: "g-ir" },
];
const classes = [
  { id: "cls-pro", season_id: "sea-gt", name: "Pro" },
  { id: "cls-am", season_id: "sea-gt", name: "Am" },
];

// GT7: two shared rounds, one pinned to Pro, one pinned to Am, one undated.
const races = [
  { id: "r1", season_id: "sea-gt", name: "Round 1", date: PAST },
  { id: "r2", season_id: "sea-gt", name: "Round 2", date: PAST },
  { id: "r3", season_id: "sea-gt", name: "Pro Special", date: PAST, class_id: "cls-pro" },
  { id: "r4", season_id: "sea-gt", name: "Am Special", date: FUTURE, class_id: "cls-am" },
  { id: "r5", season_id: "sea-gt", name: "Finale, date TBC" },
  { id: "r6", season_id: "sea-oval", name: "Oval 1", date: PAST },
  { id: "r7", season_id: "sea-oval", name: "Oval 2", date: PAST },
  { id: "r8", season_id: "sea-oval", name: "Oval 3", date: FUTURE },
];

const entries = [
  { id: "e-pro-1", season_id: "sea-gt", name: "Ada", driver_id: "d1", class_ids: ["cls-pro"] },
  { id: "e-pro-2", season_id: "sea-gt", name: "Bo", driver_id: "d2", class_ids: ["cls-pro"] },
  { id: "e-am-1", season_id: "sea-gt", name: "Cy", driver_id: "d3", class_ids: ["cls-am"] },
  { id: "e-oval-1", season_id: "sea-oval", name: "Ada", driver_id: "d1" },
];

// Finalized results: both shared GT7 rounds ran a full three-car field, the Pro
// Special ran its two Pro cars, and one oval round has results in. The undated
// finale and the two future events have none — they are races the calendar
// holds but the average can't see.
const result = (id, race_id, season_id, entry_id, finish_pos) =>
  ({ id, race_id, season_id, entry_id, finish_pos, start_pos: finish_pos, session: "Race", status: "finished" });
const results = [
  result("x1", "r1", "sea-gt", "e-pro-1", 1),
  result("x2", "r1", "sea-gt", "e-pro-2", 2),
  result("x3", "r1", "sea-gt", "e-am-1", 3),
  result("x4", "r2", "sea-gt", "e-pro-1", 1),
  result("x5", "r2", "sea-gt", "e-pro-2", 2),
  result("x6", "r2", "sea-gt", "e-am-1", 3),
  result("x7", "r3", "sea-gt", "e-pro-1", 1),
  result("x8", "r3", "sea-gt", "e-pro-2", 2),
  result("x9", "r6", "sea-oval", "e-oval-1", 1),
];

// A bundle as /api/raw would return it for one scope: only the seasons that
// scope covers, which is what makes a game bundle a game's worth of races.
const bundleFor = seasonIds => indexBundle({
  scope: "league", games, series, classes,
  seasons: seasons.filter(s => seasonIds.includes(s.id)),
  races: races.filter(r => seasonIds.includes(r.season_id)),
  entries: entries.filter(e => seasonIds.includes(e.season_id)),
  results: results.filter(r => seasonIds.includes(r.season_id)),
  tracks: [], teams: [], team_seasons: [], drivers: [], account_names: {}, points_templates: [],
});

const all = ["sea-gt", "sea-oval"];
const summary = (index, params) => {
  const out = buildStats(index, params);
  assert.equal(out.status, 200, `scope ${JSON.stringify(params)} refused: ${out.body?.error}`);
  return out.body;
};

// ── 1. The count follows the scope ────────────────────────────────────────

const league = summary(bundleFor(all), { scope: "league" });
eq("All Games counts every race the league has ever put on the calendar",
  league.race_summary.total, 8);
eq("…including the ones already run", league.race_summary.completed, 5);
eq("…and the ones still to come", league.race_summary.upcoming, 2);
ok("an undated round is still a race the league holds",
  league.race_summary.total > league.race_summary.completed + league.race_summary.upcoming);

const gt7 = summary(bundleFor(["sea-gt"]), { scope: "game", gameId: "g-gt7" });
eq("one game counts only its own races", gt7.race_summary.total, 5);
const iracing = summary(bundleFor(["sea-oval"]), { scope: "game", gameId: "g-ir" });
eq("…and the other game counts only its own", iracing.race_summary.total, 3);
eq("the two games add back up to the league", gt7.race_summary.total + iracing.race_summary.total, 8);

eq("a series counts its seasons' races",
  summary(bundleFor(["sea-gt"]), { scope: "series", seriesId: "ser-gt" }).race_summary.total, 5);
eq("a season counts its own calendar",
  summary(bundleFor(all), { scope: "season", seasonId: "sea-oval" }).race_summary.total, 3);

// ── 2. A class narrows it to that class's calendar ────────────────────────
//
// A class runs the shared rounds plus its own — never the other class's. This
// is the case the count exists for: inside Pro, "Most Wins 3" is 3 from 4, not
// 3 from 5.

const pro = summary(bundleFor(["sea-gt"]), { scope: "season", seasonId: "sea-gt", className: "Pro" });
eq("Pro's calendar is the shared rounds plus its own", pro.race_summary.total, 4);
const am = summary(bundleFor(["sea-gt"]), { scope: "season", seasonId: "sea-gt", className: "Am" });
eq("Am's calendar is the shared rounds plus its own", am.race_summary.total, 4);
eq("neither class sees the other's special",
  pro.race_summary.total + am.race_summary.total - 8, 0);
eq("Am's own special is still upcoming", am.race_summary.upcoming, 1);
eq("Pro has nothing left on its calendar with a date", pro.race_summary.upcoming, 0);

// The same narrowing above one season, where a class is matched by NAME.
eq("a class narrows a game scope too",
  summary(bundleFor(["sea-gt"]), { scope: "game", gameId: "g-gt7", className: "Pro" }).race_summary.total, 4);

// ── 3. Total races vs the average's sample ────────────────────────────────
//
// The average is drawn from races with finalized results only, so it is always
// the smaller count — that is exactly why the card prints both rather than
// letting "races" mean two different things in one row.

eq("the league average is drawn from the races with results in",
  league.field_size.races_counted, 4);
ok("the calendar holds more races than the average could see",
  league.race_summary.total > league.field_size.races_counted);
eq("…and it averaged the fields those races drew",
  league.field_size.avg_drivers_per_race, 2.25);

eq("Pro's average sees its two shared rounds and its own special",
  pro.field_size.races_counted, 3);
eq("Am's average sees only the two shared rounds it has run",
  am.field_size.races_counted, 2);

// A scope with a calendar but nothing run yet still reports its races, and
// reports no average rather than a zero.
const upcomingOnly = indexBundle({
  scope: "league", games, series, classes, seasons: [seasons[0]],
  races: [{ id: "u1", season_id: "sea-gt", name: "Opener", date: FUTURE }],
  entries: [], results: [],
  tracks: [], teams: [], team_seasons: [], drivers: [], account_names: {}, points_templates: [],
});
const fresh = summary(upcomingOnly, { scope: "season", seasonId: "sea-gt" });
eq("a season yet to turn a wheel still counts its calendar", fresh.race_summary.total, 1);
eq("…and reports no average rather than 0.00", fresh.field_size.avg_drivers_per_race, null);

// ── 4. The card on the page ───────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
// Strip comments before searching source, so the prose explaining a rule can
// never be what satisfies the check for it.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const page = strip(read("app/records/page.js"));
ok("the scope summary is rendered above the record cards", /<ScopeSummary/.test(page));
ok("…and is handed the scoped race summary", /raceSummary=\{data\?\.race_summary\}/.test(page));
ok("…alongside the field size it already showed", /fieldSize=\{data\?\.field_size\}/.test(page));
ok("the race count card reads the scoped total", /raceSummary\?\.total/.test(page));
ok("…and labels it as the total races", /Total Races/.test(page));
ok("…named for the scope it was counted over", /\{scopeLabel\} Calendar/.test(page));
ok("the run / upcoming split is spelled out under it",
  /raceSummary\?\.completed/.test(page) && /raceSummary\?\.upcoming/.test(page));
ok("…as is how many of them the average could see", /fieldSize\?\.races_counted/.test(page));
ok("the count rides the share graphic with the average",
  /\{ label: "Races", value: totalRaces/.test(page));

// The count must come from the SCOPED stats body, never from a raw bundle the
// dropdowns don't narrow — that is what would silently print a league-wide
// number inside a class.
ok("the page never counts races off the raw bundle itself",
  !/index\.racesFor|bundle\.races/.test(page));

console.log(`recordsRaceCount: ${n} assertions passed`);
