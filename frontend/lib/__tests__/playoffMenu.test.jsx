// Guard: the Playoffs menu must MOUNT, and what it saves must come back.
//
// Same reason leagueSetupFlow.test.jsx exists. The playoff feature adds a
// dialog, a panel and a lib that four screens import, and a missing or
// misspelled import in any of them takes out the whole League Setup page or the
// whole Standings page behind an error boundary — which no unit test of
// lib/playoffs.js can catch, because the library is fine and the component's
// import is not.
//
// So these are RENDER assertions: every new piece is mounted with
// react-dom/server, which resolves imports exactly the way the browser does.
// The last section then drives a season through the form helpers the way the
// Seasons panel does, because a playoff format that doesn't survive a save is
// an evening of the league's time thrown away.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SeasonForm } from "@/components/SeasonForm";
import { PlayoffSettingsModal } from "@/components/PlayoffSettingsModal";
import { PlayoffPanel } from "@/components/PlayoffPanel";
import { BLANK_SEASON_FORM, seasonFormToBody, seasonToForm } from "@/lib/seasonForm";
import { applyFormatPreset, buildPlayoffs, normalizePlayoffConfig } from "@/lib/playoffs";
import { resolveSeasonConfig } from "@/lib/standings";

let n = 0;
const ok = (label, cond) => { n += 1; assert.ok(cond, label); };
const check = (label, actual, expected) => { n += 1; assert.deepEqual(actual, expected, label); };

function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

// ── 1. The season form, with and without the tick ──────────────────────────
const off = render("the Seasons panel with playoffs off",
  <SeasonForm value={{ ...BLANK_SEASON_FORM }} onChange={() => {}} />);
ok("the Playoffs tick is offered on every season", off.includes("Playoffs"));
ok("but nothing else about playoffs is on screen until it's ticked",
  !off.includes("Playoff Format"));

const on = render("the Seasons panel with playoffs on",
  <SeasonForm value={{ ...BLANK_SEASON_FORM, playoffs_enabled: true }} onChange={() => {}} />);
ok("ticking it offers the menu", on.includes("Playoff Format"));
ok("and names the format the season is set to", on.includes("Elimination Playoffs"));
// The summary line: a format has to be readable without opening the menu.
ok("with the shape of it spelled out", on.includes("16 drivers"));

// A format the calendar can't race is flagged where the tick is, not only
// inside the dialog — an admin who never opens the menu still needs telling.
const short = render("a ladder longer than the calendar",
  <SeasonForm onChange={() => {}}
    races={[{ id: "r1", round_number: 1 }, { id: "r2", round_number: 2 }]}
    value={{
      ...BLANK_SEASON_FORM,
      playoffs_enabled: true,
      playoff_config: { ...normalizePlayoffConfig(null), regular_rounds: 1 },
    }} />);
ok("the season form warns about a format that can't be raced", short.includes("⚠"));

// ── 2. The menu itself ─────────────────────────────────────────────────────
//
// <Modal> renders nothing until it has mounted in a browser (it portals to
// document.body — see components/Modal.jsx), so on the server this is a mount
// check of the dialog's own body: its state, its derived config, its handlers
// and every import behind them.
const menu = render("the playoff menu",
  <PlayoffSettingsModal value={normalizePlayoffConfig(null)} onChange={() => {}} onClose={() => {}} />);
check("a dialog renders nothing before it mounts, as every dialog does", menu, "");

// ── 3. The panel on Standings ──────────────────────────────────────────────
const pointsConfig = resolveSeasonConfig({
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70 }),
  qual_points: JSON.stringify({ 1: 10 }),
  bonus_points: {},
}, null);
const entries = ["e1", "e2", "e3", "e4"].map(id => ({ id, name: id.toUpperCase() }));
const races = Array.from({ length: 4 }, (_, i) => ({ id: `r${i + 1}`, name: `Round ${i + 1}`, round_number: i + 1 }));
const finish = (raceId, order) =>
  order.map((entry_id, i) => ({ race_id: raceId, entry_id, session: "Race", session_type: "race", finish_pos: i + 1 }));
