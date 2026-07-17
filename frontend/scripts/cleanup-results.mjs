// One-time cleanup — run from frontend/ with: node scripts/cleanup-results.mjs
//  1. Delete result docs orphaned by past race deletions (race doc gone).
//  2. Where one (race, session name) holds result sets saved under multiple
//     session_types (pre-fix duplicate bug), keep the newest set only.
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
const [resultsSnap, racesSnap] = await Promise.all([
  db.collection("results").get(),
  db.collection("races").get(),
]);
const raceIds = new Set(racesSnap.docs.map(d => d.id));
const batch = db.batch();
let deleted = 0;

// 1. Orphans
for (const d of resultsSnap.docs) {
  const r = d.data();
  if (!raceIds.has(r.race_id)) {
    console.log("DELETE orphan (race gone):", d.id, "race_id:", JSON.stringify(r.race_id ?? null));
    batch.delete(d.ref);
    deleted++;
  }
}

// 2. Duplicate-type session sets
const groups = {};
for (const d of resultsSnap.docs) {
  const r = d.data();
  if (!raceIds.has(r.race_id)) continue;
  if ((r.session_type || "race") === "qualifying") continue;
  const key = `${r.race_id}|${r.session ?? ""}`;
  (groups[key] ??= []).push({ ref: d.ref, id: d.id, ...r });
}
for (const [key, rows] of Object.entries(groups)) {
  const types = new Set(rows.map(r => r.session_type || "race"));
  if (types.size < 2) continue;
  const newest = rows.reduce((a, b) => ((a.created_at || "") >= (b.created_at || "") ? a : b));
  const keepType = newest.session_type || "race";
  for (const r of rows) {
    if ((r.session_type || "race") !== keepType) {
      console.log("DELETE stale dup:", key, "type", r.session_type || "race", "pos", r.finish_pos, r.id);
      batch.delete(r.ref);
      deleted++;
    }
  }
  console.log("KEEP:", key, "type", keepType);
}
if (deleted) await batch.commit();
console.log(`\nDeleted ${deleted} result docs.`);
