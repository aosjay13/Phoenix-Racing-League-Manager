// node scripts/delete-race-session.mjs <raceId> <session> [session_type] [--commit]
// Deletes all result docs for one (race, session[, session_type]). Dry-run by
// default — prints what it WOULD delete; pass --commit to actually delete.
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

const [raceId, session, maybeType] = process.argv.slice(2);
const commit = process.argv.includes("--commit");
const sessionType = maybeType && maybeType !== "--commit" ? maybeType : null;
if (!raceId || session === undefined) {
  console.error("usage: node scripts/delete-race-session.mjs <raceId> <session> [session_type] [--commit]");
  process.exit(1);
}

const snap = await db.collection("results").where("race_id", "==", raceId).get();
const targets = snap.docs.filter(d => {
  const x = d.data();
  if (String(x.session ?? "") !== session) return false;
  if (sessionType && (x.session_type || "race") !== sessionType) return false;
  return true;
});

console.log(`Race ${raceId} — session "${session}"${sessionType ? ` type=${sessionType}` : ""}: ${targets.length} result doc(s) matched.`);
for (const d of targets) {
  const x = d.data();
  console.log(`  ${commit ? "DELETE" : "would delete"} ${d.id}  pos=${x.finish_pos ?? "?"} type=${x.session_type || "race"} created=${(x.created_at||"").slice(0,19)}`);
}
if (!targets.length) { process.exit(0); }
if (!commit) { console.log("\nDRY RUN — re-run with --commit to delete."); process.exit(0); }

for (let i = 0; i < targets.length; i += 450) {
  const batch = db.batch();
  targets.slice(i, i + 450).forEach(d => batch.delete(d.ref));
  await batch.commit();
}
console.log(`\nDeleted ${targets.length} result doc(s).`);
process.exit(0);
