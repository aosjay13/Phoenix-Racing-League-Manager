// The canonical Track Type vocabulary, shared by every form, filter, and
// directory grouping so a type added here shows up everywhere at once.
//
// Dirt racing is split into two surfaces — "Dirt Oval" and "Dirt Road Course" —
// replacing the old catch-all "Dirt". Existing tracks saved as "Dirt" are
// migrated to "Dirt Oval" by POST /api/admin/tracks/migrate-types (surfaced as
// an admin button on the Tracks directory); until that runs, LEGACY_TRACK_TYPES
// keeps those venues rendering under a readable heading instead of vanishing
// from the type filter.
export const TRACK_TYPES = [
  "Oval",
  "Superspeedway",
  "Short Track",
  "Road Course",
  "Street Circuit",
  "Dirt Oval",
  "Dirt Road Course",
  "Rallycross",
  "Kart",
];

// Old value → its replacement. Drives both the one-time database migration and
// the "N tracks still need migrating" banner on the Tracks page.
export const LEGACY_TRACK_TYPES = { Dirt: "Dirt Oval" };

// True when a track still carries a retired type value.
export function isLegacyTrackType(type) {
  return !!type && Object.prototype.hasOwnProperty.call(LEGACY_TRACK_TYPES, type);
}
