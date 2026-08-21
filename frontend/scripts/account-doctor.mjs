// Look at (and if need be, repair) one Firebase Auth account — when nobody can
// get in through the app at all.
//
//   node scripts/account-doctor.mjs --list                          every account
//   node scripts/account-doctor.mjs you@example.com                 inspect only
//   node scripts/account-doctor.mjs you@example.com --set-password  set a new one
//   node scripts/account-doctor.mjs you@example.com --verify        mark verified
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The app already has two ways back in and neither covers every lockout:
//
//   • /recover (OWNER_RECOVERY_CODE) marks an account verified and makes it
//     Owner — but it does NOT set a password, so it cannot help when the
//     password itself is being rejected.
//   • /api/auth/reset-password resets a password with no email involved — but
//     only for somebody who set a recovery passphrase BEFORE they were locked
//     out.
//
// This covers the remaining case, and it works because whoever runs it holds
// the service-account key, which is a stronger proof of ownership than either.
// No email, no console, no inbox.
//
// It reads and it grants. It never deletes an account, never touches another
// one, and never changes a role — a locked-out owner needs a way in, not a
// tool that can quietly take somebody else's access away.
import { readFileSync } from "fs";
import { createInterface } from "node:readline/promises";

const [email, ...flags] = process.argv.slice(2);
const listing = email === "--list";
if (!listing && (!email || !email.includes("@"))) {
  console.error("Usage: node scripts/account-doctor.mjs <email> [--set-password] [--verify]");
  console.error("       node scripts/account-doctor.mjs --list");
  process.exit(1);
}

// Same env loading as the other scripts here. Populate .env.local first with:
//   npx vercel env pull .env.local
let loaded = false;
for (const name of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${name}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
    loaded = true;
    break;
  } catch { /* try the next one */ }
}
if (!loaded && !process.env.FIREBASE_PROJECT_ID) {
  console.error("✗ No .env.local found and FIREBASE_PROJECT_ID isn't set.");
  console.error("  From frontend/:  npx vercel env pull .env.local");
  process.exit(1);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");

function normalizePrivateKey(raw) {
  let key = String(raw || "").trim();
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
const auth = getAuth();

// Which address did you actually sign up with? Worth answering before assuming
// the password is wrong.
if (listing) {
  const rows = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    rows.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  rows.sort((a, b) => String(a.metadata.creationTime).localeCompare(String(b.metadata.creationTime)));
  console.log(`\n${rows.length} account(s):\n`);
  for (const u of rows) {
    const marks = [
      u.disabled ? "DISABLED" : null,
      u.emailVerified ? null : "unverified",
      u.providerData.some(p => p.providerId === "password") ? null : "no-password",
    ].filter(Boolean).join(" ");
    console.log(`  ${String(u.email || "(no email)").padEnd(38)} ${marks}`);
  }
  console.log();
  process.exit(0);
}

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  if (err.code === "auth/user-not-found") {
    // The single most useful thing this script can tell you: "wrong password"
    // and "there is no such account" look identical from the sign-in form, and
    // they have completely different fixes.
    console.error(`\n✗ No Firebase Auth account exists for ${email}.`);
    console.error("  So the password was never the problem — there is nothing to sign in to.");
    console.error("  Check for a typo, or a different address than you remember signing up with.");
    console.error("  Listing every account:  node scripts/account-doctor.mjs --list\n");
    process.exit(1);
  }
  throw err;
}

const providers = user.providerData.map(p => p.providerId).join(", ") || "(none)";
console.log(`\nAccount: ${user.email}`);
console.log(`  uid              ${user.uid}`);
console.log(`  disabled         ${user.disabled ? "YES — this alone blocks sign-in" : "no"}`);
console.log(`  email verified   ${user.emailVerified ? "yes" : "NO — the app's verification wall will block this account"}`);
console.log(`  sign-in methods  ${providers}`);
if (!providers.includes("password")) {
  console.log("  ⚠ No password provider on this account, so an email + password sign-in");
  console.log("    cannot succeed no matter what the password is. --set-password fixes that.");
}
console.log(`  created          ${user.metadata.creationTime}`);
console.log(`  last sign-in     ${user.metadata.lastSignInTime || "never"}`);

if (flags.includes("--verify") && !user.emailVerified) {
  await auth.updateUser(user.uid, { emailVerified: true });
  console.log("\n✓ Marked email-verified.");
}

if (flags.includes("--set-password")) {
  // Read from stdin rather than argv so the new password never lands in shell
  // history or a process listing.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("\nNew password (min 6 chars, not echoed by your shell history): ");
  rl.close();
  if (String(pw).length < 6) {
    console.error("✗ Firebase requires at least 6 characters. Nothing changed.");
    process.exit(1);
  }
  await auth.updateUser(user.uid, { password: String(pw) });
  console.log("✓ Password set. Sign in with it now, then change it in the app.");
}

if (!flags.length) console.log("\n(Read-only. Add --set-password and/or --verify to change anything.)\n");
