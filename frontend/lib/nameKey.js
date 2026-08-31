// Comparison forms of a person's name.
//
// One human writes their own gamertag three different ways in a week —
// "Ryan_Birdman", "ryan birdman", "RyanBirdman" — and every part of this app
// that asks "are these the same name?" has to agree that they are. The two
// forms below are that agreement, and they live in their own leaf module so
// both the duplicate matcher (lib/driverMatch.js) and the name-privacy rules
// (lib/iracingPrivacy.js) can reach them without importing each other.

// Accents folded, case dropped, punctuation turned into single spaces.
// "Müller" === "muller", "Doe,  Jane" === "doe jane".
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The same, minus the spaces — so "Ryan_Birdman", "ryan birdman" and
// "RyanBirdman" are one name.
export function compactName(value) {
  return normalizeName(value).replace(/ /g, "");
}
