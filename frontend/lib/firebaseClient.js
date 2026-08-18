"use client";

import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

// The three client-side variables Firebase Auth needs, and the env var each one
// comes from. Kept as a map rather than three reads so a missing one can be
// NAMED when something fails — see missingFirebaseConfig below.
//
// These are NEXT_PUBLIC_*, which means Next inlines them into the bundle AT
// BUILD TIME. That is the trap: a deploy whose build environment was missing one
// produces a bundle with `undefined` baked in, and nothing about the running app
// says so. `initializeApp` accepts the broken config happily; every auth call
// then fails, at the point of use, with a Firebase error that reads like a
// problem with whatever the user was doing rather than with the deploy.
export const FIREBASE_CONFIG_VARS = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
};

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// Which of the three are missing from THIS BUILD, by env var name. Empty means
// the client is configured. Screens that depend on Firebase Auth actually
// working — the sign-in form above all — render this rather than letting a
// misconfigured deploy present itself as a broken password.
//
// `authDomain` is the one worth staring at when password reset misbehaves: it is
// the host Firebase builds the reset link against and serves the action handler
// from, so a wrong or absent value produces mail that never arrives or links
// that land nowhere.
export function missingFirebaseConfig() {
  return Object.entries(FIREBASE_CONFIG_VARS)
    .filter(([key]) => !String(config[key] ?? "").trim())
    .map(([, envVar]) => envVar);
}

// Local development against the Firebase Emulator Suite. Set
// NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST (e.g. "127.0.0.1:9099") in
// .env.local and sign-in goes to the emulator instead of the real project —
// the same switch the Admin SDK reads from FIREBASE_AUTH_EMULATOR_HOST on the
// server, so both halves of a request talk to the same fake.
//
// Unset in every deployed environment, which is what keeps this out of the way
// in production: with no host configured the app connects to Firebase exactly
// as it always has.
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;

// Emails the emulator "sends" are printed to its own log and never leave the
// machine, so a password reset tested against it will never arrive in an inbox.
// Worth saying out loud, since that looks exactly like the bug it isn't.
export function usingAuthEmulator() {
  return !!emulatorHost;
}

let warned = false;

export function clientAuth() {
  // Said once, loudly, the first time anything asks for auth. A build missing a
  // variable is a deploy problem, and the console is where somebody debugging
  // "the emails don't send" will actually look.
  if (!warned && typeof window !== "undefined") {
    warned = true;
    const missing = missingFirebaseConfig();
    if (missing.length) {
      console.error(
        `[firebase] Auth is misconfigured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} `
        + "missing from this build. NEXT_PUBLIC_* variables are inlined at build time, so setting them "
        + "now requires a REBUILD, not just a restart. Sign-in, sign-up and password reset will all fail "
        + "until this is fixed.",
      );
    } else if (emulatorHost) {
      console.warn(
        `[firebase] Using the Auth emulator at ${emulatorHost}. Password reset and verification emails `
        + "are printed to the emulator's log and are never actually delivered.",
      );
    }
  }
  const fresh = !getApps().length;
  const app = fresh ? initializeApp(config) : getApps()[0];
  const auth = getAuth(app);
  // Only on the first initialization: connectAuthEmulator throws if it's
  // called again once the instance has been used.
  if (fresh && emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
  }
  return auth;
}
