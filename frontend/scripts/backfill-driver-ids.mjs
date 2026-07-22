// One-time / idempotent backfill — run from frontend/ with:
//   node scripts/backfill-driver-ids.mjs            (applies changes)
//   node scripts/backfill-driver-ids.mjs --dry-run  (reports only)
//
// Some season entries predate `driver_id` (every entry should carry one — it's
// the global identity that makes a driver's name link to their profile on the
// Standings/Stats/Team/Track pages; see lib/driverPool.js ensureDriverId).
// This links every entry that's missing a driver_id to its EXISTING pool
// driver, matched the same way ensureDriverId does: linked account (user_id)
// first, then case-insensitive name. It never creates new pool docs — an entry
// with no pool match is reported and left untouched, so it can be reviewed by
// hand rather than silently spawning a duplicate identity.
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
const dryRun = process.argv.includes("--dry-run");

const pool = (await db.collection("drivers").get()).docs.map(d => ({ id: d.id, ...d.data() }));
const poolByUser = new Map(pool.filter(p => p.user_id).map(p => [p.user_id, p]));
const poolByName = new Map();
for (const p of pool) {
  const k = String(p.name || "").trim().toLowerCase();
  if (k && !poolByName.has(k)) poolByName.set(k, p); // first wins on duplicate names
}

const entries = (await db.collection("entries").get()).docs.map(d => ({ id: d.id, ...d.data() }));
const missing = entries.filter(e => !e.driver_id);

const updates = [];
const unmatched = [];
for (const e of missing) {
  let match = null;
  if (e.user_id && poolByUser.has(e.user_id)) match = poolByUser.get(e.user_id);
  else {
    const k = String(e.name || "").trim().toLowerCase();
    if (k && poolByName.has(k)) match = poolByName.get(k);
  }
  if (match) updates.push({ id: e.id, name: e.name, driver_id: match.id });
  else unmatched.push(e);
}

console.log(`Entries: ${entries.length} | missing driver_id: ${missing.length} | linkable: ${updates.length} | no pool match: ${unmatched.length}`);
for (const u of updates) console.log(`  ${dryRun ? "WOULD LINK" : "LINK"} "${u.name}" (entry ${u.id}) → driver_id ${u.driver_id}`);
for (const e of unmatched) console.log(`  SKIP (no pool driver) "${e.name}" (entry ${e.id}, season ${e.season_id})`);

if (!dryRun && updates.length) {
  const batch = db.batch();
  for (const u of updates) batch.update(db.collection("entries").doc(u.id), { driver_id: u.driver_id });
  await batch.commit();
  console.log(`\nLinked ${updates.length} entries.`);
} else if (dryRun) {
  console.log("\nDry run — no changes written.");
}
process.exit(0);
