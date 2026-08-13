// Duplicate drivers are the one data problem this app can't undo cheaply: once
// two profiles exist, one person's history is in two places and only a merge
// puts it back. So the rules that decide "have we already got this person?"
// have to be right about four things, and this file is those four things:
//
//   1. every name a driver answers to counts — not just the profile name, but
//      their display name, the name they use in each GAME, every connected
//      account (PSN / Xbox / Discord / iRacing / Steam), and any name a merge
//      folded into them;
//   2. spelling noise is not a different person — case, spaces, underscores,
//      punctuation and accents all normalize away;
//   3. it says WHICH name matched, because "Ryan Maynard — PSN Username
//      “Ryanbirdman”" is the difference between a prompt an admin can act on
//      and one they dismiss;
//   4. it does NOT over-claim. Two different people with similar names are
//      ordinary in a league; a near miss is offered, never applied.
import assert from "node:assert";
import {
  compactName, driverAnswersTo, driverNames, duplicateReport, duplicateSummary,
  findDriverMatches, matchReason, normalizeName, scoreDriver, searchDrivers,
} from "../driverMatch.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// Ryan races BeamNG as "Ryanbirdman" and owns a PlayStation. One person.
const ryan = {
  id: "d-ryan",
  name: "Ryan Maynard",
  user_id: "u-ryan",
  game_names: [{ game_id: "beamng", name: "Ryanbirdman" }],
  aliases: [
    { label: "Discord Name", value: "ryanb", game_id: "" },
    { label: "PSN Username", value: "Ryan_Bird_77", game_id: "gt7" },
  ],
  merged_names: ["Ryan M"],
};
// Somebody else entirely, who happens to share a first name.
const ryanSmith = { id: "d-smith", name: "Ryan Smith" };
const ana = { id: "d-ana", name: "Ana Ruiz", aliases: [{ label: "Xbox Gamertag", value: "AnaR", game_id: "" }] };
const pool = [ryan, ryanSmith, ana];
const games = { beamng: "BeamNG", gt7: "Gran Turismo 7" };

// ── 1. Every name counts ───────────────────────────────────────────────────
check("names are collected from every source",
  driverNames(ryan, games).map(r => [r.value, r.source, r.label]),
  [
    ["Ryan Maynard", "name", "profile name"],
    ["Ryanbirdman", "game_name", "BeamNG name"],
    ["ryanb", "alias", "Discord Name"],
    ["Ryan_Bird_77", "alias", "PSN Username"],
    ["Ryan M", "former_name", "former name"],
  ]);

check("a display-name override leads the per-game names",
  driverNames({ name: "R. Maynard", display_name: "Ryan Maynard" }).map(r => r.source),
  ["name", "display_name"]);

check("the same value under two sources is listed once",
  driverNames({ name: "Ana Ruiz", display_name: "ana ruiz" }).length, 1);

check("a game with no name to hand still explains itself",
  driverNames({ name: "X", game_names: [{ game_id: "unknown", name: "XX" }] })[1].label,
  "in-game name");

// ── 2. Spelling noise is not a different person ────────────────────────────
check("normalizeName folds case, punctuation and accents", normalizeName("Müller,  Jörg!"), "muller jorg");
check("compactName drops the spaces too", compactName("Ryan_Birdman"), "ryanbirdman");
check("compact forms of one gamertag agree", compactName("RyanBirdman"), compactName("ryan birdman"));

ok("the BeamNG name resolves to Ryan", scoreDriver({ name: "Ryanbirdman" }, ryan).score === 1);
ok("so does it written with an underscore", scoreDriver({ name: "ryan_birdman" }, ryan).score === 1);
ok("so does the PSN username", scoreDriver({ name: "Ryan Bird 77" }, ryan).score === 1);
ok("so does a name he was merged out of", scoreDriver({ name: "ryan m" }, ryan).score === 1);
ok("and a typo of his profile name is close but never exact",
  scoreDriver({ name: "Ryan Maynrad" }, ryan).score > 0.65 && scoreDriver({ name: "Ryan Maynrad" }, ryan).score < 1);

// The account is the strongest signal there is: same account, same person, even
// when the name typed is nothing like the one on the profile.
check("a shared player account matches outright",
  scoreDriver({ name: "Someone Else", user_id: "u-ryan" }, ryan).via.source, "account");

// ── 3. It says which name matched ──────────────────────────────────────────
check("an alias match names its platform",
  matchReason(findDriverMatches(pool, { name: "Ryan_Bird_77" }, { games })[0]),
  "their PSN Username is “Ryan_Bird_77”");
