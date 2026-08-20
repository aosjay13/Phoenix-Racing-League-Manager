// Module resolution for the CPU profiler, on top of the same "@/…" and "next/…"
// rules the unit suites use (see lib/__tests__/alias-hooks.mjs).
//
// The one addition: "@/lib/firebase" resolves to the in-memory double instead
// of the real Firebase Admin SDK. Every route reaches Firestore and Auth
// through that single module, so redirecting it is all it takes to run a real
// handler — its own code, unmodified — with no credentials and no network.
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const NEXT_ROOT = path.join(appRoot, "node_modules", "next");
const FAKE_FIREBASE = pathToFileURL(path.join(here, "fake-firestore.mjs")).href;

function nextSubpathFile(specifier) {
  if (!specifier.startsWith("next/") || path.extname(specifier)) return null;
  const file = path.join(NEXT_ROOT, `${specifier.slice("next/".length)}.js`);
  return existsSync(file) ? file : null;
}

export function resolve(specifier, context, next) {
  if (specifier === "@/lib/firebase" || specifier.endsWith("/lib/firebase.js")) {
    return { url: FAKE_FIREBASE, shortCircuit: true, format: "module" };
  }
  const nextFile = nextSubpathFile(specifier);
  if (nextFile) return next(pathToFileURL(nextFile).href, context);
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const target = path.join(appRoot, specifier.slice(2));
  const withExt = path.extname(target) ? target : `${target}.js`;
  return next(pathToFileURL(withExt).href, context);
}
