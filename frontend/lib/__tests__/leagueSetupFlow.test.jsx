// Guard: the League Setup menu must MOUNT, and the Game → Series → Season →
// Class chain it builds must stay intact.
//
// The bug this exists to stop coming back: <CarSelectionFields> called
// parseCarEntries() to draw the cap chips under the car list, but imported only
// parseCarOptions from lib/carSelection. Nothing catches that until the
// component renders — and because all four League Setup panels (Games, Series,
// Seasons via <SeasonForm>, Classes) render that one block, the whole League
// Setup page died on mount with
//
//     ReferenceError: parseCarEntries is not defined
//
// behind the error boundary, with "Try Again" useless because the retry hit the
// same missing binding. A unit test of lib/carSelection.js could not have caught
// it: the library was correct, the component's import was not.
//
// So these are RENDER assertions. Every panel of League Setup is mounted with
// react-dom/server (see register-jsx.mjs for the JSX transform), which resolves
// every import the way the browser does and would throw on a missing one. The
// second half then walks the create flow — a Game, then a Series in it, then a
// Season, then a Class — through the same form/body helpers the page uses, and
// checks the hierarchy and its inheritance survive the round trip.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { SeasonForm } from "@/components/SeasonForm";
import {
  BLANK_CAR_SELECTION_FORM, carSelectionFormToBody, carSelectionToForm,
  resolveSignupRules, carAvailability, carEntryList,
} from "@/lib/carSelection";
import { BLANK_SEASON_FORM, seasonFormToBody, seasonToForm } from "@/lib/seasonForm";
import { BLANK_SERIES_FORM, seriesFormToBody, seriesToForm } from "@/lib/seriesForm";
import { BLANK_CLASS_FORM, classFormToBody, classToForm } from "@/lib/classForm";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// Renders and returns the markup, turning any ReferenceError from a missing
// import into a named failure rather than an unhandled throw.
function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

// Just the cap chips under the car box. Scoped, because the help text below the
// box also talks about limits — asserting on the whole markup would pass on
// prose rather than on what the box actually parsed to.
// The preview holds only <span>s, so the first </div> closes it.
function chips(html) {
  return html.match(/<div class="car-cap-preview">[\s\S]*?<\/div>/)?.[0] ?? "";
}

// ── 1. Every League Setup panel mounts ─────────────────────────────────────
//
// The four levels, rendered exactly as app/admin/page.js renders them.
const LEVELS = ["game", "series", "season", "class"];

for (const level of LEVELS) {
  const html = render(`the ${level} panel's requirement block`,
    <CarSelectionFields value={{ ...BLANK_CAR_SELECTION_FORM }} onChange={() => {}} level={level} />);
  ok(`the ${level} panel renders its car list box`, html.includes("Car Selection"));
  // Car selection, car number, the lock, and the placements gate.
  ok(`the ${level} panel renders all four requirement switches`,
    (html.match(/<select/g) || []).length === 4);
  ok(`the ${level} panel offers the placements gate`, html.includes("Placements Required"));
}

// With a list typed in, including a capped car — the exact path that threw,
// since the cap chips are what parseCarEntries was called for.
const typed = render("the car list with caps typed in",
  <CarSelectionFields level="season" onChange={() => {}}
    value={{ ...BLANK_CAR_SELECTION_FORM, car_options: "Ferrari 296 GT3 | 4\nBMW M4 GT3 | 2\nPorsche 911 GT3 R" }} />);
ok("a capped car shows its cap", chips(typed).includes("max 4") && chips(typed).includes("max 2"));
ok("an uncapped car says so", chips(typed).includes("no limit"));
ok("every typed car got a chip", (chips(typed).match(/car-cap-chip/g) || []).length === 3);
ok("the count of offered cars is shown", typed.includes("3 cars offered"));

// One car must read "1 car offered", not "1 cars offered".
const single = render("a one-car list",
  <CarSelectionFields level="class" onChange={() => {}}
    value={{ ...BLANK_CAR_SELECTION_FORM, car_options: "Ferrari 296 GT3" }} />);
ok("one car is singular", single.includes("1 car offered") && !single.includes("1 cars offered"));

// A level below one that already requires a car must say what it inherits.
const inheriting = render("a season under a series that requires a car",
  <CarSelectionFields level="season" onChange={() => {}} value={{ ...BLANK_CAR_SELECTION_FORM }}
    inherited={resolveSignupRules({
      series: { require_car_selection_mode: "on", car_options: ["Ferrari 296 GT3 | 4"] },
    })} />);
