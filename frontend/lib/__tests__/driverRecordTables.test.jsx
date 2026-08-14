// Guard: the three tables on a driver's profile must MOUNT, and each must come
// up in the order somebody opening a profile expects — the history newest
// first, the venues by wins, the games by starts — with every column offering
// its own sort.
//
// Rendered with react-dom/server (see register-jsx.mjs), which resolves imports
// exactly as the browser does: a bad binding in one of these takes the whole
// profile down behind the error boundary, and a driver profile is the page the
// league links people to.
//
// What a static render can't do is click, so the sorted ORDER asserted here is
// each table's opening one. The clicking itself is useSortable, shared with the
// Stats and Skill Ratings leaderboards.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ByGame, PerTrackStats, RaceHistory } from "@/components/DriverRecord";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}`); };

function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

// Everything between the table's <tbody> tags, row by row, as plain text — the
// order the reader actually sees.
function bodyRows(html) {
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  return body.split("<tr").slice(1).map(row =>
    // Drop what's left of the row's own opening tag, then every other tag.
    row.replace(/^[^>]*>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

const countSortable = html => (html.match(/th class="sortable/g) || []).length;

// ── Race History ────────────────────────────────────────────────────────────
// Three races across two seasons, deliberately handed over out of order.
const race = (over, i) => ({
  race_id: `r${i}`, race_name: `Race ${i}`, session: "Feature", round_number: i,
  track_id: `t${i}`, track_name: `Track ${i}`, season_id: "sea-1", season_name: "Season 1",
  series_name: "Phoenix GT", game_id: "g1", game_name: "GT7", class_name: null,
  finish_pos: 5, start_pos: 5, laps: 40, laps_led: 0, points: 50, status: "finished",
  session_type: "feature", ...over,
});
const history = [
  race({ race_id: "mid", race_name: "Mid Race", date: "2026-03-01", finish_pos: 1, start_pos: 4, points: 100 }, 2),
  race({ race_id: "old", race_name: "Old Race", date: "2025-11-20", finish_pos: 3, start_pos: 1, points: 80 }, 1),
  race({ race_id: "new", race_name: "New Race", date: "2026-07-04", finish_pos: 9, start_pos: 9, points: 20 }, 3),
];

const historyHtml = render("RaceHistory", <RaceHistory rows={history} />);

eq("the history opens newest first",
  bodyRows(historyHtml).map(r => r.split(" · ")[0].replace("🏁 ", "").trim().split("  ")[0]),
  ["New Race", "Mid Race", "Old Race"]);

// Every column heading is a sort target: Race, Date, Season, Track, Start,
// Finish, Laps, Led, Points.
eq("every race column sorts", countSortable(historyHtml), 9);
ok("the date has a column of its own", /Date/.test(historyHtml) && /Jul 4, 2026/.test(historyHtml));
ok("the newest-first arrow is on Date", /Date\s*▾/.test(historyHtml.replace(/<[^>]+>/g, "")));
ok("the race links through to its results", historyHtml.includes('href="/races/new"'));
ok("the link carries a checkered flag", /🏁 New Race/.test(historyHtml.replace(/<[^>]+>/g, "")));
ok("the season column names series and season", historyHtml.includes("Phoenix GT · Season 1"));
ok("an empty history says so", render("empty RaceHistory", <RaceHistory rows={[]} />).includes("No races recorded yet"));

// ── Per Track Stats ─────────────────────────────────────────────────────────
const track = (name, stats) => ({
  track_id: name.toLowerCase(), track_name: name, track_location: "Somewhere",
  stats: { starts: 0, wins: 0, podiums: 0, top5: 0, poles: 0, best_laps: 0, avg_start: 5, avg_finish: 5, laps_led: 0, ...stats },
});
const tracksHtml = render("PerTrackStats", <PerTrackStats rows={[
  track("Bristol", { starts: 4, wins: 1 }),
  track("Daytona", { starts: 9, wins: 3, avg_finish: 2.5 }),
  track("Eldora", { starts: 2, wins: 0 }),
]} />);

eq("venues open on wins, most first",
  bodyRows(tracksHtml).map(r => r.split(" ")[0]),
  ["Daytona", "Bristol", "Eldora"]);
eq("every venue column sorts", countSortable(tracksHtml), 10);
ok("a venue's average finish is formatted, not raw", tracksHtml.includes("2.50"));
ok("no venues yet says so", render("empty PerTrackStats", <PerTrackStats rows={[]} />).includes("No track results recorded yet"));

// ── By Game ─────────────────────────────────────────────────────────────────
const game = (name, stats) => ({
  game_id: name.toLowerCase(), game_name: name, game_logo_url: null,
  stats: { starts: 0, wins: 0, podiums: 0, top5: 0, poles: 0, titles: 0, points: 0, avg_finish: 5, ...stats },
});
const gamesHtml = render("ByGame", <ByGame rows={[
  game("GT7", { starts: 3, wins: 1, points: 300 }),
  game("iRacing", { starts: 12, wins: 2, points: 900, titles: 1 }),
]} />);

eq("games open on starts, most first", bodyRows(gamesHtml).map(r => r.split(" ")[0]), ["iRacing", "GT7"]);
eq("every game column sorts", countSortable(gamesHtml), 9);

console.log(`driverRecordTables: ${n} assertions passed`);
