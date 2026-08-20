// The cache in front of the expensive league reads, and the one rule that makes
// it safe to have at all:
//
//   every route that writes something the cached reads are built from must
//   drop the cache.
//
// A cache that is fast and wrong is worse than no cache. Miss one write path
// and a league sits looking at standings that quietly disagree with its own
// results — the exact failure nobody reports as a bug, because the numbers look
// like numbers. The structural check at the bottom is what stops the NEXT write
// route from being the one that forgets, so this file is less a unit test than
// a rule with teeth.
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATS_COLLECTIONS, STATS_TAG, STATS_TTL_SECONDS, cacheKeyFor, leagueStatsTag } from "../statsCache.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Cache keys ─────────────────────────────────────────────────────────
// Two callers that mean the same query must share an entry, and two that mean
// different queries must never share one.
check("the same params in a different order are the same key",
  cacheKeyFor("stats", "L1", { scope: "league", classId: "gt3" }),
  cacheKeyFor("stats", "L1", { classId: "gt3", scope: "league" }));

check("blank params don't make a different key from absent ones",
  cacheKeyFor("stats", "L1", { scope: "league", classId: "", seasonId: undefined, x: null }),
  cacheKeyFor("stats", "L1", { scope: "league" }));

ok("a different league is a different key",
  cacheKeyFor("stats", "L1", {}).join("|") !== cacheKeyFor("stats", "L2", {}).join("|"));
ok("a different route is a different key",
  cacheKeyFor("stats", "L1", {}).join("|") !== cacheKeyFor("standings", "L1", {}).join("|"));
ok("a different value is a different key",
  cacheKeyFor("stats", "L1", { a: "x" }).join("|") !== cacheKeyFor("stats", "L1", { a: "y" }).join("|"));

// The one that would be a real bug: a value containing the separator must not
// be able to spell the same key as two separate params.
ok("a param value can't be smuggled into another param's slot",
  cacheKeyFor("stats", "L1", { a: "x|y" }).join("|") !== cacheKeyFor("stats", "L1", { a: "x", y: "" }).join("|"));
ok("numbers and their strings agree", 
  cacheKeyFor("stats", "L1", { n: 3 }).join("|") === cacheKeyFor("stats", "L1", { n: "3" }).join("|"));

// ── 2. Tags ───────────────────────────────────────────────────────────────
check("a league's tag hangs off the global one", leagueStatsTag("abc"), `${STATS_TAG}:abc`);
check("no league still has a stable tag", leagueStatsTag(""), `${STATS_TAG}:unscoped`);
check("and so does a missing one", leagueStatsTag(undefined), `${STATS_TAG}:unscoped`);
ok("the TTL is a backstop, not the mechanism — hours, not seconds",
  STATS_TTL_SECONDS >= 60 * 60 && STATS_TTL_SECONDS <= 24 * 60 * 60);

// ── 3. Every write to these collections drops the cache ───────────────────
//
// Walks the real route tree. A route file that (a) exports a write method and
// (b) mentions one of the cached collections has to invalidate — either by
// being one of the generic entityApi routes (which purge centrally, in
// statsChanged) or by wrapping its handlers in withStatsRefresh.
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

// Routes that name a cached collection but only ever READ it. Each one needs a
// reason, so adding to this list is a decision rather than a way to silence the
// check.
const READ_ONLY = {
  // (empty — every write route currently invalidates)
};

function routeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.js") out.push(full);
  }
  return out;
}

const files = routeFiles(path.join(appRoot, "app/api"));
ok("the route tree was actually found", files.length > 50);

const missing = [];
let guarded = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(appRoot, file);
  if (!WRITE_METHODS.some(m => new RegExp(`^export (?:const|async function) ${m}\\b`, "m").test(src))) continue;
  const touches = STATS_COLLECTIONS.filter(c => new RegExp(`collection\\(\\s*["']${c}["']`).test(src));
  if (!touches.length) continue;
  if (READ_ONLY[rel]) continue;

  const viaEntityApi = /makeCollectionRoutes|makeDocRoutes|SPECS/.test(src);
  const viaWrapper = /withStatsRefresh/.test(src);
  if (viaEntityApi || viaWrapper) guarded++;
  else missing.push(`${rel} (writes: ${touches.join(", ")})`);
}

ok("there are write routes to check at all", guarded > 20);
check("every write route that touches a cached collection invalidates", missing, []);

// And the central refresh really is wired into the generic routes, since half
// the coverage above rests on it. refreshStats() is the stronger of the two
// things it could call: it rebuilds the stored answers AND drops the cache,
// where a bare revalidate would only drop the cache and leave the next reader
// to pay for the recalculation.
const entityApi = readFileSync(path.join(appRoot, "lib/entityApi.js"), "utf8");
ok("the generic collection routes refresh centrally", /refreshStats/.test(entityApi));
ok("...and wait for it, so the rebuild is not abandoned mid-flight",
  /await statsChanged\(/.test(entityApi));
ok("...and only for the collections the cached reads are built from",
  /STATS_COLLECTIONS\.includes\(collection\)/.test(entityApi));

console.log(`all ${n} checks passed — ${guarded} write routes drop the stats cache, none skip it`);
