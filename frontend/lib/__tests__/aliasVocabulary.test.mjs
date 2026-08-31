// The driver editor's platform vocabulary.
//
// The Edit Driver dialog used to ask for a driver's name in a game in two
// places at once — a per-game display name, and an alias with a free-typed
// platform and a separate game dropdown — and nothing made the two agree. You
// could label a row "iRacing Name" and point it at BeamNG. You could set an
// iRacing display name of "Ryanbirdman" while the iRacing alias said "Ryan
// Maynard". Both were reachable, and results and standings read different ones.
//
// So the platform is a CHOICE that carries its own game, and a game's racing
// name is asked for once. This file is what that must not cost:
//
//   1. the choices offered cover the league's games AND everything already
//      stored, so opening the editor can never unmap a row it doesn't
//      recognise;
//   2. a game's name and its alias end up equal, whichever was edited;
//   3. nothing is deleted. Not a custom platform, not a former name, not a
//      mapping — an emptied row keeps its label and its game.
import assert from "node:assert";
import {
  ACCOUNT_ALIAS_LABELS, DISCORD_ALIAS_LABEL, aliasPlatformOptions, aliasValue,
  gameNameLabel, isGameRacingName, normalizeAliases, setAliasValue, syncGameNameAliases,
} from "../aliases.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const games = [
  { id: "g-ir", name: "iRacing" },
  { id: "g-beam", name: "BeamNG" },
];

// ── 1. The label convention already matches what is stored ─────────────────
//
// The whole rebuild rests on this: the label a game's racing name is stored
// under is the game's name plus "Name", which is exactly the "iRacing Name" row
// every sign-up has been filling in since long before this editor existed. So
// the new vocabulary describes the old data rather than replacing it.
check("a game's racing name is labelled after the game", gameNameLabel("iRacing"), "iRacing Name");
check("and for any other game the same way", gameNameLabel("BeamNG"), "BeamNG Name");
ok("so a stored iRacing Name is recognised as one",
  isGameRacingName({ label: "iRacing Name", value: "Ryan Maynard", game_id: "g-ir" }, games[0]));
ok("an iRacing customer id is not a racing name",
  !isGameRacingName({ label: "iRacing ID#", value: "812345", game_id: "g-ir" }, games[0]));
ok("and a row pointed at another game is not that game's name",
  !isGameRacingName({ label: "iRacing Name", value: "x", game_id: "g-beam" }, games[0]));

// ── 2. What the picker offers ──────────────────────────────────────────────
const options = aliasPlatformOptions(games, []);
const values = options.map(o => o.value);
ok("every account platform is offered",
  ACCOUNT_ALIAS_LABELS.every(l => values.includes(`${l}|`)));
ok("each game offers its racing name", values.includes("iRacing Name|g-ir") && values.includes("BeamNG Name|g-beam"));
ok("iRacing also offers the customer id", values.includes("iRacing ID#|g-ir"));
ok("but no other game does", !values.includes("BeamNG ID#|g-beam"));
// The label and the game travel as one value, which is what makes them
// impossible to contradict: there is no second control to disagree with.
check("picking a game's name carries the game with it",
  options.find(o => o.value === "iRacing Name|g-ir").game_id, "g-ir");
check("an account platform carries no game",
  options.find(o => o.value === "Discord Name|").game_id, "");

// A platform this app never shipped, saved by an admin who typed it in. It has
// to stay on the menu, or opening the editor and saving would silently unmap it.
const custom = [{ label: "Assetto Server Tag", value: "rb77", game_id: "g-beam", is_display: false }];
ok("a stored custom platform is still offered",
  aliasPlatformOptions(games, custom).some(o => o.value === "Assetto Server Tag|g-beam"));
// And a pairing from before the vocabulary existed — the sign-up form stores an
// iRacing Name mapped to no game at all.
const unmapped = [{ label: "iRacing Name", value: "Ryan Maynard", game_id: "", is_display: false }];
const both = aliasPlatformOptions(games, unmapped);
ok("an unmapped iRacing Name is still selectable", both.some(o => o.value === "iRacing Name|"));
// Two options, same words. The menu says which is which rather than showing the
// same line twice.
check("and is spelled out against the mapped one",
  both.find(o => o.value === "iRacing Name|").text, "iRacing Name — no game");

