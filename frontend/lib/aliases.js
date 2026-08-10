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
