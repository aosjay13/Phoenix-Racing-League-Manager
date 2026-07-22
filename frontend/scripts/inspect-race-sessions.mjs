// Read-only — node scripts/inspect-race-sessions.mjs <raceId>
// Groups a race's result docs by (session, session_type) so we can see every
// distinct session recorded on the event and how many rows each holds.
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
initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
}) });
const db = getFirestore();

const raceId = process.argv[2] || "ADJDV6Ql5qIgREKZB5vK";
const raceDoc = await db.collection("races").doc(raceId).get();
console.log("race:", JSON.stringify(raceDoc.data()?.name), "\n");
const r = raceDoc.data() || {};
console.log("heat_format :", r.heat_format ?? "(unset)");
console.log("feature_name:", JSON.stringify(r.feature_name ?? null));
console.log("heats       :", JSON.stringify(r.heats ?? null));
console.log("consolations:", JSON.stringify(r.consolations ?? null));
console.log("sessions    :", JSON.stringify(r.sessions ?? null));
console.log("session_points        :", JSON.stringify(r.session_points ?? null));
console.log("session_stats         :", JSON.stringify(r.session_stats ?? null));
console.log("session_points_enabled:", JSON.stringify(r.session_points_enabled ?? null));

const snap = await db.collection("results").where("race_id", "==", raceId).get();
const groups = {};
for (const d of snap.docs) {
  const x = d.data();
  const key = `${JSON.stringify(x.session ?? null)} | type=${x.session_type || "race"}`;
  (groups[key] ??= []).push(x);
}
console.log("\nSessions recorded in results:");
for (const [key, rows] of Object.entries(groups)) {
  const created = [...new Set(rows.map(r => (r.created_at || "").slice(0, 19)))];
  console.log(`  • ${key}  → ${rows.length} rows   created≈ ${created.join(", ")}`);
}
process.exit(0);