ok("the inherited requirement is named", inheriting.includes("required by the series"));
ok("the inherited car list is shown", inheriting.includes("Ferrari 296 GT3"));

// The Seasons panel renders the block through <SeasonForm>, so mount that too.
const seasonPanel = render("the Seasons panel",
  <SeasonForm value={{ ...BLANK_SEASON_FORM }} onChange={() => {}}
    gameDoc={{ require_car_number_mode: "on" }} seriesDoc={{ car_options: ["BMW M4 GT3"] }} />);
ok("the Seasons panel renders its own fields", seasonPanel.includes("Season Name"));
ok("the Seasons panel renders the requirement block", seasonPanel.includes("Require Car Selection"));
ok("the Seasons panel shows what the game already requires",
  seasonPanel.includes("required by the game"));

// ── 2. Typing in the car list is live ──────────────────────────────────────
//
// The panel is a controlled form: the textarea's onChange goes to the caller's
// state, and the cap chips are drawn from it on the next render. Drive one edit
// through that loop the way an admin typing into the box does.
let panelState = { ...BLANK_CAR_SELECTION_FORM };
const onPanelChange = update => { panelState = update(panelState); };

const before = render("the empty car list",
  <CarSelectionFields value={panelState} onChange={onPanelChange} level="series" />);
ok("an empty list draws no chips", !before.includes("car-cap-preview"));

// Exactly what the textarea's onChange hands the caller.
onPanelChange(f => ({ ...f, car_options: "Ferrari 296 GT3 | 4\nBMW M4 GT3" }));
check("the typed text lands in the caller's state",
  panelState.car_options, "Ferrari 296 GT3 | 4\nBMW M4 GT3");

const after = render("the car list after typing",
  <CarSelectionFields value={panelState} onChange={onPanelChange} level="series" />);
ok("the chips now show the typed cars",
  chips(after).includes("Ferrari 296 GT3") && chips(after).includes("BMW M4 GT3"));
ok("with the cap read as a cap, not part of the name",
  chips(after).includes("max 4") && !chips(after).includes("296 GT3 | 4"));
ok("and the uncapped one left open", chips(after).includes("no limit"));

// Switching a requirement goes through the same loop. The three-way select must
// come back showing the chosen option, not the Inherit default.
const requireSelect = html => html.match(/<select id="series_car_require"[\s\S]*?<\/select>/)?.[0] ?? "";
ok("the switch starts on Inherit",
  /<option value="" selected="">/.test(requireSelect(after)));

onPanelChange(f => ({ ...f, require_car_selection_mode: "on" }));
const switched = render("the panel after switching a requirement",
  <CarSelectionFields value={panelState} onChange={onPanelChange} level="series" />);
ok("the switch now reads Required",
  /<option value="on" selected="">Required<\/option>/.test(requireSelect(switched)));
ok("and the typed car list survived the switch", chips(switched).includes("max 4"));

// ── 3. The create flow: Game → Series → Season → Class ─────────────────────
//
// Each step builds the body the panel POSTs, with the SAME call the page makes
// (see the four <form onSubmit> handlers in app/admin/page.js), then reads it
// back the way reopening the panel does.

// Step 1 — a game, requiring a car from a league-wide list.
const gameForm = {
  ...BLANK_CAR_SELECTION_FORM,
  name: "Le Mans Ultimate", logo_url: "",
  require_car_selection_mode: "on",
  require_car_number_mode: "on",
  car_options: "Ferrari 296 GT3 | 4\nBMW M4 GT3 | 2\nPorsche 911 GT3 R",
  car_selection_note: "Lock in by Friday.",
};
// gameFormToBody, as app/admin/page.js defines it.
const gameBody = { ...gameForm, ...carSelectionFormToBody(gameForm) };
const game = { id: "g1", ...gameBody };
check("the game keeps its name", game.name, "Le Mans Ultimate");
check("the game stores its car list with the caps intact",
  game.car_options, ["Ferrari 296 GT3 | 4", "BMW M4 GT3 | 2", "Porsche 911 GT3 R"]);
check("the game's switches are stored as modes",
  [game.require_car_selection_mode, game.require_car_number_mode], ["on", "on"]);
check("and kept in step with the old booleans",
  [game.require_car_selection, game.require_car_number], [true, true]);
check("reopening the game shows what was typed",
  carSelectionToForm(game).car_options, gameForm.car_options);