// ── 3. One name per game, in both places ───────────────────────────────────
const driver = [
  { label: "Discord Name", value: "ryanb", game_id: "", is_display: false },
  { label: "iRacing Name", value: "Ryan Maynard", game_id: "g-ir", is_display: true },
  { label: "iRacing ID#", value: "812345", game_id: "g-ir", is_display: false },
  { label: "Assetto Server Tag", value: "rb77", game_id: "", is_display: false },
];

// The editor asks for the iRacing name once; the alias follows it.
const renamed = syncGameNameAliases(driver, [{ game_id: "g-ir", name: "Ryan M" }], games);
check("the game's alias takes the name set for that game",
  renamed.find(a => a.label === "iRacing Name").value, "Ryan M");
check("the customer id is left alone",
  renamed.find(a => a.label === "iRacing ID#").value, "812345");
check("so is a handle that belongs to no game",
  renamed.find(a => a.label === "Discord Name").value, "ryanb");
check("and so is a custom platform",
  renamed.find(a => a.label === "Assetto Server Tag").value, "rb77");

// Removing the game's row is an instruction to stop showing that name, so the
// alias empties too — otherwise it would put the name straight back next time.
const cleared = syncGameNameAliases(driver, [], games);
check("removing the game row empties the alias",
  cleared.find(a => a.label === "iRacing Name").value, "");
check("but the row itself survives, label and mapping intact",
  cleared.find(a => a.label === "iRacing Name").game_id, "g-ir");
check("nothing is dropped from the list", cleared.length, driver.length);

// A row pointed at a game this league no longer has is not something the sync
// can reason about — it can't tell whether that row is a racing name — so it is
// left exactly as it is rather than emptied on a guess.
const withGhost = [...driver, { label: "Old Sim Name", value: "keepme", game_id: "g-gone", is_display: false }];
check("a row for a game the league no longer has is untouched",
  syncGameNameAliases(withGhost, [], games).find(a => a.label === "Old Sim Name").value, "keepme");

// ── 4. Discord, lifted into its own field and put back ─────────────────────
check("the dedicated field reads the saved handle", aliasValue(driver, DISCORD_ALIAS_LABEL), "ryanb");
check("editing it writes back in place",
  setAliasValue(driver, DISCORD_ALIAS_LABEL, "ryan.b").find(a => a.label === "Discord Name").value, "ryan.b");
check("and adds no second row", setAliasValue(driver, DISCORD_ALIAS_LABEL, "ryan.b").length, driver.length);
check("a driver who had none gets one",
  setAliasValue([], DISCORD_ALIAS_LABEL, "newbie"), [{ label: "Discord Name", value: "newbie", game_id: "", is_display: false }]);
check("and clearing it doesn't invent an empty row", setAliasValue([], DISCORD_ALIAS_LABEL, ""), []);
check("clearing an existing one empties rather than removes",
  setAliasValue(driver, DISCORD_ALIAS_LABEL, "").find(a => a.label === "Discord Name").value, "");

// ── 5. A full round trip loses nothing ─────────────────────────────────────
//
// What a save actually does: Discord back in, then every game's name synced.
// The driver comes out the other side with the same rows, in the same order,
// with the same mappings.
const saved = normalizeAliases(
  syncGameNameAliases(setAliasValue(driver, DISCORD_ALIAS_LABEL, "ryanb"), [{ game_id: "g-ir", name: "Ryan Maynard" }], games));
check("same rows, same order", saved.map(a => a.label), driver.map(a => a.label));
check("same games", saved.map(a => a.game_id), driver.map(a => a.game_id));
check("same values", saved.map(a => a.value), driver.map(a => a.value));
check("and the display flag survives", saved.find(a => a.label === "iRacing Name").is_display, true);

console.log(`aliasVocabulary: ${n} assertions passed`);
