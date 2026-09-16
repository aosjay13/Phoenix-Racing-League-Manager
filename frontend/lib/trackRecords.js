// Which lap counts as "the record" at a venue, and what it's a record OF.
//
// A lap time is only comparable to another lap in the same context, so a venue
// keeps several records side by side rather than one outright number:
//
//   • Overall — the quickest lap ever turned here, in the scope being viewed.
//   • Per game — a GT7 lap and an iRacing lap around the same circuit are not
//     the same record.
//   • Per class — nor are a GT3 lap and an LMP2 lap. Without this, whichever
//     class runs the faster car owns the venue's record outright and the slower
//     class has none of its own.
//
// Class records key on the class NAME, not its id: a class doc belongs to one
// season, so "GT3" in Season 3 and "GT3" in Season 4 are different ids for the
// same category, while a venue's history spans seasons. Name is the only
// identity that survives that.
//
// Kept dependency-free so the keying rules can be exercised on their own —
// lib/trackCompute.js applies it, over the raw bundle the venue page holds.

// The composite key a lap is filed under for a given breakdown. Returns null
// when the lap doesn't belong in that breakdown at all: a lap with no game, or
// an unclassified lap (a season without classes would otherwise produce an
// "Unclassified" row duplicating the game's own record).
export function gameRecordKey({ gameId }) {
  return gameId || null;
}
export function classRecordKey({ gameId, className }) {
  return gameId && className ? `${gameId}|${className}` : null;
}

// File a lap into `map` under `key`, keeping only the fastest. Ties keep the
// lap already held — the first driver to set the time owns the record, which is
// how timing sheets break a dead heat.
//
// A lap of zero seconds is refused outright, however it got here. "0:00.000" is
// what a timing export prints for a driver who never set a time, and it parses
// as cleanly as a real lap does (see lapSeconds in lib/raceTime.js) — but a zero
// filed here would be the record at that venue for ever, since nothing can beat
// it. Callers screen their own laps; this is the last gate before the record
// book, so it refuses one too rather than trusting every future caller to.
export function keepFastest(map, key, lap) {
  if (!key || !lap || !(lap.seconds > 0)) return map;
  const held = map[key];
  if (held == null || lap.seconds < held.seconds) map[key] = lap;
  return map;
}
