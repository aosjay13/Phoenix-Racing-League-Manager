import { gameAlias } from "@/lib/aliases";

// Display names, per context. One human racer can want to be shown under a
// different name depending on WHERE they're being shown:
//
//   • Overall  — the name on the driver directory, their profile, league-wide
//                stats and records. Stored as `drivers/<id>.display_name`; when
//                blank it falls back to a linked account's display_name, then to
//                the pool driver's own `name`.
//   • Per game — the name on anything scoped to one game: that game's
//                standings, results, stats, records, skill ratings and roster.
//                Stored as `drivers/<id>.game_names` — [{ game_id, name }] — and
//                falling back to the game-mapped alias (see lib/aliases.js) for
//                data written before this field existed.
//
// So "Ryan Maynard" can be the overall name while BeamNG shows "Ryanbirdman",
// with neither one touching the other. Every surface resolves names through
// this module so they can't drift apart.

// Coerce whatever is stored (or missing) into a clean [{ game_id, name }]
// array. Rows without both halves are meaningless and are dropped.
export function normalizeGameNames(stored) {
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  return stored
    .filter(g => g && typeof g === "object")
    .map(g => ({ game_id: String(g.game_id ?? "").trim(), name: String(g.name ?? "").trim() }))
    .filter(g => {
      if (!g.game_id || !g.name || seen.has(g.game_id)) return false;
      seen.add(g.game_id); // one display name per game — the first wins
      return true;
    });
}

// The driver's overall display name: their explicit override, else the linked
// account's display name, else the pool driver's own name.
export function overallNameFor(driver, accountName = null) {
  return (
    String(driver?.display_name ?? "").trim() ||
    String(accountName ?? "").trim() ||
    String(driver?.name ?? "").trim() ||
    null
  );
}

// Every display name this driver goes by — the overall override plus each
// per-game name. The Smart Importer matches imported names against these too,
// so a BeamNG export listing "Ryanbirdman" still resolves to the right Driver
// Profile even when that name was only ever set as a display name.
export function displayNameValues(driver) {
  return [
    String(driver?.display_name ?? "").trim(),
    ...normalizeGameNames(driver?.game_names).map(g => g.name),
  ].filter(Boolean);
}

// The name this driver races under in one game, or null when they've set none.
// An explicit per-game display name wins; otherwise fall back to the alias
// mapped to that game (the older way of expressing the same thing).
export function gameNameFor(driver, gameId) {
  if (!driver || !gameId) return null;
  const hit = normalizeGameNames(driver.game_names).find(g => g.game_id === gameId);
  return hit ? hit.name : gameAlias(driver.aliases, gameId);
}
