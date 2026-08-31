// Driver aliases / connected accounts — the platform usernames one human racer
// uses across games. Stored on the global driver doc (drivers/<id>.aliases) as
// an ordered array of { label, value, game_id } objects, so the set is fully
// extensible: admins can edit values, add custom platforms, remove fields, and
// tie an alias to the specific game it's used in. `game_id` is optional (""/
// null = not tied to any game); when set it lets the Standings/Results tables
// for that game render the on-track name instead of the primary profile name.
// (`label`/`value` are this app's field names for what the spec calls
// platform/username; `game_id` is the mapped_game_id.)
//
// The importer (CSV paste today, any OCR path in future) matches an imported
// name against a driver's primary name AND every alias value — so a GT7 export
// that lists a PSN username still resolves to the right Driver Profile. See
// matchDriver in lib/resultsImport.js.

// The platforms every driver starts with in the edit modal. Kept here (not in
// the component) so both the UI and any server-side seeding agree.
export const DEFAULT_ALIAS_LABELS = [
  "Discord Name",
  "PSN Username",
  "Xbox Gamertag",
  "Steam Username",
  "iRacing Name",
  "iRacing ID#",
];

// Coerce whatever is stored (or missing) into a clean
// [{label, value, game_id, is_display}] array. `game_id` is preserved when
// present (the game an alias is used in); empty string means "not tied to a
// game". `is_display` marks, among several aliases mapped to the SAME game
// (e.g. an iRacing Name and an iRacing ID#), which one is the on-track display
// name for that game's tables.
export function normalizeAliases(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(a => a && typeof a === "object")
    .map(a => ({
      label: String(a.label ?? "").trim(),
      value: String(a.value ?? "").trim(),
      game_id: String(a.game_id ?? "").trim(),
      is_display: !!a.is_display,
    }))
    .filter(a => a.label);
}

// Merge saved aliases over the default platform list for editing: every default
// label appears once (pre-filled if saved), followed by any custom platforms the
// admin added. This is what the edit modal renders.
export function withDefaults(stored) {
  const saved = normalizeAliases(stored);
  const byLabel = new Map(saved.map(a => [a.label.toLowerCase(), a]));
  const rows = DEFAULT_ALIAS_LABELS.map(label => {
    const hit = byLabel.get(label.toLowerCase());
    return { label, value: hit?.value || "", game_id: hit?.game_id || "", is_display: !!hit?.is_display };
  });
  const defaultsLower = new Set(DEFAULT_ALIAS_LABELS.map(l => l.toLowerCase()));
  for (const a of saved) if (!defaultsLower.has(a.label.toLowerCase())) rows.push(a);
  return rows;
}

// Fold newly-submitted aliases into the ones a driver profile already carries,
// so a platform username typed once during a series sign-up is on the profile
// for good and never has to be typed again (see POST /api/signup-requests).
//
// The rules, in order:
//   • matching is by LABEL, case-insensitively — "psn username" updates the
//     saved "PSN Username" row rather than adding a second one,
//   • a non-empty incoming value wins (they just typed it, so it's current),
//   • a blank incoming value NEVER erases a saved one — a sign-up form that
//     doesn't ask for Xbox mustn't wipe the gamertag on the profile,
//   • a label the profile has never seen is appended, keeping the saved rows in
//     their existing order,
//   • `game_id` / `is_display` are only taken from the incoming row when it
//     actually sets them, so a sign-up can't unmap an alias from its game.
export function mergeAliases(existing, incoming) {
  const rows = normalizeAliases(existing);
  const byLabel = new Map(rows.map((a, i) => [a.label.toLowerCase(), i]));
  const merged = [...rows];
  for (const add of normalizeAliases(incoming)) {
    const at = byLabel.get(add.label.toLowerCase());
    if (at === undefined) {
      // Nothing worth storing in an empty row for a platform they've never used.
      if (!add.value && !add.game_id) continue;
      byLabel.set(add.label.toLowerCase(), merged.length);
      merged.push(add);
      continue;
    }
    merged[at] = {
      ...merged[at],
      value: add.value || merged[at].value,
      game_id: add.game_id || merged[at].game_id,
      is_display: add.is_display || merged[at].is_display,
    };
  }
  return merged;
}

// The non-empty alias value strings — the extra names the importer fuzzy-matches
// against alongside the driver's primary name.
export function aliasValues(stored) {
  return normalizeAliases(stored).map(a => a.value).filter(Boolean);
}

// The username this driver races under in a specific game, or null. Used to
// render the on-track name on game-scoped Standings/Results tables. Among the
// aliases mapped to this game that carry a username, prefer the one explicitly
// marked as the display alias (is_display); otherwise fall back to the first.
export function gameAlias(stored, gameId) {
  if (!gameId) return null;
  const matches = normalizeAliases(stored).filter(a => a.game_id === gameId && a.value);
  if (!matches.length) return null;
  return (matches.find(a => a.is_display) || matches[0]).value;
}

// ── The platform vocabulary ────────────────────────────────────────────────
//
// An alias row used to be two free-hand fields and a dropdown: type a platform,
// type a username, optionally point it at a game. Nothing made the three agree,
// so "iRacing Name" could sit there mapped to BeamNG, and a driver's racing name
// in a game could be entered in two places that disagreed. The editor now offers
// a CHOICE instead, and each choice carries its own game mapping — so the label
// and the game can no longer contradict each other (see components/AliasEditor).

