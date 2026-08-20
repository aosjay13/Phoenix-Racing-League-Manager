// `node --import ./scripts/cpu-profile/register.mjs …` installs the profiler's
// resolver. See the "profile:cpu" script in package.json.
import { register } from "node:module";
register("./profile-hooks.mjs", import.meta.url);
