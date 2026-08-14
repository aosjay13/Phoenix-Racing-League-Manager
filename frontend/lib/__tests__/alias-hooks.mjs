// Resolves the app's "@/…" import alias (jsconfig.json paths) for plain `node`,
// so the scoring modules can be unit-tested without booting Next.
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Bundler-style specifiers carry no file extension; Node's ESM resolver wants
// one, so add .js when the alias points at a module that has it.
//
// The same rule covers Next's own subpaths — "next/server", "next/link",
// "next/navigation". Every one is a plain file (node_modules/next/server.js)
// with no "exports" map to redirect it, so a bundler finds it by extension
// guessing and bare `node` does not. Without this, no test could import a
// module that so much as mentions NextResponse or <Link>, which put
// lib/entityApi.js — the field allowlist deciding what League Setup is
// actually able to save — permanently out of reach of the suite, along with
// every component that links anywhere. Resolved by looking for the file rather
// than from a list, so the next subpath somebody imports needs no change here.
const NEXT_ROOT = path.join(appRoot, "node_modules", "next");

function nextSubpathFile(specifier) {
  if (!specifier.startsWith("next/") || path.extname(specifier)) return null;
  const file = path.join(NEXT_ROOT, `${specifier.slice("next/".length)}.js`);
  return existsSync(file) ? file : null;
}

export function resolve(specifier, context, next) {
  const nextFile = nextSubpathFile(specifier);
  if (nextFile) return next(pathToFileURL(nextFile).href, context);
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const target = path.join(appRoot, specifier.slice(2));
  const withExt = path.extname(target) ? target : `${target}.js`;
  return next(pathToFileURL(withExt).href, context);
}
