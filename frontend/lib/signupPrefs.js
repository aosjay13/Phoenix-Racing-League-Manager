// What a player has said about each season they COULD join, so the Sign-ups
// badge stops nagging them about series they're never going to enter.
//
// The badge is the reason this exists. It counts what is waiting on the player,
// which is the right rule — but a league running six series means a permanent
// red 6 for somebody who only ever races one of them, and a number that never
// falls to zero is a number people stop reading. Once that happens the badge is
// worse than useless: a real sign-up they DO care about arrives and nothing
// looks any different.
//
// So a player gets to answer each series once, with two different answers:
//
//   MUTED  ("Clear Notification") — keep it in the list, just stop counting it.
//          For the series they might join later and don't want nagging about.
//   HIDDEN ("Not Interested")     — take it out of the list as well, into a
//          section of its own they can reopen any time. Nothing is deleted and
//          nothing is refused: a hidden series can be joined the moment they
//          change their mind, which is why it stays findable rather than gone.
//
// Both are per SEASON, not per series, and both are the player's own — an admin
// never sees them and they change nothing about the sign-up itself.
//
// Pure: the same rules run on the screen, on the badge and in the tests, so the
// number in the sidebar and the list on the page can't disagree about what's
// been silenced.

export const NORMAL = "";
export const MUTED = "muted";
export const HIDDEN = "hidden";

// Anything stored that isn't one of the two real answers means "no answer" —
// a value written by a newer version, or a stray key, must never silently hide
// a series from somebody.
export function seasonPref(prefs, seasonId) {
  const value = prefs?.[seasonId];
  return value === MUTED || value === HIDDEN ? value : NORMAL;
}

export function isHidden(prefs, seasonId) {
  return seasonPref(prefs, seasonId) === HIDDEN;
}

export function isMuted(prefs, seasonId) {
  return seasonPref(prefs, seasonId) === MUTED;
}

// Does this season still put a number on the sidebar? Only if the player hasn't
// answered it either way.
export function countsOnBadge(prefs, seasonId) {
  return seasonPref(prefs, seasonId) === NORMAL;
}

// Split the seasons a player could join into the two lists the screen renders.
//
// `shown` keeps muted seasons: "clear the notification" is a request to stop
// COUNTING it, not to stop showing it — that's the whole difference between the
// two buttons, and folding one into the other would make the pair pointless.
export function partitionJoinable(seasons = [], prefs = {}) {
  const shown = [];
  const notInterested = [];
  for (const s of seasons) {
    (isHidden(prefs, s?.season_id) ? notInterested : shown).push(s);
  }
  return { shown, notInterested };
}

// The ones still allowed to raise the badge.
export function badgeSeasons(seasons = [], prefs = {}) {
  return seasons.filter(s => countsOnBadge(prefs, s?.season_id));
}

// Coerce whatever is stored (or missing) into a clean map. Unknown values are
// dropped rather than kept, so a bad write can't quietly hide a series forever.
export function normalizePrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [seasonId, value] of Object.entries(raw)) {
    if (!seasonId) continue;
    if (value === MUTED || value === HIDDEN) out[String(seasonId).slice(0, 60)] = value;
  }
  return out;
}

// One answer, applied. `NORMAL` removes the key rather than storing an empty
// string, so "I'm interested after all" leaves no trace and the map stays the
// size of the answers actually given.
export function withPref(prefs, seasonId, value) {
  const next = normalizePrefs(prefs);
  const id = String(seasonId ?? "").trim();
  if (!id) return next;
  if (value === MUTED || value === HIDDEN) next[id] = value;
  else delete next[id];
  return next;
}

// What the button in the third slot says. It's the same slot either way, and it
// flips to the undo — a player who silences something must be able to un-silence
// it in the place they silenced it, or the button is a trap.
export function muteButtonLabel(prefs, seasonId) {
  return isMuted(prefs, seasonId) ? "Notify me again" : "Clear Notification";
}

export function muteButtonTitle(prefs, seasonId) {
  return isMuted(prefs, seasonId)
    ? "Start counting this series on the Sign-ups badge again"
    : "Keep this series in the list, but stop counting it on the Sign-ups badge";
}

// "2 series you're not interested in" — the heading on the section they live
// in, which has to read as somewhere they can get them back FROM.
export function notInterestedTitle(rows = []) {
  const n = rows.length;
  if (!n) return "";
  return `${n} series you said you're not interested in`;
}
