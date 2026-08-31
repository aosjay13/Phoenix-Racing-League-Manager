// iRacing makes its members race under their legal name. Nowhere else does.
//
// So for the many drivers who run an iRacing series AND a BeamNG or AMS2 one,
// this league holds a real name it must never print outside iRacing — not on a
// roster, not in a standings table, not on a result sheet, not on the global
// driver directory, and not in an error message a stranger can provoke. This
// file is the four things that has to be true of:
//
//   1. an iRacing context shows the iRacing name, and every other context shows
//      the generic display name or gamertag INSTEAD — not as well;
//   2. the fallbacks are safe. A name is printed from half a dozen stored
//      fields (an entry's denormalized copy, the pool name, a merged former
//      name), and every one of those paths ends somewhere other than the real
//      name;
//   3. a driver who races ONLY iRacing keeps their name. Hiding it would leave
//      the app calling them nobody, and there is no second identity to protect;
//   4. nothing is unlinked. The rule is a projection over documents this module
//      never rewrites: one human, one driver id, one set of stats.
import assert from "node:assert";
import {
  PRIVATE_NAME, contextNames, iracingGameIds, iracingIdentityValues, iracingNameFor,
  isIracingGameId, isIracingIdentity, publicDriverDoc, publicNameFor, racesOnlyIracing,
} from "../iracingPrivacy.js";
import { matchReason, matchedName, searchDrivers, visibleNames } from "../driverMatch.js";
import { driverNames, hiddenName, isIracingScope } from "../rawIndex.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── The league ─────────────────────────────────────────────────────────────
const games = [
  { id: "g-ir", name: "iRacing" },
  { id: "g-beam", name: "BeamNG" },
  { id: "g-ams", name: "Automobilista 2" },
];
const iracingIds = iracingGameIds(games);

// Ryan races iRacing (where he is legally "Ryan Maynard"), BeamNG (where he is
// "Ryanbirdman") and AMS2 (where he has never set a name). His POOL name is the
// real one, because an iRacing results import is what created his profile —
// which is exactly how the real name gets everywhere if nothing stops it.
const ryan = {
  id: "d-ryan",
  name: "Ryan Maynard",
  user_id: "u-ryan",
  game_names: [{ game_id: "g-beam", name: "Ryanbirdman" }, { game_id: "g-ir", name: "Ryan Maynard" }],
  aliases: [
    { label: "iRacing Name", value: "Ryan Maynard", game_id: "g-ir" },
    { label: "iRacing ID#", value: "812345", game_id: "g-ir" },
    { label: "Discord Name", value: "ryanb", game_id: "" },
  ],
  merged_names: ["Ryan M", "Ryan Maynard"],
};
// Ana races iRacing and nothing else. Her real name is simply her name.
const ana = { id: "d-ana", name: "Ana Ruiz", aliases: [{ label: "iRacing Name", value: "Ana Ruiz", game_id: "g-ir" }] };
// Jo's league gave her a global display name, and her iRacing name was typed
// into a sign-up that nobody ever mapped to the game.
const jo = {
  id: "d-jo",
  name: "Joanne Smith",
  display_name: "JoJo",
  aliases: [{ label: "iRacing Name", value: "Joanne Smith", game_id: "" }],
};

// ── 1. Which games are iRacing ─────────────────────────────────────────────
check("the iRacing game is found by name", [...iracingIds], ["g-ir"]);
check("punctuation and case don't hide it", [...iracingGameIds([{ id: "x", name: "i-RACING" }])], ["x"]);
ok("a league-wide context is not an iRacing one", !isIracingGameId(null, iracingIds));
ok("another game is not an iRacing one", !isIracingGameId("g-beam", iracingIds));

// ── 2. What counts as an iRacing identity ──────────────────────────────────
check("every iRacing-scoped value is collected", iracingIdentityValues(ryan, iracingIds).sort(),
  ["812345", "Ryan Maynard"]);
ok("a Discord handle is not one", !iracingIdentityValues(ryan, iracingIds).includes("ryanb"));
ok("a BeamNG name is not one", !iracingIdentityValues(ryan, iracingIds).includes("Ryanbirdman"));
ok("an unmapped iRacing Name alias still counts", iracingIdentityValues(jo, iracingIds).includes("Joanne Smith"));
ok("spelling noise doesn't get a real name through", isIracingIdentity(ryan, "ryan  maynard", iracingIds));
ok("a gamertag is not withheld", !isIracingIdentity(ryan, "Ryanbirdman", iracingIds));

// ── 3. The name to show, per context ───────────────────────────────────────
check("iRacing shows the iRacing name",
  contextNames(ryan, { gameId: "g-ir", iracingIds }).display, "Ryan Maynard");
check("BeamNG shows the BeamNG name",
  contextNames(ryan, { gameId: "g-beam", iracingIds }).display, "Ryanbirdman");
