// The canonical Track Type vocabulary, shared by every form, filter, and
// directory grouping so a type added here shows up everywhere at once.
//
// A track saved with some other value (a one-off from before this list existed)
// still displays and stays selectable while editing — see the "custom" fallback
// option in TrackCreateModal and the Tracks page's type filter — so nothing has
// to be in this list to survive.
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
