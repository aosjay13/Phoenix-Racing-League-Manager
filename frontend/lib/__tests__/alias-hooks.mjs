// Resolves the app's "@/…" import alias (jsconfig.json paths) for plain `node`,
// so the scoring modules can be unit-tested without booting Next.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Bundler-style specifiers carry no file extension; Node's ESM resolver wants
// one, so add .js when the alias points at a module that has it.
//
// The same rule covers the handful of Next subpaths the API routes import
// ("next/server"). Those are plain files — node_modules/next/server.js — with
// no "exports" map to redirect them, so a bundler finds them by extension
// guessing and bare `node` does not. Without this, no test could import a
// module that so much as mentions NextResponse, which put lib/entityApi.js —
// the field allowlist deciding what League Setup is actually able to save —
// permanently out of reach of the suite. It isn't out of reach now.
const NODE_MODULES = path.join(appRoot, "node_modules");
const EXTENSIONLESS_PACKAGE_SUBPATHS = ["next/server"];

export function resolve(specifier, context, next) {
  if (EXTENSIONLESS_PACKAGE_SUBPATHS.includes(specifier)) {
    return next(pathToFileURL(path.join(NODE_MODULES, `${specifier}.js`)).href, context);
  }
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const target = path.join(appRoot, specifier.slice(2));
  const withExt = path.extname(target) ? target : `${target}.js`;
  return next(pathToFileURL(withExt).href, context);
}