// The point of the whole exercise: on a game where he has set no name, the
// fallback chain must not walk into the pool name, because the pool name IS the
// real one. It reaches for a handle he actually chose instead.
check("AMS2 falls back to a gamertag, never the real name",
  contextNames(ryan, { gameId: "g-ams", iracingIds }).display, "Ryanbirdman");
check("league-wide is not an iRacing context either",
  contextNames(ryan, { iracingIds }).display, "Ryanbirdman");
// `overall` is the muted "who that is" line under an on-track name, so it is
// governed by exactly the same rule as the name above it.
check("the profile line under a BeamNG name is safe too",
  contextNames(ryan, { gameId: "g-beam", iracingIds }).overall, "Ryanbirdman");
check("on iRacing the profile line may be the real name",
  contextNames(ryan, { gameId: "g-ir", iracingIds }).overall, "Ryan Maynard");
check("an admin-set display name wins outside iRacing",
  contextNames(jo, { gameId: "g-beam", iracingIds }).display, "JoJo");
check("an unmapped iRacing Name still renders on iRacing",
  contextNames(jo, { gameId: "g-ir", iracingIds }).display, "Joanne Smith");
check("iracingNameFor finds it however it was recorded", iracingNameFor(jo, iracingIds), "Joanne Smith");

// `game` says "they have a separate on-track name here", so it must never
// answer with a name this context may not print.
check("no iRacing name leaks through the per-game field",
  contextNames(ryan, { gameId: "g-ams", iracingIds }).game, null);

// ── 4. A driver who races only iRacing ─────────────────────────────────────
ok("racing iRacing alone is recognised", racesOnlyIracing(["g-ir"], iracingIds));
ok("racing iRacing and BeamNG is not", !racesOnlyIracing(["g-ir", "g-beam"], iracingIds));
ok("a driver with no results yet is not", !racesOnlyIracing([], iracingIds));
check("so Ana keeps her name everywhere",
  contextNames(ana, { iracingIds, iracingOnly: true }).display, "Ana Ruiz");
// And without that carve-out there is genuinely nothing safe left to call her,
// which must be a placeholder rather than the real name.
check("with a second game she'd be shown as a placeholder",
  contextNames(ana, { iracingIds }).display, PRIVATE_NAME);
check("publicNameFor says so plainly", publicNameFor(ana, { iracingIds }), null);

// ── 5. The fallback chain, in order ────────────────────────────────────────
const bare = { id: "d-bare", name: "Sam Okafor", aliases: [{ label: "iRacing Name", value: "Sam Okafor" }] };
check("a linked account's name stands in",
  publicNameFor(bare, { accountName: "SamO", iracingIds }), "SamO");
check("a pool name that isn't the iRacing one is fine",
  publicNameFor({ name: "Kai", aliases: [{ label: "iRacing Name", value: "Kai Tanaka" }] }, { iracingIds }), "Kai");
check("the game's own name leads when there is one",
  publicNameFor(ryan, { gameId: "g-beam", iracingIds }), "Ryanbirdman");

// ── 6. Handing the document to somebody who may not see it ─────────────────
const shown = publicDriverDoc(ryan, { iracingIds });
check("the name is replaced, not blanked", shown.name, "Ryanbirdman");
check("iRacing aliases are gone", shown.aliases.map(a => a.label), ["Discord Name"]);
check("the iRacing game name is gone", shown.game_names.map(g => g.game_id), ["g-beam"]);
check("a former name that is the real name is gone", shown.merged_names, ["Ryan M"]);
check("the driver is still the same driver", shown.id, ryan.id);
check("and still linked to the same account", shown.user_id, ryan.user_id);
ok("a driver with no iRacing identity is handed back untouched",
  publicDriverDoc({ id: "d-x", name: "Pat" }, { iracingIds }).name === "Pat");

// ── 7. Search must not surface a profile through the real name ─────────────
const pool = [ryan, ana, jo];
check("an unprivileged search finds nobody by their iRacing name",
  searchDrivers(pool, "Ryan Maynard", { games: { "g-ir": "iRacing", "g-beam": "BeamNG" } }).length, 0);
check("the same search inside iRacing does find them",
  searchDrivers(pool, "Ryan Maynard", { games: { "g-ir": "iRacing" }, gameId: "g-ir" }).map(h => h.driver.id),
  ["d-ryan"]);
check("and so does a staff screen",
  searchDrivers(pool, "Ryan Maynard", { games: { "g-ir": "iRacing" }, privileged: true }).map(h => h.driver.id),
  ["d-ryan"]);
check("his BeamNG name still finds him",
  searchDrivers(pool, "ryanbird", { games: { "g-beam": "BeamNG" } }).map(h => h.driver.id), ["d-ryan"]);
