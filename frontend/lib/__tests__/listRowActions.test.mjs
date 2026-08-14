// Guard: a row's action buttons must never be drawn on top of the row's text.
//
// The bug this exists to stop coming back: the Time Trials hub put its buttons
// in a `.list-row-actions` group, which is positioned `absolute` so a directory
// row can keep its whole row clickable and overlay the buttons on the right
// edge. That only works with two things in place — a `.list-row-wrap` around
// each single row to position against, and enough reserved right padding on the
// row for the widest group of buttons. The hub had neither: the wrap sat on the
// LIST, so every row's buttons were positioned against the whole list and piled
// up in the middle of it, and a session's Placement badge, status badge, Open
// and Delete are wider than the padding, so they landed on top of the Averages
// column ("🎽 Placement" printed over "Best Average Time"). The merge
// suggestions had no wrap at all, which anchors their buttons to the page.
//
// Rows that build their own layout keep the buttons outside the row's link
// already, so they don't need the overlay: `actions-inline` puts the group back
// in the flex flow, where flexbox reserves its space and nothing can overlap.
// The invariant is the pairing — a row with buttons either sits in a
// `.list-row-wrap` (overlay) or declares `actions-inline` (in flow). Half of
// either arrangement is the bug.
//
// These are source-level assertions rather than behavioural ones because what
// went wrong is CSS layout, and that needs a browser to measure; the wiring
// between the markup and the stylesheet is what's checked here.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

let n = 0;
function check(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// Strip comments so the prose in a file (which names the old arrangement)
// can't satisfy or trip any of the checks below.
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map(l => l.replace(/(^|[^:])\/\/.*$/, "$1"))
  .join("\n");

// ── 1. The stylesheet actually takes the group out of the overlay ─────────
const inlineRule = stripComments(css)
  .match(/\.list-row\.actions-inline\s+\.list-row-actions\s*\{([^}]*)\}/);

check("globals.css defines .list-row.actions-inline .list-row-actions", !!inlineRule);
check("actions-inline drops the absolute positioning",
  /position:\s*static/.test(inlineRule?.[1] ?? ""));
check("actions-inline drops the centring transform the overlay needs",
  /transform:\s*none/.test(inlineRule?.[1] ?? ""));
check("an in-flow group is still pushed to the right edge of its row",
  /margin-left:\s*auto/.test(inlineRule?.[1] ?? ""));

// The overlay arrangement stays for the directories, which do wrap each row.
check("globals.css still positions .list-row-wrap for the overlay rows",
  /\.list-row-wrap\s*\{[^}]*position:\s*relative/.test(stripComments(css)));

// ── 2. Every row carrying buttons picks one arrangement and completes it ──
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.jsx?$/.test(entry.name)) files.push(full);
  }
})(join(root, "app"));
(function walkComponents() {
  for (const entry of readdirSync(join(root, "components"), { withFileTypes: true })) {
    if (/\.jsx?$/.test(entry.name)) files.push(join(root, "components", entry.name));
  }
})();

const withActions = files.filter(f => stripComments(readFileSync(f, "utf8")).includes("list-row-actions"));
check("the rows carrying action buttons are still found by this test", withActions.length >= 2);

for (const file of withActions) {
  const code = stripComments(readFileSync(file, "utf8"));
  const where = relative(root, file);

  // A file that wraps its rows keeps the overlay; anything else must declare
  // actions-inline on every row it renders.
  if (code.includes("list-row-wrap")) {
    check(`${where} wraps a single row, not the list, when it overlays buttons`,
      !/list-rows[^"'`]*list-row-wrap|list-row-wrap[^"'`]*list-rows/.test(code));
    continue;
  }

  // Only the row element itself, so `list-row-name` and `list-row-meta` — which
  // share the prefix but carry no buttons — don't count as rows.
  const rowClassLists = [...code.matchAll(/className=\{?[`"']([^`"']*)[`"']/g)]
    .map(m => m[1])
    .filter(classList => classList.split(/[\s${}]+/).includes("list-row"));
  check(`${where} renders at least one .list-row this test can see`, rowClassLists.length > 0);
  for (const classList of rowClassLists) {
    check(`${where} row "${classList.trim()}" declares actions-inline (no wrap to overlay against)`,
      classList.split(/\s+/).includes("actions-inline"));
  }
}

// ── 3. A row that opts in must exist, or rule 2 passes by vacuum ─────────
const optedIn = files.filter(f => /className=\{?[`"'][^`"']*\bactions-inline\b/.test(readFileSync(f, "utf8")));
check("the Time Trials hub rows use the in-flow arrangement",
  optedIn.some(f => f.endsWith(join("app", "time-trials", "page.js"))));
check("the merge suggestion rows use the in-flow arrangement",
  optedIn.some(f => f.endsWith(join("components", "DriverMergeTool.jsx"))));

console.log(`listRowActions: ${n} assertions passed`);