// Step 2 — a series in that game, inheriting everything. The page attaches
// game_id from the Game selected above, which is what nests it.
const seriesForm = { ...BLANK_SERIES_FORM, name: "GT3 Championship" };
const series = { id: "s1", ...seriesFormToBody(seriesForm), game_id: game.id };
check("the series keeps its name", series.name, "GT3 Championship");
check("the series belongs to the game", series.game_id, game.id);
ok("a brand-new series overrides nothing",
  !series.require_car_selection_mode && !series.require_car_number_mode);
check("reopening the series shows it inheriting",
  seriesToForm(series).require_car_selection_mode, "");

// Step 3 — a season in that series, which turns the number requirement OFF for
// itself. The page attaches both series_id and game_id.
const seasonForm = { ...BLANK_SEASON_FORM, name: "Season 3", require_car_number_mode: "off" };
const season = { id: "se1", ...seasonFormToBody(seasonForm), series_id: series.id, game_id: game.id };
check("the season keeps its name", season.name, "Season 3");
check("the season belongs to the series", season.series_id, series.id);
check("and to the game", season.game_id, game.id);
check("the season's override is stored", season.require_car_number_mode, "off");
check("and the boolean is false for it", season.require_car_number, false);
check("reopening the season shows the override",
  seasonToForm(season).require_car_number_mode, "off");

// Step 4 — a class in that season, running its own machinery. The page passes
// the class count as the fallback sort order and attaches season_id.
const classForm = { ...BLANK_CLASS_FORM, name: "Pro-Am", car_options: "Mercedes-AMG GT3 | 1" };
const cls = { id: "c1", ...classFormToBody(classForm, 0, { banger: false }), season_id: season.id };
check("the class keeps its name", cls.name, "Pro-Am");
check("the class belongs to the season", cls.season_id, season.id);
check("the class is ordered", cls.sort_order, 0);
check("the class stores its own list", cls.car_options, ["Mercedes-AMG GT3 | 1"]);
check("reopening the class shows its list", classToForm(cls).car_options, "Mercedes-AMG GT3 | 1");

// ── 4. The hierarchy resolves ──────────────────────────────────────────────
//
// Most specific level with an opinion wins, at every depth.
const atSeries = resolveSignupRules({ game, series });
check("the series inherits the game's car requirement", atSeries.require_car, true);
check("named as the game's", atSeries.require_car_from, "game");
check("and inherits the game's list", atSeries.car_options,
  ["Ferrari 296 GT3", "BMW M4 GT3", "Porsche 911 GT3 R"]);
check("and the game's note", atSeries.note, "Lock in by Friday.");

const atSeason = resolveSignupRules({ game, series, season });
check("the season still requires a car", atSeason.require_car, true);
check("but its own 'off' beats the game's 'on' for numbers", atSeason.require_number, false);
check("with nobody credited for a requirement that isn't in force",
  atSeason.require_number_from, null);

const atClass = resolveSignupRules({ game, series, season, cls });
check("the class runs its own car list", atClass.car_options, ["Mercedes-AMG GT3"]);
check("credited to the class", atClass.car.options_from, "class");
check("the class still inherits the game's car requirement", atClass.require_car, true);
check("and the season's 'off' for numbers", atClass.require_number, false);
check("the caps ride with the list that won",
  atClass.car_entries, [{ name: "Mercedes-AMG GT3", max: 1 }]);

// ── 5. The caps an admin typed actually cap ────────────────────────────────
const entries = carEntryList(game);
check("the game's caps survived the round trip",
  entries, [
    { name: "Ferrari 296 GT3", max: 4 },
    { name: "BMW M4 GT3", max: 2 },
    { name: "Porsche 911 GT3 R", max: null },
  ]);
const availability = carAvailability(entries, [
  { car: "Ferrari 296 GT3" }, { car: "Ferrari 296 GT3" },
  { selected_car: "BMW M4 GT3" }, { selected_car: "BMW M4 GT3" },
]);
check("a part-full car stays open", availability[0].full, false);
check("with its remaining seats counted", availability[0].left, 2);
check("a full car closes", availability[1].full, true);
check("an uncapped car never closes", availability[2].full, false);

// ── 6. Editing a level doesn't quietly drop its caps ───────────────────────
//
// Reopening a panel and saving it again must write back what was stored.
const reopened = carSelectionToForm(game);
const resaved = carSelectionFormToBody({ ...reopened, car_selection_note: "Lock in by Saturday." });
check("the caps survive an edit that didn't touch them",
  resaved.car_options, game.car_options);
check("and the edit itself lands", resaved.car_selection_note, "Lock in by Saturday.");

console.log(`leagueSetupFlow: ${n} assertions passed`);