check("visibleNames drops only the iRacing ones",
  visibleNames(ryan, { games: { "g-ir": "iRacing", "g-beam": "BeamNG" } }).map(r => r.value),
  ["Ryanbirdman", "ryanb", "Ryan M"]);

// A refusal is a disclosure. "There's already a driver called X (their iRacing
// Name is “Y”)" hands a stranger both the name and the fact it is this person's.
const iracingHit = { name: "Ryan Maynard", public_name: "Ryanbirdman", via: { source: "alias", label: "iRacing Name", value: "Ryan Maynard", iracing: true }, confidence: "exact" };
check("a clash through an iRacing name quotes nothing", matchReason(iracingHit), "a name already on file");
check("staff still get the real reason", matchReason(iracingHit, { privileged: true }), "their iRacing Name is “Ryan Maynard”");
check("and the driver is named safely", matchedName(iracingHit), "Ryanbirdman");
check("staff see the stored name", matchedName(iracingHit, true), "Ryan Maynard");
const plainHit = { name: "Ana Ruiz", public_name: "Ana Ruiz", via: { source: "name", value: "Ana Ruiz", iracing: false }, confidence: "exact" };
check("an ordinary clash is unchanged", matchReason(plainHit), "same name");

// ── 8. End to end, over a league bundle ────────────────────────────────────
//
// The shape every table on the site is computed from. Ryan has raced a BeamNG
// season and an iRacing one, and his entries carry the denormalized copy of his
// overall name — the real one — which is the leak this has to close.
const bundle = {
  games,
  drivers: [ryan, ana],
  account_names: {},
  seasons: [
    { id: "s-beam", game_id: "g-beam" },
    { id: "s-ir", game_id: "g-ir" },
  ],
  entries: [
    { id: "e1", season_id: "s-beam", driver_id: "d-ryan", name: "Ryan Maynard" },
    { id: "e2", season_id: "s-ir", driver_id: "d-ryan", name: "Ryan Maynard" },
    { id: "e3", season_id: "s-ir", driver_id: "d-ana", name: "Ana Ruiz" },
  ],
};

const onBeam = driverNames(bundle, ["d-ryan"], "g-beam")["d-ryan"];
check("a BeamNG table names him by his handle", onBeam.display, "Ryanbirdman");
check("and the line under it too", onBeam.overall, "Ryanbirdman");
const onIracing = driverNames(bundle, ["d-ryan"], "g-ir")["d-ryan"];
check("an iRacing table names him as iRacing does", onIracing.display, "Ryan Maynard");

// The stored entry name is recognised for what it is, so a fallback path can
// stand something else in — and left alone everywhere it is legitimate.
ok("a BeamNG entry's stored name is flagged", hiddenName(bundle, "d-ryan", "Ryan Maynard", "g-beam"));
ok("an iRacing entry's is not", !hiddenName(bundle, "d-ryan", "Ryan Maynard", "g-ir"));
ok("nor is a gamertag", !hiddenName(bundle, "d-ryan", "Ryanbirdman", "g-beam"));

// Ana races iRacing alone, so the bundle sees that and leaves her be — league
// wide, which is the context that would otherwise blank her.
check("Ana is named on a league-wide table", driverNames(bundle, ["d-ana"], null)["d-ana"].display, "Ana Ruiz");
ok("and her entry's stored name is not flagged", !hiddenName(bundle, "d-ana", "Ana Ruiz", "g-ir"));
// Ryan, who races both, is not.
check("Ryan is not, on the same table", driverNames(bundle, ["d-ryan"], null)["d-ryan"].display, "Ryanbirdman");

// ── 9. No second name under an on-track name, outside iRacing ──────────────
//
// The tables print the driver's handle with their profile name in a small grey
// line beneath it. That line is the leak in its quietest form: on an AMS2 race
// sheet it read as the real name, under the very handle the page exists to show
// instead. So the computes only fill it in on iRacing's own pages, and
// isIracingScope is the gate they all ask.
ok("an iRacing scope is one", isIracingScope(bundle, "g-ir"));
ok("a BeamNG scope is not", !isIracingScope(bundle, "g-beam"));
ok("and neither is a league-wide one", !isIracingScope(bundle, null));

// ── 10. Nothing was unlinked ───────────────────────────────────────────────
//
// The whole rule is a read-time projection. If any of it mutated a document,
// one person's history would split in two — which is the thing this app spends
// lib/driverMatch.js preventing.
check("the driver document is untouched", ryan.name, "Ryan Maynard");
check("its aliases are untouched", ryan.aliases.length, 3);
check("its per-game names are untouched", ryan.game_names.length, 2);
check("its merged names are untouched", ryan.merged_names.length, 2);
check("and both entries still point at one driver",
  bundle.entries.filter(e => e.driver_id === "d-ryan").length, 2);

console.log(`iracingPrivacy: ${n} assertions passed`);
