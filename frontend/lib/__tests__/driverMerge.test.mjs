// Merging two driver profiles has one rule — nothing may be lost — and one
// tie-breaker: the admin picked which profile survives, so the PRIMARY wins
// wherever the two disagree and the duplicate only fills in the gaps.
//
// Both halves are easy to break in ways nobody notices until months later:
// silently overwriting the survivor's Discord handle with a stale one, or
// dropping the duplicate's Xbox gamertag so the next import doesn't recognise
// this person and makes the duplicate all over again. So this pins the
// direction of every field, and pins that the old names survive.
import assert from "node:assert";
import {
  findDuplicateCandidates, mergeAliasSets, mergeFormerNames, mergeGameNames,
  mergeSkillRatings, planProfileMerge,
} from "../driverMerge.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// The real shape of this mistake: Ryan raced a couple of BeamNG rounds under
// his in-game name before anybody linked it to his profile, so the league has
// two of him. The full profile is the primary; the stub carries a gamertag and
// an in-game name the primary never had.
const primary = {
  id: "d-ryan",
  name: "Ryan Maynard",
  user_id: "u-ryan",
  aliases: [
    { label: "Discord Name", value: "ryanb", game_id: "", is_display: false },
    { label: "Xbox Gamertag", value: "", game_id: "", is_display: false },
  ],
  game_names: [{ game_id: "gt7", name: "Ryan_M" }],
  skillRatings: { gt7: 1620 },
  merged_names: ["Ryan M"],
};
const duplicate = {
  id: "d-dup",
  name: "Ryanbirdman",
  display_name: "Birdman",
  notes: "Runs the #77",
  aliases: [
    { label: "Discord Name", value: "somebody-elses-handle", game_id: "", is_display: false },
    { label: "Xbox Gamertag", value: "RyanBird77", game_id: "", is_display: false },
    { label: "PSN Username", value: "Ryan_Bird_77", game_id: "gt7", is_display: false },
  ],
  game_names: [{ game_id: "beamng", name: "Ryanbirdman" }, { game_id: "gt7", name: "WRONG" }],
  skillRatings: { beamng: 1490, gt7: 1200 },
};

// ── Connected accounts ──────────────────────────────────────────────────────
const aliases = mergeAliasSets(primary.aliases, duplicate.aliases);
check("the primary's Discord handle stands",
  aliases.find(a => a.label === "Discord Name").value, "ryanb");
check("a blank platform on the primary is filled in from the duplicate",
  aliases.find(a => a.label === "Xbox Gamertag").value, "RyanBird77");
check("a platform only the duplicate used comes across",
  aliases.find(a => a.label === "PSN Username").value, "Ryan_Bird_77");
check("nothing is duplicated", aliases.length, 3);
// Labels differing only by case are one platform, not two.
check("labels match case-insensitively",
  mergeAliasSets([{ label: "PSN Username", value: "a" }], [{ label: "psn username", value: "b" }]).length, 1);
// An empty row on the duplicate is not a fact worth carrying.
check("an empty alias row is dropped",
  mergeAliasSets([], [{ label: "Steam Username", value: "" }]), []);

// ── Per-game names ──────────────────────────────────────────────────────────
check("one name per game, the primary's winning",
  mergeGameNames(primary.game_names, duplicate.game_names),
  [{ game_id: "gt7", name: "Ryan_M" }, { game_id: "beamng", name: "Ryanbirdman" }]);

// ── Skill Ratings ───────────────────────────────────────────────────────────
check("per-game ratings merge, the primary's winning",
  mergeSkillRatings(primary.skillRatings, duplicate.skillRatings),
  { beamng: 1490, gt7: 1620 });
check("missing rating maps are not a crash", mergeSkillRatings(null, undefined), {});

// ── Former names ────────────────────────────────────────────────────────────
// This is what stops the duplicate being re-created by the next import.
const former = mergeFormerNames(primary, duplicate, ["Ryan Maynard", "R. Maynard"]);
ok("the duplicate's name is kept", former.includes("Ryanbirdman"));
ok("the duplicate's display name is kept", former.includes("Birdman"));
ok("an earlier merge's names are kept", former.includes("Ryan M"));
ok("a name only their entries carried is kept", former.includes("R. Maynard"));
ok("the survivor's own name is not a former name", !former.some(x => x === "Ryan Maynard"));
// Case and spacing noise is the same name, listed once.
check("no near-duplicates in the list",
  mergeFormerNames({ name: "A" }, { name: "Bee Gee", merged_names: ["bee_gee", "BEEGEE"] }),
  ["Bee Gee"]);

// ── The whole plan ──────────────────────────────────────────────────────────
const { updates, carried } = planProfileMerge(primary, duplicate, { extraNames: ["R. Maynard"] });
check("the primary's own name is never rewritten", updates.name, undefined);
check("a linked account is not taken from the survivor", updates.user_id, undefined);
check("a display name the survivor lacks is inherited", updates.display_name, "Birdman");
check("notes the survivor lacks are inherited", updates.notes, "Runs the #77");
ok("the admin is told what came across", carried.length > 0 && carried.every(c => typeof c === "string"));

// An unlinked survivor inherits the duplicate's player account — the common
// shape of this mistake is that the accidental profile is the claimed one.
check("an unlinked survivor inherits the account",
  planProfileMerge({ name: "Ryan" }, { name: "Ryan M", user_id: "u-ryan" }).updates.user_id, "u-ryan");

// Merging two bare profiles writes the former name and nothing else — no
// invented fields, no blanks stamped over anything.
const bare = planProfileMerge({ name: "A" }, { name: "B" });
check("a bare merge only records the former name", Object.keys(bare.updates), ["merged_names"]);
check("…and that former name is the duplicate's", bare.updates.merged_names, ["B"]);

// Missing halves are ordinary, not a crash: a profile created by an import has
// no aliases, no game names and no ratings at all.
ok("empty profiles merge cleanly", !!planProfileMerge({}, {}).updates.merged_names);

// ── Finding the pairs ───────────────────────────────────────────────────────
// The duplicate is usually filed under an in-game name, which is exactly the
// name a manual scan down a list of profile names never notices.
const pool = [
  // Ryan's real profile knows he races BeamNG as "Ryanbirdman"…
  { ...primary, game_names: [{ game_id: "beamng", name: "Ryanbirdman" }] },
  // …and an old import made a second profile under exactly that name. Reading
  // down a list of profile names, "Ryan Maynard" and "Ryanbirdman" look like
  // two people.
  { id: "d-dup", name: "Ryanbirdman" },
  { id: "d-smith", name: "Ryan Smith" },
  { id: "d-jo", name: "Jo Chen" },
];
const pairs = findDuplicateCandidates(pool);
const ryanPair = pairs.find(p => [p.primary.id, p.duplicate.id].sort().join("|") === "d-dup|d-ryan");
ok("the in-game-name duplicate is found", !!ryanPair);
check("the linked profile is offered as the primary", ryanPair.primary.id, "d-ryan");
ok("it says why", ryanPair.reason.length > 0);
// One row per pair, however many names the two share.
check("each pair is listed once",
  pairs.filter(p => [p.primary.id, p.duplicate.id].sort().join("|") === "d-dup|d-ryan").length, 1);
// Nobody is ever paired with themselves, and a lone driver is not a duplicate.
ok("no self-pairs", pairs.every(p => p.primary.id !== p.duplicate.id));
check("a pool of one has no pairs", findDuplicateCandidates([primary]), []);
check("an empty pool is fine", findDuplicateCandidates(), []);

console.log(`driverMerge: ${n} assertions passed`);