check("a per-game match names the game",
  matchReason(findDriverMatches(pool, { name: "Ryanbirdman" }, { games })[0]),
  "their BeamNG name is “Ryanbirdman”");
check("a former name says so",
  matchReason(findDriverMatches(pool, { name: "Ryan M" }, { games })[0]),
  "used to race as “Ryan M”");
check("an identical name says the simple thing",
  matchReason(findDriverMatches(pool, { name: "ana ruiz" })[0]), "same name");

// ── 4. It doesn't over-claim ───────────────────────────────────────────────
check("a genuinely different person is not offered", findDriverMatches(pool, { name: "Bo Chen" }), []);
check("sharing a first name is not a match", findDriverMatches([ryanSmith], { name: "Ryan Maynard" }), []);

check("nothing close at all", duplicateReport(pool, { name: "Bo Chen" }).status, "none");

const linked = duplicateReport(pool, { name: "Ryanbirdman" }, { games });
check("a name they demonstrably answer to links straight through", linked.status, "linked");
check("…to the right driver", linked.driver_id, "d-ryan");

// Two people who really do share a name: the app must not pick one for you.
const twins = duplicateReport(
  [{ id: "a", name: "Chris Lee" }, { id: "b", name: "chris lee" }],
  { name: "Chris Lee" });
check("two drivers with one name is ambiguous, never a guess", twins.status, "ambiguous");
check("…and offers both", twins.matches.map(m => m.driver_id), ["a", "b"]);
check("…with no driver chosen", twins.driver_id, null);

const near = duplicateReport(pool, { name: "Ryan Maynrad" });
check("a near miss is only ever a prompt", near.status, "possible");
check("…and carries no driver to link to", near.driver_id, null);
check("…naming the driver it means", near.matches[0].driver_id, "d-ryan");

check("re-checking a driver against themselves finds nothing",
  duplicateReport(pool, { name: "Ryan Maynard", exclude_id: "d-ryan" }).status, "none");

// The best match leads, whatever order the pool came in.
const ranked = findDriverMatches([ryanSmith, ryan], { name: "Ryan Maynard" });
check("the strongest match is first", ranked[0].driver_id, "d-ryan");

// A blank name can't match anything — an import row with no driver column must
// not silently attach to whoever happens to be first in the pool.
check("a blank name matches nobody", findDriverMatches(pool, { name: "   " }), []);
check("…and neither does an empty query", findDriverMatches(pool, {}), []);

// ── Typing a name into the "add a driver" box ──────────────────────────────
// The box has to find the person mid-word, through whichever name the admin
// happens to know them by — that's what stops them concluding the driver isn't
// there and creating a second one.
check("a half-typed profile name finds them",
  searchDrivers(pool, "ryan may", { games }).map(h => h.driver.id), ["d-ryan"]);
check("a half-typed in-game name finds them too",
  searchDrivers(pool, "ryanbird", { games }).map(h => h.driver.id), ["d-ryan"]);
check("…and says which name it found them by",
  searchDrivers(pool, "ryanbird", { games })[0].via.label, "BeamNG name");
check("part of a PSN username finds them by that",
  searchDrivers(pool, "bird_77", { games })[0].via.label, "PSN Username");
check("a shared fragment lists everyone it fits",
  searchDrivers(pool, "ryan", { games }).map(h => h.driver.id), ["d-ryan", "d-smith"]);
check("…profile-name matches leading",
  searchDrivers(pool, "ryan", { games })[0].via.source, "name");
check("an empty box searches for nothing", searchDrivers(pool, "  ", { games }), []);

ok("a name they go by needs no new driver", driverAnswersTo(ryan, "ryan_bird_77"));
ok("…and one they don't, does", !driverAnswersTo(ryan, "Ryan Reed"));

// ── The sentence each of those turns into ──────────────────────────────────
check("the linked summary names the driver it found",
  duplicateSummary(linked, "Ryanbirdman"),
  "“Ryanbirdman” is already in the app as Ryan Maynard (their BeamNG name is “Ryanbirdman”).");
check("a clean name says nothing at all", duplicateSummary(duplicateReport(pool, { name: "Bo Chen" }), "Bo Chen"), "");
ok("a near miss asks rather than tells", /check before creating/.test(duplicateSummary(near, "Ryan Maynrad")));

console.log(`driverMatch: ${n} assertions passed`);
