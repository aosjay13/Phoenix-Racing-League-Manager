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
import { AwaitingPlacements } from "@/components/AwaitingPlacements";
import { CarSelectionFields } from "@/components/CarSelectionFields";
import { SignupForm } from "@/components/SignupForm";
import {
  AWAITING_PLACEMENT_BADGE, BLANK_CAR_SELECTION_FORM, CAR_SELECTION_TEXT_FIELDS,
  PLACEMENTS_SUBMIT_LABEL, carSelectionFormToBody, carSelectionToForm,
  classDefinesSignupRules, missingSignupFields, resolveSignupRules,
  signupRequirementFieldSpecs,
} from "@/lib/carSelection";
import { BLANK_SEASON_FORM, seasonFormToBody, seasonToForm } from "@/lib/seasonForm";
import { BLANK_SERIES_FORM, seriesFormToBody, seriesToForm } from "@/lib/seriesForm";
import { BLANK_CLASS_FORM, classFormToBody, classToForm } from "@/lib/classForm";
import { SPECS } from "@/lib/entityApi";
import { placementsRequiredFor } from "@/lib/carSelectionServer";
import {
  APPROVED, APPROVED_FOR_PLACEMENTS, OPEN_STATUSES, signupIsPlacementGated, isAwaitingPlacement,
  numberClaimed, pendingForSeason, rosterWithPending, signupApprovalPlan,
} from "@/lib/signupQueue";
import { messageBody, messageKind, messageTitle, messageTone } from "@/lib/messages";
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

// ── 3b. …and the storage layer actually accepts it ─────────────────────────
//
// The bug this section exists to stop coming back, which shipped and broke the
// whole feature: lib/entityApi.js writes ONLY the fields its spec names, and it
// kept its own copy of the switch list. `require_placements` wasn't on that
// copy, so League Setup saved a tick that was thrown away in transit — control
// rendered, form round-tripped, resolver correct, build clean, nothing thrown,
// and the setting simply never persisted.
//
// So: every key the League Setup body writes must be one the REAL spec accepts
// — `SPECS` imported from lib/entityApi.js itself, not a restatement of it. The
// four levels are checked separately, because the bug was a missing entry in a
// list that three of them happened to share.
const body = carSelectionFormToBody(BLANK_CAR_SELECTION_FORM);
for (const level of ["games", "series", "seasons", "classes"]) {
  const accepted = SPECS[level].fields;
  const dropped = Object.keys(body).filter(key => !(key in accepted));
  check(`every field League Setup submits is one ${level} will store`, dropped, []);
  ok(`${level} stores the gate`, "require_placements" in accepted);
  ok(`${level} stores the gate's mode`, "require_placements_mode" in accepted);
  // The two halves need the right coercion, or "off" reads back as "never
  // configured" and a class can't be exempted from its series.
  check(`${level} keeps the gate a real boolean, so an explicit false survives`,
    accepted.require_placements.bool, true);
  check(`${level} defaults an unconfigured gate to inherit`,
    accepted.require_placements_mode.default, "");
}

// And the spec the storage layer is built from is the one this library owns —
// the copy that drifted is gone, so a fifth switch can't repeat the failure.
const specs = signupRequirementFieldSpecs();
check("the storage spec covers every switch, both halves",
  Object.keys(specs).sort(),
  ["car_selection_locked", "car_selection_locked_mode",
    "require_car_number", "require_car_number_mode",
    "require_car_selection", "require_car_selection_mode",
    "require_placements", "require_placements_mode"].sort());
check("and nothing the body writes falls outside it",
  Object.keys(body).filter(k => !(k in specs) && !CAR_SELECTION_TEXT_FIELDS.includes(k)), []);

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
  signupIsPlacementGated({ kind: "signup", placements_required: true }));
ok("a row written before the gate existed is not",
  !signupIsPlacementGated({ kind: "signup" }));
ok("an ungated sign-up is not", !signupIsPlacementGated({ kind: "signup", placements_required: false }));
// A number change is a driver already racing — there is nothing to place them
// into, so the flag must never appear on one however the series is set.
ok("a number change is never awaiting placement",
  !signupIsPlacementGated({ kind: "number_change", placements_required: true }));
ok("a missing row doesn't throw", !signupIsPlacementGated(undefined));
ok("the badge is worded once, for both sides", AWAITING_PLACEMENT_BADGE === "Awaiting Placement");

// ── 6b. …and the queue resolves the gate LIVE, not off the stamp ───────────
//
// The reason the admin queue re-resolves instead of trusting what the request
// was stamped with: an admin who ticks the switch this morning needs the people
// who signed up for that series last week flagged too, and those rows carry a
// stamped `false`. They are precisely the ones that would otherwise be approved
// straight past the gate.
const ctx = (over = {}) => ({ season: {}, series: {}, game: null, classes: [], ...over });
const loads = [];
const loader = map => async id => { loads.push(id); return map[id] ?? null; };

