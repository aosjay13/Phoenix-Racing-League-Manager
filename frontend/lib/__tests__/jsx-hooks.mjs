// The alias resolver from alias-hooks.mjs, plus a JSX transform, so a test can
// actually MOUNT a component with react-dom/server instead of only reading its
// source. Kept separate from alias-hooks.mjs so the pure-logic suites stay as
// cheap to run as they were — only the render tests pay for SWC.
//
// The transform is Next's own SWC binding, which is already installed, so a
// component compiles here exactly as it does in `next build`.
import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");

// Bundler-style specifiers carry no file extension; Node's ESM resolver wants
// one. Components are .jsx and libs are .js, so try both rather than assuming.
const EXTENSIONS = [".js", ".jsx"];

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const target = path.join(appRoot, specifier.slice(2));
  if (path.extname(target)) return next(pathToFileURL(target).href, context);
  for (const ext of EXTENSIONS) {
    const candidate = `${target}${ext}`;
    try {
      readFileSync(candidate);
      return next(pathToFileURL(candidate).href, context);
    } catch { /* try the next extension */ }
  }
  return next(pathToFileURL(`${target}.js`).href, context);
}

export function load(url, context, next) {
  if (!url.endsWith(".jsx")) return next(url, context);
  const filename = fileURLToPath(url);
  const { code } = transformSync(readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "es6" },
    sourceMaps: false,
  });
  return { format: "module", source: code, shortCircuit: true };
}
