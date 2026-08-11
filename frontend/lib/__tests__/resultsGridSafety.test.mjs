// Guard: the results-entry grid must never destroy data outside the session
// being edited.
//
// The bug this exists to stop coming back: the ✕ at the end of a results row
// called removeEntry(), which DELETEd the driver's season ROSTER ENTRY with
// ?confirm=results — and the server cascades that to every result that entry
// has in the whole season. Taking a driver out of one heat because they belong
// in another silently wiped weeks of already-entered stats for them across
// every race, with no undo.
//
// Removing a row from a grid is an everyday edit. It must stay grid-local:
// nothing leaves the browser until Save, and Save only ever replaces this
// race's rows for this session. Deleting a roster entry (and confirming how
// many results go with it) belongs on the Roster screen.
//
// These are source-level assertions rather than behavioural ones because the
// component needs a DOM to run; what actually went wrong was the wiring, and
// the wiring is what's checked here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../components/SessionEditor.jsx"), "utf8");
const roster = readFileSync(join(here, "../../components/RosterManager.jsx"), "utf8");

let n = 0;
function check(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// Strip comments so the prose above (which names the old calls) can't satisfy
// or trip any of the checks below.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map(l => l.replace(/(^|[^:])\/\/.*$/, "$1"))
  .join("\n");

// ── 1. The grid never deletes a roster entry ──────────────────────────────
check("no DELETE against /api/entries anywhere in the results grid",
  !/\/api\/entries\/[^"'`]*[\s\S]{0,200}?method:\s*["']DELETE["']/.test(code));
check("the grid never sends the cascade override",
  !code.includes("confirm=results"));
check("removeEntry is gone from the results grid",
  !/function\s+removeEntry/.test(code));

// ── 2. The row ✕ is unconditionally the grid-local removal ────────────────
check("onRemove always calls removeSlot", /onRemove:\s*\(\)\s*=>\s*removeSlot\(idx\)/.test(code));
check("onRemove does not branch on whether a driver is in the row",
  !/onRemove:[\s\S]{0,120}?row\.entry_id\s*\?/.test(code));

// removeSlot itself must only reshape local rows state.
const removeSlotBody = code.match(/function removeSlot\(idx\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
check("removeSlot has a body to inspect", removeSlotBody.trim().length > 0);
check("removeSlot only touches local state", /setRows\(/.test(removeSlotBody));
check("removeSlot makes no network call", !/\bapi\(/.test(removeSlotBody));

// ── 3. The one delete the grid still owns stays session-scoped ────────────
// "Delete <session> Results" is a deliberate, labelled button — it must target
// /api/results for this race+session, never the roster.
const deleteResults = code.match(/async function handleDeleteResults\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
check("handleDeleteResults has a body to inspect", deleteResults.trim().length > 0);
check("handleDeleteResults targets /api/results", /\/api\/results/.test(deleteResults));
check("handleDeleteResults scopes to one race", /race_id/.test(deleteResults));
check("handleDeleteResults scopes to one session", /session_type/.test(deleteResults));
check("handleDeleteResults asks first", /confirm\(/.test(deleteResults));

// ── 4. Season-roster removal still exists — on the Roster screen ──────────
// The capability isn't lost, it just lives where it's done safely: try the
// delete, catch the server's 409, tell the admin the count, ask again.
check("the roster still removes entries", /\/api\/entries\/\$\{entryId\}/.test(roster));
check("the roster's first attempt carries no override",
  /api\(`\/api\/entries\/\$\{entryId\}`,\s*\{\s*method:\s*"DELETE"/.test(roster));
check("the roster only overrides after a second confirm",
  /confirm\([\s\S]{0,200}?\)[\s\S]{0,200}?confirm=results/.test(roster));

console.log(`all ${n} checks passed — removing a results row stays inside that session`);
