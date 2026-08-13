// Resolves the app's "@/…" import alias (jsconfig.json paths) for plain `node`,
// so the scoring modules can be unit-tested without booting Next.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Bundler-style specifiers carry no file extension; Node's ESM resolver wants
// one, so add .js when the alias points at a module that has it.
export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const target = path.join(appRoot, specifier.slice(2));
  const withExt = path.extname(target) ? target : `${target}.js`;
  return next(pathToFileURL(withExt).href, context);
}