const live = await placementsRequiredFor(
  [
    // Signed up before the gate existed — stamped false, gated now.
    { id: "old", season_id: "gold", class_ids: [], placements_required: false },
    // Signed up after — agrees either way.
    { id: "new", season_id: "gold", class_ids: [], placements_required: true },
    // A different, ungated series.
    { id: "rookie", season_id: "feeder", class_ids: [], placements_required: false },
  ],
  { loadContext: loader({
    gold: ctx({ series: { require_placements_mode: "on" } }),
    feeder: ctx(),
  }) });
check("a row stamped before the gate was switched on is flagged now", live.old, true);
check("a row stamped after it agrees", live.new, true);
check("a row in an ungated series is not flagged", live.rookie, false);
// The mirror case: a gate switched OFF must stop flagging rows stamped true,
// or the queue nags an admin about a session they've decided not to run.
const relaxed = await placementsRequiredFor(
  [{ id: "stale", season_id: "gold", class_ids: [], placements_required: true }],
  { loadContext: loader({ gold: ctx() }) });
check("a gate switched off stops flagging", relaxed.stale, false);

// One read per DISTINCT season — a league-wide queue is mostly several people
// waiting on the same handful of seasons, and this runs on every queue load.
loads.length = 0;
await placementsRequiredFor(
  [
    { id: "a", season_id: "gold", class_ids: [] },
    { id: "b", season_id: "gold", class_ids: [] },
    { id: "c", season_id: "feeder", class_ids: [] },
  ],
  { loadContext: loader({ gold: ctx(), feeder: ctx() }) });
check("one season load per distinct season, not per row", loads.sort(), ["feeder", "gold"]);

// The row is resolved against the class it asked for — the FIRST one, which is
// what the submission resolved against when it stamped the row.
const classes = [
  { id: "pro", name: "Pro", require_placements_mode: "on" },
  { id: "rookie", name: "Rookie" },
];
const perClass = await placementsRequiredFor(
  [
    { id: "p", season_id: "s", class_ids: ["pro"] },
    { id: "r", season_id: "s", class_ids: ["rookie"] },
    { id: "none", season_id: "s", class_ids: [] },
  ],
  { loadContext: loader({ s: ctx({ classes }) }) });
check("the gated class flags", perClass.p, true);
check("its ungated sibling doesn't", perClass.r, false);
check("and neither does an undecided sign-up", perClass.none, false);

// A season deleted while somebody waited, and a lookup that simply fails, both
// fall back to what the row was stamped with rather than losing the flag or
// taking the queue down with them.
const missing = await placementsRequiredFor(
  [{ id: "orphan", season_id: "gone", class_ids: [], placements_required: true }],
  { loadContext: async () => null });
check("a deleted season falls back to the stamp", missing.orphan, true);
// The failure is logged on purpose; muted here so a real error in this suite
// still stands out rather than being lost in expected noise.
const wasError = console.error;
console.error = () => {};
const thrown = await placementsRequiredFor(
  [
    { id: "boom", season_id: "bad", class_ids: [], placements_required: true },
    { id: "quiet", season_id: "bad", class_ids: [], placements_required: false },
  ],
  { loadContext: async () => { throw new Error("firestore said no"); } });
console.error = wasError;
check("a failed lookup falls back to the stamp", [thrown.boom, thrown.quiet], [true, false]);
check("an empty queue is fine", await placementsRequiredFor([]), {});

// …but the APPROVAL asks strictly, and gets a throw instead of a guess. The
// fallback is only safe for a screen: at approval it would seat a driver whose
// series was gated after they signed up (stamped false, gated now), which is
// exactly the case live resolution exists for.
let refused = false;
try {
  await placementsRequiredFor(
    [{ id: "boom", season_id: "bad", class_ids: [], placements_required: false }],
    { strict: true, loadContext: async () => { throw new Error("firestore said no"); } });
} catch {
  refused = true;
}
ok("a strict lookup refuses rather than guessing", refused);

// ── 6c. Approving one puts NOBODY on a roster ──────────────────────────────
//
// The point of the whole feature. A tier marked "Placements Required" is earned
// in a session, so approving its sign-up acknowledges the registration and
// creates nothing: the row moves to `approved_for_placements`, which takes it
// out of the queue and off the badge, and the driver joins a grid only when an
// admin places them and builds the roster from that session.
check("a gated approval creates no roster entry",
  signupApprovalPlan({ placementsRequired: true }),
  { status: APPROVED_FOR_PLACEMENTS, creates_entry: false });
