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

// Coerce whatever is stored (or missing) into a clean [{label, value, game_id}]
// array. `game_id` is preserved when present (the game an alias is used in);
// empty string means "not tied to a game".
export function normalizeAliases(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(a => a && typeof a === "object")
    .map(a => ({
      label: String(a.label ?? "").trim(),
      value: String(a.value ?? "").trim(),
      game_id: String(a.game_id ?? "").trim(),
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
    return { label, value: hit?.value || "", game_id: hit?.game_id || "" };
  });
  const defaultsLower = new Set(DEFAULT_ALIAS_LABELS.map(l => l.toLowerCase()));
  for (const a of saved) if (!defaultsLower.has(a.label.toLowerCase())) rows.push(a);
  return rows;
}

// The non-empty alias value strings — the extra names the importer fuzzy-matches
// against alongside the driver's primary name.
export function aliasValues(stored) {
  return normalizeAliases(stored).map(a => a.value).filter(Boolean);
}

// The username this driver races under in a specific game, or null. Used to
// render the on-track name on game-scoped Standings/Results tables. Picks the
// first alias whose game_id matches AND that carries an actual username.
export function gameAlias(stored, gameId) {
  if (!gameId) return null;
  const hit = normalizeAliases(stored).find(a => a.game_id === gameId && a.value);
  return hit ? hit.value : null;
}
