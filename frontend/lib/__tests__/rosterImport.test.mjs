// Building a new season's roster is where duplicates arrived by the dozen: one
// click pulled in thirty drivers, and any of them whose source entry had no
// driver_id landed as a brand-new stranger — even when the app had been racing
// them for two years under a name from a different game.
//
// So the plan has to be right about four things:
//
//   1. anyone already on the target roster is skipped, however they're
//      recognised (driver_id, account, or the name they race under there);
//   2. everyone else is resolved against the GLOBAL driver pool, through every
//      name they answer to — that's what makes an import line up with drivers
//      the app already has instead of cloning them;
//   3. a name that merely RESEMBLES an existing driver is never resolved on its
//      own. It comes back as "check", for a human to settle;
//   4. someone genuinely new is marked "new", and the import creates a driver
//      profile for them — no entry is left attached to nobody.
import assert from "node:assert";
import { applyRosterPlan, identityKeys, planRosterImport } from "../rosterImport.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const statusOf = (plan, key) => plan.rows.find(r => r.key === key)?.status;

// The league's global drivers. Ryan races BeamNG as "Ryanbirdman".
const pool = [
  { id: "d-ryan", name: "Ryan Maynard", game_names: [{ game_id: "beamng", name: "Ryanbirdman" }] },
  { id: "d-ana", name: "Ana Ruiz", aliases: [{ label: "PSN Username", value: "AnaR_77" }] },
  { id: "d-bo", name: "Bo Chen" },
];

// ── 1. Already on the target roster ────────────────────────────────────────
check("identity keys cover id, account and name",
  identityKeys({ driver_id: "d1", user_id: "u1", name: "Ana Ruiz" }),
  ["d:d1", "u:u1", "n:ana ruiz"]);

const onRoster = planRosterImport(
  [{ driver_id: "d-ana", name: "Ana" }],
  [{ id: "e1", name: "Ana Ruiz", driver_id: "d-ana", season_id: "s1" }],
  pool);
check("someone already racing this season is skipped", statusOf(onRoster, "e1"), "on_roster");

// The same person in two past seasons must not become two roster places.
const twice = planRosterImport([], [
  { id: "e1", name: "Bo Chen", driver_id: "d-bo", season_id: "s3" },
  { id: "e2", name: "Bo Chen", driver_id: "d-bo", season_id: "s2" },
], pool);
check("their newest entry comes through", statusOf(twice, "e1"), "linked");
check("…and the older one doesn't", statusOf(twice, "e2"), "on_roster");

// ── 2. Lining up with drivers the app already has ──────────────────────────
const plan = planRosterImport([], [
  // No driver_id at all, and the name is the one he uses in BeamNG.
  { id: "e-ryan", name: "Ryanbirdman", season_id: "s2" },
  // No driver_id, and the name is a PSN username on Ana's profile.
  { id: "e-ana", name: "AnaR_77", number: "7", season_id: "s2" },
  // Nobody in the league is anything like this.
  { id: "e-new", name: "Cyd Okafor", season_id: "s2" },
  // Close to Bo Chen without being him — or is it? A human decides.
  { id: "e-check", name: "Bo Chan", season_id: "s2" },
], pool, { games: { beamng: "BeamNG" } });

check("an in-game name lines up with the driver who uses it", statusOf(plan, "e-ryan"), "linked");
check("…on the right driver", plan.rows.find(r => r.key === "e-ryan").driver_id, "d-ryan");
check("a PSN username does too", statusOf(plan, "e-ana"), "linked");
check("…on the right driver", plan.rows.find(r => r.key === "e-ana").driver_id, "d-ana");
check("somebody genuinely new is marked new", statusOf(plan, "e-new"), "new");
check("…with no driver to attach to yet", plan.rows.find(r => r.key === "e-new").driver_id, null);

// ── 3. A resemblance is a question, not an answer ──────────────────────────
check("a near miss stops for a human", statusOf(plan, "e-check"), "check");
check("…and offers who it might be", plan.rows.find(r => r.key === "e-check").matches.map(m => m.driver_id), ["d-bo"]);
check("…without deciding", plan.rows.find(r => r.key === "e-check").driver_id, null);

check("the summary counts each kind", plan.summary,
  { total: 4, linked: 2, check: 1, new: 1, on_roster: 0, unusable: 0 });

// An entry with nothing to identify it can't be imported at all.
const junk = planRosterImport([], [{ id: "e-junk", name: "  ", season_id: "s2" }], pool);
check("a nameless entry is unusable", statusOf(junk, "e-junk"), "unusable");

// ── 4. What the plan turns into ────────────────────────────────────────────
const applied = applyRosterPlan(plan.rows, {
  "e-check": { action: "link", driver_id: "d-bo" },   // the admin said "yes, that's Bo"
});
check("everyone answered for is written", applied.create.length, 4);
check("…carrying the number they raced under", applied.create.find(c => c.name === "AnaR_77").number, "7");
check("…and the driver they resolved to", applied.create.find(c => c.name === "Ryanbirdman").driver_id, "d-ryan");
check("…including the one the admin settled", applied.create.find(c => c.name === "Bo Chan").driver_id, "d-bo");
check("only the genuinely new one needs a profile made",
  applied.needsDriver.map(d => d.name), ["Cyd Okafor"]);
ok("…pointed at the entry that will carry it",
  applied.create[applied.needsDriver[0].at].name === "Cyd Okafor");

// Team and class belong to the season being left behind, never the new one.
ok("team and class are not carried over",
  applied.create.every(c => c.team_id === "" && c.class_id === ""));

const skipped = applyRosterPlan(plan.rows, {
  "e-check": { action: "skip" },
  "e-new": { action: "skip" },
});
check("a skipped driver is left off", skipped.create.map(c => c.name), ["Ryanbirdman", "AnaR_77"]);
check("…and counted as skipped", skipped.skipped, 2);

// A row nobody answered for must never be merged into somebody by default —
// the unanswered case creates its own driver rather than guessing.
const unanswered = applyRosterPlan(plan.rows, {});
check("an unanswered doubtful row creates rather than guesses",
  unanswered.create.find(c => c.name === "Bo Chan").driver_id, undefined);
ok("…and is on the list of profiles to make",
  unanswered.needsDriver.some(d => d.name === "Bo Chan"));

console.log(`rosterImport: ${n} assertions passed`);