check("an ordinary approval still seats them, exactly as before",
  signupApprovalPlan({ placementsRequired: false }),
  { status: APPROVED, creates_entry: true });
check("and an unspecified gate is the ordinary path",
  signupApprovalPlan(), { status: APPROVED, creates_entry: true });
// Stated as an invariant rather than as two examples: there is no input for
// which a gated approval reaches the roster.
ok("no gated approval ever creates an entry",
  [true, 1, "on"].every(v => !signupApprovalPlan({ placementsRequired: !!v }).creates_entry));
ok("the two outcomes are different statuses", APPROVED_FOR_PLACEMENTS !== APPROVED);
ok("a row in that state is recognised", isAwaitingPlacement({ status: APPROVED_FOR_PLACEMENTS }));
ok("an ordinary approval is not", !isAwaitingPlacement({ status: APPROVED }));
ok("nor is a pending row", !isAwaitingPlacement({ status: "pending" }));

// The screen the acknowledgement lands on has to MOUNT — it is the only place
// an approved-for-placements driver appears at all, so a missing import there
// loses them silently rather than loudly.
check("the Awaiting Placement panel mounts, and says nothing before it loads",
  render("the Awaiting Placement panel", <AwaitingPlacements />), "");

// ── 6d. …but they are still IN FLIGHT ──────────────────────────────────────
//
// Out of the admin's queue is not the same as finished. Two things must stay
// true of somebody waiting on a session, or the state that clears the badge
// quietly breaks the sign-up flow around it.
check("the in-flight statuses are pending and awaiting-placement",
  [...OPEN_STATUSES].sort(), ["approved_for_placements", "pending"]);
ok("a finished approval is not in flight", !OPEN_STATUSES.includes(APPROVED));
ok("nor a denial", !OPEN_STATUSES.includes("denied"));
ok("nor a withdrawal", !OPEN_STATUSES.includes("withdrawn"));

const awaiting = {
  id: "q1", kind: "signup", status: APPROVED_FOR_PLACEMENTS,
  uid: "u1", driver_id: "d1", name: "Ana", number: "24",
};
// (1) They can't file a second sign-up. A player whose registration looks like
// it vanished submits another one — which is exactly what would happen if the
// badge clearing also dropped them out of "already asked".
ok("an awaiting-placement registration still blocks a second sign-up",
  !!pendingForSeason([awaiting], { uid: "u1", driverId: "d1" }));
ok("and blocks it by driver profile too",
  !!pendingForSeason([awaiting], { uid: "other", driverId: "d1" }));
ok("somebody else is still free to sign up",
  !pendingForSeason([awaiting], { uid: "u2", driverId: "d2" }));

// (2) Their car number is still spoken for. Handing #24 to the next player
// while its owner waits for a placement night is a clash the admin gets to
// resolve later, by hand.
ok("an awaiting-placement number is still claimed", numberClaimed([], [awaiting], "24"));
ok("a free number is still free", !numberClaimed([], [awaiting], "25"));

// And they read as "placing" rather than "pending" on the roster peek — the
// number is gone either way, but they're waiting on different things.
const peek = rosterWithPending([{ number: "7", name: "Bo" }], [awaiting]);
check("the peek lists them", peek.map(r => r.name), ["Bo", "Ana"]);
ok("marked as awaiting a placement", peek.find(r => r.name === "Ana").awaiting_placement);
ok("an ordinary pending row is not",
  !rosterWithPending([], [{ id: "p", kind: "signup", status: "pending", name: "Cy" }])[0]
    .awaiting_placement);

// ── 6e. The player is told the truth about what happened ───────────────────
//
// "You're on the roster" is the one thing this approval must never say. A
// player who reads that turns up to a race expecting a grid slot they haven't
// earned yet.
const placed = { kind: "signup_placements", context: { series_name: "Gold", season_name: "S4" } };
ok("the placement card is its own kind", messageKind(placed) === "signup_placements");
ok("it names the series", messageTitle(placed).includes("Gold"));
ok("it says placements", /placement/i.test(messageTitle(placed) + messageBody(placed)));
ok("it says they are NOT on the roster yet",
  /not on the roster/i.test(messageBody(placed)));
ok("it never claims a roster place",
  !/you're on the roster|you are on the roster/i.test(messageBody(placed)));
ok("it isn't drawn as a refusal", messageTone(placed) === "info");
// The ordinary welcome is untouched — the case that must not regress.
const welcomed = { kind: "signup_approved", context: { series_name: "Rookie", season_name: "S1" } };
ok("an ordinary approval still welcomes them", /Welcome/i.test(messageTitle(welcomed)));
ok("and still says they're on the roster", /on the roster/i.test(messageBody(welcomed)));

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
