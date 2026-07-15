import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

// Normalize the private key regardless of how the host stored it. Vercel's
// env-var UI (especially bulk paste) can keep surrounding quotes and/or leave
// newlines escaped as literal "\n", either of which breaks cert().
function normalizePrivateKey(raw) {
  if (!raw) return raw;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

function init() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
  });
}

export function db() {
  init();
  return getFirestore();
}

export function adminAuth() {
  init();
  return getAuth();
}

export function bucket() {
  init();
  return getStorage().bucket();
}
