// "Placements Required": the tiers that are RACED for rather than joined.
//
// A league that sorts its field by pace has one tier that must not be walked
// into off the Dashboard — the Gold Series, the Pro class. Ticking Placements
// Required on a series, season or class is what says so, and it has to hold
// three promises at once:
//
//   1. it CASCADES like every other sign-up requirement — a season that
//      requires placements covers every class in it, and the most specific
//      level with an opinion still wins, so one class can be exempted;
//   2. the player is TOLD, on the form, before they type anything, and the
//      button stops promising a roster place it can't hand out;
//   3. the admin is REMINDED, on the queue row, that this driver has to go
//      through Time Trials before their spot is final.
//
// And one promise that matters more than any of them: **a series that doesn't
// require placements must behave exactly as it did before this existed.** The
// gate is a new three-state switch on the same chain as the car and number
// requirements, so the way it fails would be silent — every league in the app
// suddenly gated, or every gated league silently open. Section 1 and section 2
// are what stand between those two.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { SignupForm } from "@/components/SignupForm";
import {
  AWAITING_PLACEMENT_BADGE, BLANK_CAR_SELECTION_FORM, PLACEMENTS_SUBMIT_LABEL,
  carSelectionFormToBody, carSelectionToForm, classDefinesSignupRules,
  missingSignupFields, resolveSignupRules,
} from "@/lib/carSelection";
import { BLANK_SEASON_FORM, seasonFormToBody, seasonToForm } from "@/lib/seasonForm";
import { BLANK_SERIES_FORM, seriesFormToBody, seriesToForm } from "@/lib/seriesForm";
import { BLANK_CLASS_FORM, classFormToBody, classToForm } from "@/lib/classForm";
import { awaitingPlacement } from "@/lib/signupQueue";
import { classesAskMore, seasonChips, seasonHasPlacements } from "@/lib/signupFlow";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}
function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

const gate = scope => resolveSignupRules(scope).require_placements;

// ── 1. Nothing that existed before this is gated ───────────────────────────
//
// The failure that would matter most: every league in the app waking up with
// its sign-ups behind a placement night nobody runs.
check("an empty league gates nothing", gate({}), false);
check("a fully-configured league that never heard of placements gates nothing",
  gate({
    game: { name: "iRacing", requires_iracing_id: true },
    series: { require_car_selection_mode: "on", car_options: ["GT3"] },
    season: { require_car_number_mode: "on", name: "Season 4" },
    cls: { name: "Pro", car: "GT3" },
  }), false);
// A stored `false` has never been an admin saying "off" — it's a field that was
// written blank — so it must not read as an opinion either way.
check("a bare false is 'never configured', not 'off'",
  gate({ series: { require_placements: true }, season: { require_placements: false } }), true);

// And the rest of the sign-up rules are untouched by the new switch.
const gated = resolveSignupRules({
  series: { require_placements_mode: "on", require_car_selection_mode: "on", car_options: ["GT3", "GT4"] },
  season: { require_car_number_mode: "on" },
});
check("a gated series still requires its car", gated.require_car, true);
check("a gated series still requires its number", gated.require_number, true);
check("a gated series still offers its cars", gated.car_options, ["GT3", "GT4"]);
check("the gate adds no new field to fill in",
  missingSignupFields(gated, { number: "07", car: "GT3" }), []);
// The gate is not a question on the form, so it must not make a season that
// asks for nothing look like one that asks for something.
check("the gate alone asks a player for nothing",
  resolveSignupRules({ series: { require_placements_mode: "on" } }).asksAnything, false);

// ── 2. It cascades on the one chain everything else uses ───────────────────
check("a gated game covers the whole game",
  gate({ game: { require_placements_mode: "on" }, series: {}, season: {}, cls: {} }), true);
check("a gated series covers its seasons",
  gate({ series: { require_placements_mode: "on" }, season: { name: "Season 4" } }), true);
check("a gated season covers its classes",
  gate({ series: {}, season: { require_placements_mode: "on" }, cls: { name: "Pro" } }), true);
check("a gated class gates only itself",
  gate({ season: {}, cls: { require_placements_mode: "on" } }), true);
check("...and its ungated sibling stays open",
  gate({ season: {}, cls: { name: "Rookie" } }), false);
