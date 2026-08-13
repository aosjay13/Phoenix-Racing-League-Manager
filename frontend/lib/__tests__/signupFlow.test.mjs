// The Sign-ups screen (app/signups) is the one part of the app written for a
// player who has never used it, so what it says has to be right without a human
// checking it. Everything it says is derived here, from the payload
// /api/users/me/series already returns.
//
// The invariants that matter:
//
//   1. a sign-up already sent NEVER shows up as something to join again — the
//      commonest way a first-timer ends up in the queue twice;
//   2. the sidebar badge counts only what is waiting on the PLAYER, so it falls
//      when they act rather than when somebody else does;
//   3. "what this form will ask you for" matches what the form actually renders
//      — a number only where one is required, a car only where a list exists,
//      and every platform identity the parent game insists on.
import assert from "node:assert";
import {
  JOIN_STEPS, awaitingSeasons, classesAskMore, joinableSeasons, seasonChips, seasonCounts,
  seasonLabel, seasonStatus, seasonsNeedingCar, signupBadgeCount, signupBadgeTitle, signupNeeds,
  signupOverview,
} from "../signupFlow.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── A league mid-season ─────────────────────────────────────────────────────
// Two seasons open to join (one already signed up for), two on the roster (one
// still wanting a car).
const openA = {
  season_id: "sA", season_name: "Season 4", series_name: "Formula Phoenix",
  game_name: "iRacing", game_requirements: { requires_iracing_name: true, requires_iracing_id: true },
  classes: [{ id: "pro", name: "Pro" }, { id: "am", name: "Am" }],
  rules: { require_number: true, require_car: true, car_options: ["GT3", "GT4"] },
  class_rules: {
    pro: { require_number: true, require_car: true, car_options: ["GT3", "GT4"] },
    am: { require_number: true, require_car: true, car_options: ["GT4"] },
  },
  roster: [{ number: "7", name: "Ana" }, { number: "9", name: "Bo" }],
  pending: [{ kind: "signup", name: "Cyd", number: "12" }, { kind: "number_change", name: "Ana", number: "3" }],
  my_pending: false,
};
const openB = {
  season_id: "sB", season_name: "Winter Cup", series_name: "Banger Bash",
  game_name: "Wreckfest", game_requirements: {},
  classes: [],
  rules: { require_number: false, require_car: false, car_options: [] },
  class_rules: {},
  roster: [], pending: [],
  my_pending: true,          // already sent — waiting on an admin
};
const mineNeedsCar = {
  season_id: "sC", season_name: "Season 3", series_name: "GT Masters",
  open: true, requires_car: true, needs_pick: true,
  picks: [{ class_id: "", class_name: "", car: "", locked: false }],
};
const mineSettled = {
  season_id: "sD", season_name: "Season 2", series_name: "Trucks",
  open: true, requires_car: true, needs_pick: false,
  picks: [{ class_id: "", class_name: "", car: "Silverado", locked: false }],
};
const data = {
  driver: { id: "d1", name: "Ana", aliases: [] },
  pending_claim: null,
  my_seasons: [mineNeedsCar, mineSettled],
  open_signups: [openA, openB],
  closed_signups: 3,
};

// ── 1. A sign-up already sent is never offered again ────────────────────────
check("joinable excludes my pending", joinableSeasons(data).map(s => s.season_id), ["sA"]);
check("waiting is exactly my pending", awaitingSeasons(data).map(s => s.season_id), ["sB"]);
ok("a season is in exactly one of the two lists",
  joinableSeasons(data).every(j => !awaitingSeasons(data).some(w => w.season_id === j.season_id)));

const overview = signupOverview(data);
check("overview joinable", overview.joinable.map(s => s.season_id), ["sA"]);
check("overview waiting", overview.waiting.map(s => s.season_id), ["sB"]);
check("overview cars to pick", overview.carsToPick.map(s => s.season_id), ["sC"]);
check("overview racing keeps every season", overview.racing.length, 2);
check("overview knows the driver is linked", overview.needsDriver, false);
check("overview carries the finished count", overview.closed, 3);
check("no driver profile is flagged", signupOverview({ my_seasons: [], open_signups: [] }).needsDriver, true);
check("an empty payload is safe", signupOverview(null).joinable, []);

// ── 2. The badge counts what is waiting on the PLAYER ───────────────────────
check("badge = joinable + cars to pick", signupBadgeCount(data), 2);
check("badge ignores sign-ups already sent",
  signupBadgeCount({ my_seasons: [], open_signups: [openB] }), 0);
check("badge with nothing outstanding",
  signupBadgeCount({ my_seasons: [mineSettled], open_signups: [] }), 0);
check("badge before anything loads", signupBadgeCount(null), 0);
check("badge title spells both halves out",
  signupBadgeTitle(data), "1 series you can join · 1 car to choose");
