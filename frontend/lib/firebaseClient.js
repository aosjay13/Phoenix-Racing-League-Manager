"use client";

import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

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

export function clientAuth() {
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