// The half that makes "most specific wins" true rather than aspirational: a
// league whose Gold Series is earned but whose Rookie class inside it is not.
check("a class can be exempted from its series' gate",
  gate({
    series: { require_placements_mode: "on" },
    season: {},
    cls: { require_placements_mode: "off" },
  }), false);
check("and the season it sits in is still gated",
  gate({ series: { require_placements_mode: "on" }, season: {} }), true);

// Which level decided, so League Setup can say so instead of leaving an admin
// to guess where a gate they didn't set came from.
check("the deciding level is named",
  resolveSignupRules({ series: { require_placements_mode: "on" }, season: {} })
    .require_placements_from, "series");
check("nothing is named when nothing gates", resolveSignupRules({}).require_placements_from, null);

// A class carrying only a gate still counts as a class that changes the form,
// which is what makes picking it re-render the warning.
ok("a class that only sets the gate is a class that asks more",
  classDefinesSignupRules({ require_placements_mode: "on" }));
ok("a class that sets nothing asks no more", !classDefinesSignupRules({ name: "Rookie" }));

// ── 3. League Setup saves it, and reads it back ────────────────────────────
//
// Through the real form helpers each panel uses, at all three levels the
// request named — a switch that doesn't survive its own round trip reads as an
// admin's setting silently reverting.
const seriesDoc = seriesFormToBody({ ...BLANK_SERIES_FORM, name: "Gold", require_placements_mode: "on" });
check("the series stores the mode", seriesDoc.require_placements_mode, "on");
check("and the boolean beside it", seriesDoc.require_placements, true);
check("and it reopens as set", seriesToForm(seriesDoc).require_placements_mode, "on");
check("and it gates", gate({ series: seriesDoc }), true);

const seasonDoc = seasonFormToBody({ ...BLANK_SEASON_FORM, name: "Season 4", require_placements_mode: "on" });
check("the season stores the mode", seasonDoc.require_placements_mode, "on");
check("and it reopens as set", seasonToForm(seasonDoc).require_placements_mode, "on");
check("and it gates", gate({ season: seasonDoc }), true);

const classDoc = classFormToBody({ ...BLANK_CLASS_FORM, name: "Pro", require_placements_mode: "on" });
check("the class stores the mode", classDoc.require_placements_mode, "on");
check("and it reopens as set", classToForm(classDoc).require_placements_mode, "on");
check("and it gates", gate({ cls: classDoc }), true);

// The exemption has to round-trip too, or a class switched off would come back
// as "inherit" and be gated again by its series.
const exempt = classFormToBody({ ...BLANK_CLASS_FORM, name: "Rookie", require_placements_mode: "off" });
check("an exempted class stores the override", exempt.require_placements_mode, "off");
check("its boolean is false", exempt.require_placements, false);
check("it reopens as an override, not as inherit", classToForm(exempt).require_placements_mode, "off");
check("and it still overrides its gated series",
  gate({ series: seriesDoc, season: {}, cls: exempt }), false);

// A level nobody touched saves as "inherit" and gates nothing.
check("an untouched season saves no opinion",
  seasonFormToBody({ ...BLANK_SEASON_FORM, name: "Season 5" }).require_placements_mode, "");
check("and gates nothing on its own",
  gate({ season: seasonFormToBody({ ...BLANK_SEASON_FORM, name: "Season 5" }) }), false);

// ── 4. The League Setup switch renders, and says what Inherit means ────────
const panel = render("the Classes panel under a gated series",
  <CarSelectionFields level="class" onChange={() => {}} value={{ ...BLANK_CAR_SELECTION_FORM }}
    inherited={resolveSignupRules({ series: { require_placements_mode: "on" } })} />);
ok("the gate is offered", panel.includes("Placements Required"));
ok("an inherited gate names the level it came from", panel.includes("required by the series"));
ok("the admin is told what the player will see",
  panel.includes("Register for Placements") && panel.includes("Awaiting Placement"));

// ── 5. The player is told, before they type anything ───────────────────────
const seasonRow = (rules, extra = {}) => ({
  season_id: "s1", season_name: "Season 4", series_name: "Gold Series",
  rules, classes: [], roster: [], pending: [], ...extra,
});
const driver = { id: "d1", name: "Ana", aliases: [{ label: "Discord Name", value: "ana" }] };

