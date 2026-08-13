// `node --import ./lib/__tests__/register-jsx.mjs …` installs the "@/…"
// resolver AND the JSX transform, for the suites that mount a component.
// See the "test" script in package.json.
import { register } from "node:module";
register("./jsx-hooks.mjs", import.meta.url);
