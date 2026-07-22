// One-time diagnostic — run from frontend/ with:
//   node scripts/find-track-races.mjs "USA International Raceway"
// Lists every race doc that matches the given track (by track_id resolved from
// the tracks collection, or by exact/loose track NAME), plus whether its
// season still exists and how many result docs hang off it. Read-only.
import { readFileSync } from "fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
function normalizePrivateKey(raw) {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  return key.replace(/\\n/g, "\n");
}
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  }),
});
const db = getFirestore();

const wanted = (process.argv[2] || "USA International Raceway").trim();
const wantedLc = wanted.toLowerCase();

const [racesSnap, seasonsSnap, tracksSnap, resultsSnap] = await Promise.all([
  db.collection("races").get(),
  db.collection("seasons").get(),
  db.collection("tracks").get(),
  db.collection("results").get(),
]);

const seasonsById = Object.fromEntries(seasonsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
const trackIds = new Set(
  tracksSnap.docs.filter(d => String(d.data().name || "").trim().toLowerCase() === wantedLc).map(d => d.id)
);
const resultsByRace = {};
for (const d of resultsSnap.docs) {
  const rid = d.data().race_id;
  resultsByRace[rid] = (resultsByRace[rid] || 0) + 1;
}

console.log(`Tracks named "${wanted}": ${[...trackIds].join(", ") || "(none)"}\n`);

const matches = racesSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(r =>
    (r.track_id && trackIds.has(r.track_id)) ||
    String(r.track || "").trim().toLowerCase() === wantedLc
  );

if (!matches.length) { console.log("No race docs match that track."); process.exit(0); }

for (const r of matches) {
  const season = seasonsById[r.season_id];
  console.log("─".repeat(60));
  console.log("race id     :", r.id);
  console.log("name        :", JSON.stringify(r.name));
  console.log("round       :", r.round_number ?? "(none)");
  console.log("track (name):", JSON.stringify(r.track ?? null), "  track_id:", r.track_id ?? "(none)");
  console.log("season_id   :", r.season_id ?? "(none)",
    season ? `→ EXISTS: ${JSON.stringify(season.name)}` : "→ ⚠️  SEASON MISSING (orphan)");
  console.log("results     :", resultsByRace[r.id] || 0, "docs");
}
console.log("─".repeat(60));
console.log(`\n${matches.length} race doc(s) matched.`);
process.exit(0);