const gatedForm = render("the sign-up form for a gated series",
  <SignupForm season={seasonRow({ require_placements: true, car_options: [] })}
    driver={driver} onDone={() => {}} />);
ok("the warning is on the form", gatedForm.includes("Placements Required"));
ok("it says what submitting actually does",
  gatedForm.includes("registers your intent to qualify"));
ok("the button says what pressing it does", gatedForm.includes(PLACEMENTS_SUBMIT_LABEL));
ok("and never promises a sign-up", !gatedForm.includes("Submit Sign Up"));

// The control case, and the one that matters most: an ordinary series is
// untouched, warning and all.
const plainForm = render("the sign-up form for an ordinary series",
  <SignupForm season={seasonRow({ require_placements: false, car_options: [] })}
    driver={driver} onDone={() => {}} />);
ok("an ordinary series still says Submit Sign Up", plainForm.includes("Submit Sign Up"));
ok("and carries no placement warning", !plainForm.includes("Placements Required"));
ok("and still says an admin reviews it",
  plainForm.includes("Sign-ups are reviewed by a league admin"));

// A season whose PRO class is gated is not itself gated: the form opens on
// "decide later", so it must not warn until that class is picked.
const classGated = render("a season with one gated class, nothing picked",
  <SignupForm driver={driver} onDone={() => {}}
    season={seasonRow({ require_placements: false, car_options: [] }, {
      classes: [{ id: "pro", name: "Pro" }, { id: "rookie", name: "Rookie" }],
      class_rules: { pro: { require_placements: true, car_options: [] } },
    })} />);
ok("no warning before a gated class is chosen", !classGated.includes("Placements Required"));
ok("the button is the ordinary one", classGated.includes("Submit Sign Up"));
// ...and the rules the form switches to when it IS picked do gate.
check("the gated class's own rules gate",
  gate({ season: {}, cls: { require_placements_mode: "on" } }), true);

// ── 6. The admin queue flags it, and only where there's someone to place ───
ok("a gated sign-up is awaiting placement",
  awaitingPlacement({ kind: "signup", placements_required: true }));
ok("a row written before the gate existed is not",
  !awaitingPlacement({ kind: "signup" }));
ok("an ungated sign-up is not", !awaitingPlacement({ kind: "signup", placements_required: false }));
// A number change is a driver already racing — there is nothing to place them
// into, so the flag must never appear on one however the series is set.
ok("a number change is never awaiting placement",
  !awaitingPlacement({ kind: "number_change", placements_required: true }));
ok("a missing row doesn't throw", !awaitingPlacement(undefined));
ok("the badge is worded once, for both sides", AWAITING_PLACEMENT_BADGE === "Awaiting Placement");

// ── 7. The Sign-ups screen says so on the card ─────────────────────────────
//
// Before the form is even opened: two series described identically otherwise
// differ in the one way a player cares about most.
const CHIP = "⏱ Placements required";
ok("a gated season is chipped",
  seasonChips(seasonRow({ require_placements: true })).includes(CHIP));
ok("an ordinary season is not",
  !seasonChips(seasonRow({ require_placements: false })).includes(CHIP));
// A season whose Pro class alone is gated still has to say so up front — the
// gate would otherwise appear out of nowhere halfway through the form.
ok("a season with one gated class is chipped",
  seasonChips(seasonRow({ require_placements: false }, {
    class_rules: { pro: { require_placements: true } },
  })).includes(CHIP));
ok("seasonHasPlacements reads the season itself",
  seasonHasPlacements(seasonRow({ require_placements: true })));
ok("and its classes", seasonHasPlacements(seasonRow({}, {
  class_rules: { pro: { require_placements: true } },
})));
ok("and answers false for a plain season", !seasonHasPlacements(seasonRow({})));
ok("a missing season doesn't throw", !seasonHasPlacements(undefined));
// The "some classes ask for a bit more when you pick them" warning covers the
// gate too, since picking one is what makes the warning appear.
ok("a gated class counts as asking more", classesAskMore({
  rules: { require_placements: false, car_options: [] },
  class_rules: { pro: { require_placements: true, car_options: [] } },
}));
ok("a class gated identically to its season asks no more", !classesAskMore({
  rules: { require_placements: true, car_options: [] },
  class_rules: { pro: { require_placements: true, car_options: [] } },
}));

console.log(`placementsGate: ${n} assertions passed`);
