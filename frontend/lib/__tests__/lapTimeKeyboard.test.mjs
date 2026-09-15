// Guard: a phone must be able to type a lap time.
//
// The bug this exists to stop coming back: the Time Trials lap boxes asked for
// inputMode="decimal". On an iPhone that raises a keypad of digits and a
// decimal point with no colon on it and no layer to switch to, so an admin
// entering the night's laps from a phone could type "23.456" but never
// "1:23.456" — every lap over a minute was simply unenterable.
//
// A minute separator is not optional: parseTime reads the colon and nothing
// else (see lib/raceTime.js), so the fix is that a box holding a clock string
// asks for the full keyboard and never a keypad. Checked at source level the
// way resultsGridSafety.test.mjs checks its own grid: what went wrong was the
// wiring, and the wiring is what's checked here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TIME_INPUT_PROPS } from "@/lib/timeInput";
import { parseTime } from "@/lib/raceTime";

let n = 0;
function check(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// A keypad is anything that hides the letters layer — and with it the colon.
const KEYPADS = ["numeric", "decimal", "tel"];

// ── 1. The shared props ask for a full keyboard ───────────────────────────
check("time boxes are text, not a number spinner", TIME_INPUT_PROPS.type === "text");
check("time boxes never ask for a keypad", !KEYPADS.includes(TIME_INPUT_PROPS.inputMode));
check("…and say so out loud rather than leaving it to the default",
  TIME_INPUT_PROPS.inputMode === "text");
// A clock reading is not prose: the phone must not "correct" it, capitalise it
// or underline it, and autofill must not cover the next row of the grid.
check("autocorrect is off", TIME_INPUT_PROPS.autoCorrect === "off");
check("autocapitalisation is off", TIME_INPUT_PROPS.autoCapitalize === "off");
check("autofill is off", TIME_INPUT_PROPS.autoComplete === "off");
check("spellcheck is off", TIME_INPUT_PROPS.spellCheck === false);

// ── 2. Why the colon has to be typeable at all ────────────────────────────
check("a minute only reads as a minute with the colon", parseTime("1:23.456") === 83.456);
check("without it the same digits are a different lap", parseTime("123.456") === 123.456);

// ── 3. The Time Trials lap grid uses them ─────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../app/time-trials/[id]/TimeTrialScreen.jsx"), "utf8");
// Strip comments so the prose naming the old keypad can't satisfy or trip a
// check below.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map(l => l.replace(/(^|[^:])\/\/.*$/, "$1"))
  .join("\n");

const lapInput = (code.match(/<input[\s\S]*?\/>/g) || []).find(el => el.includes("setLap("));
check("the lap grid still has an input to inspect", Boolean(lapInput));
check("the lap input spreads the shared time-box props",
  /\{\s*\.\.\.TIME_INPUT_PROPS\s*\}/.test(lapInput || ""));
check("the props come from lib/timeInput", /TIME_INPUT_PROPS\s*\}\s*from\s*["']@\/lib\/timeInput["']/.test(code));
check("the lap input asks for no keypad of its own",
  !KEYPADS.some(mode => (lapInput || "").includes(`inputMode="${mode}"`)));
check("nor for a number spinner", !/type=["']number["']/.test(lapInput || ""));
// The sheet stores the text that was typed (see lib/timeTrials.js) — a lap that
// doesn't parse is kept and shown, not silently reshaped on the way in.
check("what was typed is what is stored", /setLap\(row\.id,\s*lapIdx,\s*e\.target\.value\)/.test(lapInput || ""));

console.log(`lapTimeKeyboard: ${n} checks passed`);
