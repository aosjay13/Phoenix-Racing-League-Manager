// Precomputing stats is only ever allowed to be a speed-up. The three claims
// the whole design rests on, tested against real builders running over a real
// (in-memory) Firestore:
//
//   1. a STORED answer is identical to a freshly CALCULATED one;
//   2. deleting every stored answer loses nothing — the next read rebuilds it
//      from the league's own records and gets the same numbers;
//   3. a rebuild after a save produces those same numbers again.
//
// (2) is the important one. It is what makes the aggregated_stats collection
// disposable, and therefore what makes "could this lose my data?" answerable
// with a demonstration rather than a promise.
//
// Run with the profiler's resolver, which points @/lib/firebase at the
// in-memory double: see scripts/cpu-profile/register.mjs.
import assert from "node:assert";
import { buildDataset } from "../../scripts/cpu-profile/dataset.mjs";
import { loadStore, db } from "../../scripts/cpu-profile/fake-firestore.mjs";
import { BUILDERS } from "../statsBuilders.js";
import { STATS_COLLECTION, decodePayload, encodePayload, docIdFor, readStored, writeStored } from "../statsStore.js";
import { rebuildStats } from "../statsRebuild.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}:\n  got  ${JSON.stringify(got).slice(0, 300)}\n  want ${JSON.stringify(want).slice(0, 300)}`);
};
const ok = (label, cond) => { n++; assert.ok(cond, label); };

const { leagueId, data } = buildDataset({ seasons: 3, racesPerSeason: 4, driversPerSeason: 10, users: 20 });
loadStore(data, { latencyMs: 0, decode: true });

const SEASON = "season-2";
// One case per builder, covering the scopes the screens actually ask for.
const CASES = [
  ["stats", { scope: "league" }],
  ["stats", { scope: "game", gameId: "iracing" }],
  ["stats", { scope: "series", seriesId: "series-0" }],
  ["stats", { scope: "season", seasonId: SEASON }],
  ["stats", { scope: "season", seasonId: SEASON, classId: `class-2-0`, className: "Pro" }],
  ["standings", { seasonId: SEASON }],
  ["standings", { seasonId: SEASON, classId: `class-2-0`, className: "Pro" }],
  ["schedule:season", { seasonId: SEASON }],
  ["schedule:all", {}],
  ["team-stats", { team: "Team 0" }],
  ["skill-ratings", { scope: "game", gameId: "iracing" }],
];

// ── 0. The envelope itself ────────────────────────────────────────────────
const sample = { rows: [{ a: 1, name: "Ana" }], nested: { deep: [1, 2, 3] } };
check("a payload survives the gzip round trip", decodePayload(encodePayload(sample)), sample);
ok("compression actually shrinks a realistic payload",
  encodePayload({ rows: Array.from({ length: 200 }, (_, i) => ({ driver_name: `Driver ${i}`, points: i, wins: 0 })) }).length
  < JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ driver_name: `Driver ${i}`, points: i, wins: 0 })) }).length / 2);
ok("the same scope always resolves to the same document id",
  docIdFor("stats", "L1", { scope: "league" }) === docIdFor("stats", "L1", { scope: "league" }));
ok("different scopes never share a document id",
  docIdFor("stats", "L1", { scope: "league" }) !== docIdFor("stats", "L1", { scope: "game" }));
ok("different leagues never share a document id",
  docIdFor("stats", "L1", { scope: "league" }) !== docIdFor("stats", "L2", { scope: "league" }));

// ── 1. Stored == calculated, builder by builder ───────────────────────────
const live = new Map();
for (const [name, params] of CASES) {
  const built = await BUILDERS[name](leagueId, params);
  ok(`${name} ${JSON.stringify(params)} builds at all`, built && built.status === 200);
  live.set(`${name}|${JSON.stringify(params)}`, built);
  await writeStored(name, leagueId, params, built);
}
for (const [name, params] of CASES) {
  const stored = await readStored(name, leagueId, params);
  check(`${name} ${JSON.stringify(params)} reads back exactly as it was calculated`,
    stored, live.get(`${name}|${JSON.stringify(params)}`));
}

// ── 2. Losing every stored answer loses nothing ───────────────────────────
const before = (await db().collection(STATS_COLLECTION).get()).docs.length;
ok("there were stored answers to lose", before === CASES.length);
for (const [name, params] of CASES) {
  await db().collection(STATS_COLLECTION).doc(docIdFor(name, leagueId, params)).delete();
}
ok("every stored answer is gone", (await db().collection(STATS_COLLECTION).get()).docs.length === 0);
for (const [name, params] of CASES) {
  check(`${name} ${JSON.stringify(params)} is unchanged after the stored copy was destroyed`,
    await BUILDERS[name](leagueId, params), live.get(`${name}|${JSON.stringify(params)}`));
  ok(`${name} reports nothing stored rather than erroring`,
    (await readStored(name, leagueId, params)) === null);
}

// ── 3. A rebuild reproduces the same numbers ──────────────────────────────
for (const [name, params] of CASES) await writeStored(name, leagueId, params, live.get(`${name}|${JSON.stringify(params)}`));
const summary = await rebuildStats(leagueId);
ok("the rebuild visited every stored scope and dropped none",
  summary.rebuilt + summary.unchanged === CASES.length && summary.dropped === 0 && summary.failed === 0);
for (const [name, params] of CASES) {
  check(`${name} ${JSON.stringify(params)} still matches after a rebuild`,
    await readStored(name, leagueId, params), live.get(`${name}|${JSON.stringify(params)}`));
}

// A scope nobody has ever opened has no document, so a rebuild never pays for
// it — this is what keeps a save's cost bounded by what the league looks at.
ok("an unopened scope is not stored, and so is not rebuilt",
  (await readStored("standings", leagueId, { seasonId: "season-0" })) === null);

// ── 4. An unusable stored document is ignored, never served ───────────────
await db().collection(STATS_COLLECTION).doc(docIdFor("stats", leagueId, { scope: "league" }))
  .set({ league_id: leagueId, name: "stats", params: { scope: "league" }, status: 200,
         payload_gz: encodePayload({ rows: [] }), version: 999, built_at: "2020-01-01T00:00:00.000Z" });
ok("a document built by other scoring code is ignored",
  (await readStored("stats", leagueId, { scope: "league" })) === null);

// This one deliberately logs a decode error on its way past — that IS the
// behaviour under test (complain, then fall back to recomputing), so the noise
// below is the test working rather than the test failing.
console.log("  ↓ the next logged error is expected — a deliberately corrupt document");
await db().collection(STATS_COLLECTION).doc(docIdFor("stats", leagueId, { scope: "league" }))
  .set({ league_id: leagueId, name: "stats", params: { scope: "league" }, status: 200,
         payload_gz: "not-actually-gzip", version: 1, built_at: "2020-01-01T00:00:00.000Z" });
ok("a corrupt document is ignored rather than thrown",
  (await readStored("stats", leagueId, { scope: "league" })) === null);

console.log(`all ${n} checks passed — precomputed stats equal calculated ones, and deleting them loses nothing`);
