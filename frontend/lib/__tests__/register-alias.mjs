// `node --import ./lib/__tests__/register-alias.mjs …` installs the "@/…"
// resolver above. See the "test" script in package.json.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