// The platforms that belong to a person rather than to one game. One handle,
// used everywhere, mapped to no game.
export const ACCOUNT_ALIAS_LABELS = [
  "Discord Name",
  "PSN Username",
  "Xbox Gamertag",
  "Steam Username",
];

// Discord is asked for by every sign-up in every game (see lib/signupRequest.js),
// so the driver editor gives it a field of its own rather than a row among the
// rest.
export const DISCORD_ALIAS_LABEL = "Discord Name";

// What a driver's racing name in one game is stored under as an alias. The
// convention is the game's own name plus "Name", which is where the labels this
// app has always shipped come from: the game called "iRacing" gives
// "iRacing Name", exactly the row a sign-up has been filling in all along. That
// is what lets the editor be rebuilt around games without moving a single
// stored value.
export function gameNameLabel(gameName) {
  return `${String(gameName ?? "").trim()} Name`.trim();
}

// Is this alias the racing NAME for a game, as opposed to something else that
// merely belongs to it — an iRacing customer id, say? Only a racing name is
// shown on that game's tables, and only a racing name belongs in the editor's
// per-game name list.
export function isGameRacingName(alias, game) {
  if (!alias || !game || alias.game_id !== game.id) return false;
  return alias.label.trim().toLowerCase() === gameNameLabel(game.name).toLowerCase();
}

// The choices a Platform picker offers: the account platforms, then a "<Game>
// Name" for every game, then anything already stored that neither list covers —
// a custom platform an admin added, or a pairing from before this vocabulary
// existed. Nothing stored is ever dropped from the menu, which is what stops the
// editor quietly unmapping a row it doesn't recognise.
//
// `value` is the (label, game) pair as one string, so a <select> can carry both.
export function aliasPlatformOptions(games = [], aliases = []) {
  const out = [];
  const seen = new Set();
  const labels = new Set();
  const gameName = Object.fromEntries(games.map(g => [g.id, g.name]));
  const add = (label, game_id, group) => {
    const value = `${label}|${game_id}`;
    if (!label || seen.has(value)) return;
    seen.add(value);
    // Two options can carry the same words with different mappings — a saved
    // "iRacing Name" tied to no game beside the one this league's iRacing game
    // offers. Spelling out which is which beats a menu with the same line twice.
    const clash = labels.has(label.toLowerCase());
    labels.add(label.toLowerCase());
    const text = clash
      ? `${label} — ${game_id ? (gameName[game_id] || "a game") : "no game"}`
      : label;
    out.push({ value, label, game_id, group, text });
  };

  for (const label of ACCOUNT_ALIAS_LABELS) add(label, "", "Accounts");
  for (const g of games) {
    add(gameNameLabel(g.name), g.id, "Games");
    // The one per-game identity that isn't a name. It is an iRacing rule rather
    // than a general one, so it is offered only where iRacing is.
    if (/iracing/.test(String(g.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      add("iRacing ID#", g.id, "Games");
    }
  }
  for (const a of normalizeAliases(aliases)) add(a.label, a.game_id, "Saved");
  return out;
}

// Read one labelled alias's value — how the editor lifts Discord out into its
// own field.
export function aliasValue(aliases, label) {
  const key = String(label).trim().toLowerCase();
  const hit = normalizeAliases(aliases).find(a => a.label.trim().toLowerCase() === key);
  return hit ? hit.value : "";
}

// Write one back, in place if it is already there and appended if it is not.
// A blank value empties the row rather than deleting it, matching how every
// other alias field behaves.
export function setAliasValue(aliases, label, value) {
  const key = String(label).trim().toLowerCase();
  const rows = normalizeAliases(aliases);
  const at = rows.findIndex(a => a.label.trim().toLowerCase() === key);
  const v = String(value ?? "").trim();
  if (at >= 0) return rows.map((a, i) => (i === at ? { ...a, value: v } : a));
  return v ? [...rows, { label, value: v, game_id: "", is_display: false }] : rows;
}

// Keep each game's racing-name alias in step with the name set for that game.
//
// The editor shows ONE field per game, because a driver has one racing name per
// game and two boxes that could disagree is the confusion this replaces. That
// field is stored as the per-game display name (drivers/<id>.game_names); this
// carries the same value onto the matching alias, so the two can never drift
// apart no matter which of them an older screen or an import wrote.
//
// One rule, both directions: a game with a name row gets that name, and a game
// whose row was removed gets an empty one — removing the row is an instruction
// to stop showing that name, and leaving the alias behind would put it straight
// back on the next edit.
//
// It never CREATES a row (the importer already matches per-game display names,
// so a new one would buy nothing) and it never DELETES one: the label and its
// game mapping survive an emptied value, so the row is still there to type back
// into, and nothing else on the profile is touched.
export function syncGameNameAliases(aliases, gameNames, games = []) {
  const byId = Object.fromEntries(games.map(g => [g.id, g]));
  const nameFor = Object.fromEntries(
    (gameNames || []).filter(g => g?.game_id && g?.name).map(g => [g.game_id, String(g.name).trim()]));
  return normalizeAliases(aliases).map(a => {
    const game = byId[a.game_id];
    if (!game || !isGameRacingName(a, game)) return a;
    return { ...a, value: nameFor[a.game_id] || "" };
  });
}