check("badge title when idle",
  signupBadgeTitle({ my_seasons: [mineSettled], open_signups: [] }),
  "Nothing waiting on you right now");
// A season the player is on but which is finished has nothing left to answer,
// so it can never put a number on the badge.
check("a finished season is not a job",
  signupBadgeCount({ my_seasons: [{ ...mineNeedsCar, open: false }], open_signups: [] }), 0);

// ── 3. "What you'll need" matches what the form renders ─────────────────────
const needsA = signupNeeds(openA).map(x => x.key);
ok("the racing name is always asked for", needsA.includes("name"));
ok("Discord is always asked for", needsA.includes("alias:Discord Name"));
ok("an iRacing season asks for the iRacing name", needsA.includes("alias:iRacing Name"));
ok("an iRacing season asks for the customer ID", needsA.includes("alias:iRacing ID#"));
ok("a season that requires a number says so", needsA.includes("number"));
ok("a season with a car list says so", needsA.includes("car"));
ok("a season with classes says so", needsA.includes("class"));

const needsB = signupNeeds(openB).map(x => x.key);
check("a plain season asks for the name and Discord only", needsB, ["name", "alias:Discord Name"]);
ok("no number question where numbers aren't required", !needsB.includes("number"));
ok("no car question where no cars are listed", !needsB.includes("car"));
check("every need explains itself", signupNeeds(openA).every(x => !!x.detail && !!x.label), true);
check("a missing season doesn't throw", signupNeeds(undefined).map(x => x.key), ["name", "alias:Discord Name"]);

// A class that asks for a number the season doesn't is worth warning about,
// since the question appears mid-form the moment it's picked.
check("classes that ask no more than the season", classesAskMore(openA), false);
check("a class that asks for more", classesAskMore({
  rules: { require_number: false, require_car: false, car_options: [] },
  class_rules: { pro: { require_number: true, car_options: [] } },
}), true);
check("a class with its own car list counts as more", classesAskMore({
  rules: { require_number: false, require_car: false, car_options: [] },
  class_rules: { pro: { require_number: false, car_options: ["GT3"] } },
}), true);

// ── Card furniture ──────────────────────────────────────────────────────────
check("a season is named the same way everywhere", seasonLabel(openA), "Formula Phoenix · Season 4");
check("a missing season has no name", seasonLabel(null), "");
// A number change is somebody already racing, not another person joining.
check("counts split racing from waiting", seasonCounts(openA), { racing: 2, waiting: 1 });
check("counts on an empty season", seasonCounts(openB), { racing: 0, waiting: 0 });

const chips = seasonChips(openA);
ok("chips name the game", chips.includes("iRacing"));
ok("chips count the field", chips.includes("2 racing"));
ok("chips count the queue", chips.includes("1 waiting to get in"));
ok("chips warn about the number", chips.includes("Car number needed"));
ok("chips warn about the car", chips.includes("Choose your car"));
ok("chips count the classes", chips.includes("2 classes"));
// "0 racing" reads like something is broken; an empty season is an invitation.
ok("an empty season invites rather than reporting zero",
  seasonChips(openB).includes("Be the first to join"));
ok("no car chip where there are no cars",
  !seasonChips(openB).some(c => c.toLowerCase().includes("car")));

// ── What one of my seasons is waiting on ────────────────────────────────────
check("a season wanting a car", seasonStatus(mineNeedsCar),
  { tone: "todo", text: "Choose the car you'll race — that's all that's left." });
check("a season already answered", seasonStatus(mineSettled),
  { tone: "ok", text: "You're racing the Silverado." });
check("a finished season", seasonStatus({ ...mineNeedsCar, open: false }),
  { tone: "ok", text: "Season over — nothing left to do." });
check("a season that asks for no car", seasonStatus({ open: true, requires_car: false }),
  { tone: "ok", text: "You're on the roster. This series doesn't ask you to pick a car." });
// Only "todo" is ever drawn as an outstanding job, so nothing settled can be
// coloured as if it needed attention.
check("exactly the season needing a car is a todo",
  [mineNeedsCar, mineSettled].map(s => seasonStatus(s).tone), ["todo", "ok"]);
check("seasonsNeedingCar agrees with seasonStatus",
  seasonsNeedingCar(data).map(s => s.season_id),
  [mineNeedsCar, mineSettled].filter(s => seasonStatus(s).tone === "todo").map(s => s.season_id));

// ── The walkthrough itself ──────────────────────────────────────────────────
check("three steps, numbered in order", JOIN_STEPS.map(s => s.step), [1, 2, 3]);
check("every step says what it is", JOIN_STEPS.every(s => !!s.title && !!s.blurb), true);

console.log(`signupFlow: ${n} assertions passed`);