const results = [
  ...finish("r1", ["e1", "e2", "e3", "e4"]),
  ...finish("r2", ["e2", "e1", "e3", "e4"]),
  ...finish("r3", ["e3", "e1", "e2", "e4"]),
  ...finish("r4", ["e2", "e1", "e3", "e4"]),
];
const season = {
  id: "s1", name: "Season 1", playoffs_enabled: true,
  playoff_config: {
    regular_rounds: 2,
    field_size: 3,
    qualify_mode: "points",
    seed_mode: "reset_zero",
    rounds: [
      { name: "Semi-Final", races: 1, advance: 2, reset_base: 0 },
      { name: "The Final", races: 1, advance: 1, reset_base: 0 },
    ],
    finale_mode: "points",
    finale_reset: true,
    regular_season_champion: true,
    notes: "Voted in at the January meeting.",
  },
};
const playoffs = buildPlayoffs({ season, races, results, entries, pointsConfig });

check("nothing is rendered for a season without a playoff",
  render("a season with no playoff", <PlayoffPanel playoffs={null} />), "");

const panel = render("the Playoffs panel", <PlayoffPanel playoffs={playoffs} />);
ok("the panel names itself", panel.includes("Playoffs"));
ok("every round of the ladder is on it",
  panel.includes("Semi-Final") && panel.includes("The Final"));
ok("the league's own note is quoted back", panel.includes("Voted in at the January meeting"));
ok("the regular season champion is named", panel.includes("Regular Season Champion"));
ok("the field is one click away once the racing has started", panel.includes("The Field"));

// Before a playoff race is run the field IS the story, so the projection — and
// the cutline through it — is open without being asked for.
const projected = render("the panel before the playoff starts", <PlayoffPanel playoffs={buildPlayoffs({
  season, races, entries, pointsConfig,
  results: results.filter(r => ["r1", "r2"].includes(r.race_id)),
})} />);
ok("the seeded field is listed with what it starts on", projected.includes("Starts On"));
ok("and the drivers who missed the cut are under a cutline",
  projected.includes("cutline") && projected.includes("E4"));

// ── 4. A format survives a save ────────────────────────────────────────────
//
// The round trip an admin actually does: tick it, pick a format, save, come
// back and edit the season again.
const chosen = applyFormatPreset(normalizePlayoffConfig(null), "chase_2004");
const body = seasonFormToBody({ ...BLANK_SEASON_FORM, name: "S1", playoffs_enabled: true, playoff_config: chosen });
check("the tick is saved", body.playoffs_enabled, true);
check("with the format", body.playoff_config.format, "chase_2004");
check("its field", body.playoff_config.field_size, 10);
check("its seeding", [body.playoff_config.seed_base, body.playoff_config.seed_gap], [5050, 5]);
check("and its rounds", body.playoff_config.rounds.length, 1);

const reopened = seasonToForm({ ...body, id: "s1" });
check("re-opening the season finds the tick where it was left", reopened.playoffs_enabled, true);
check("and the format", reopened.playoff_config.format, "chase_2004");
check("and every number in it", reopened.playoff_config, body.playoff_config);

// Numbers typed into the menu are strings; they must be rules by the time
// they're stored, or the bracket would compare "12" against 8.
const typed = seasonFormToBody({
  ...BLANK_SEASON_FORM, name: "S2", playoffs_enabled: true,
  playoff_config: { ...normalizePlayoffConfig(null), field_size: "12", seed_base: "2000", regular_rounds: "26" },
});
check("a typed field size is stored as a number", typed.playoff_config.field_size, 12);
check("so is the reset base", typed.playoff_config.seed_base, 2000);
check("and the cutoff", typed.playoff_config.regular_rounds, 26);

// Untick it and the format is kept, not thrown away — a league that skips
// playoffs for one season gets its rules back the year after.
const parked = seasonFormToBody({
  ...BLANK_SEASON_FORM, name: "S3", playoffs_enabled: false, playoff_config: chosen,
});
check("unticking playoffs turns them off", parked.playoffs_enabled, false);
check("but keeps the format on the shelf", parked.playoff_config.format, "chase_2004");

console.log(`playoffMenu: ${n} checks passed`);
