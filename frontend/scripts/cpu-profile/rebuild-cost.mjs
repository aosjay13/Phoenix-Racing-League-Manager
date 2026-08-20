// What precomputing costs an admin's save, and how big the stored answers get.
//
//   npm run profile:rebuild
//   npm run profile:rebuild -- --seasons 24 --races 20
//
// Two questions this answers, both of which decide whether the design holds:
//   1. how much time does a save now spend rebuilding derived stats?
//   2. how close does the largest stored document get to Firestore's 1 MiB cap?
import { performance } from "node:perf_hooks";
import { buildDataset } from "./dataset.mjs";
import { loadStore, db, resetStats, stats } from "./fake-firestore.mjs";
import { BUILDERS } from "@/lib/statsBuilders";
import { STATS_COLLECTION, MAX_STORED_BYTES, writeStored } from "@/lib/statsStore";
import { rebuildStats } from "@/lib/statsRebuild";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : Number(process.argv[i + 1]); };
const SEASONS = arg("seasons", 12), RACES = arg("races", 20), DRIVERS = arg("drivers", 28);

const { leagueId, data } = buildDataset({ seasons: SEASONS, racesPerSeason: RACES, driversPerSeason: DRIVERS, users: 120 });
loadStore(data, { latencyMs: 0, decode: true });

// The hot set: the scopes a league of this size actually opens. Only these ever
// acquire a stored document, and only stored documents are rebuilt.
const last = SEASONS - 1;
const HOT = [
  ["stats", { scope: "league" }],
  ["stats", { scope: "game", gameId: "iracing" }],
  ["stats", { scope: "series", seriesId: "series-0" }],
  ["stats", { scope: "season", seasonId: `season-${last}` }],
  ["stats", { scope: "season", seasonId: `season-${last}`, classId: `class-${last}-0`, className: "Pro" }],
  ["standings", { seasonId: `season-${last}` }],
  ["standings", { seasonId: `season-${last}`, classId: `class-${last}-0`, className: "Pro" }],
  ["standings", { seasonId: `season-${last - 1}` }],
  ["schedule:season", { seasonId: `season-${last}` }],
  ["schedule:all", {}],
  ["team-stats", { team: "Team 0" }],
  ["skill-ratings", { scope: "game", gameId: "iracing" }],
];

console.log(`\nRebuild cost — ${SEASONS} seasons x ${RACES} rounds x ${DRIVERS} drivers ` +
  `(${data.results.length.toLocaleString()} results)\n`);

// Prime the store the way real use would: someone opens each view once.
for (const [name, params] of HOT) {
  const built = await BUILDERS[name](leagueId, params);
  if (built?.status === 200) await writeStored(name, leagueId, params, built);
}

const sizes = (await db().collection(STATS_COLLECTION).get()).docs
  .map(d => ({ name: d.data().name, bytes: d.data().payload_gz.length }))
  .sort((a, b) => b.bytes - a.bytes);

console.log("Stored document sizes (gzipped)");
for (const s of sizes.slice(0, 6)) {
  console.log(`  ${String(s.name).padEnd(18)} ${(s.bytes / 1024).toFixed(1).padStart(7)} KB` +
    `   ${((s.bytes / (1024 * 1024)) * 100).toFixed(1)}% of Firestore's 1 MiB limit`);
}
const largest = sizes[0]?.bytes ?? 0;
console.log(`  ${sizes.length} documents, largest ${(largest / 1024).toFixed(1)} KB ` +
  `(cap is ${(MAX_STORED_BYTES / 1024).toFixed(0)} KB)\n`);

// Now the thing a save pays for.
resetStats();
const c0 = process.cpuUsage(), t0 = performance.now();
const summary = await rebuildStats(leagueId);
const cpuMs = (() => { const c = process.cpuUsage(c0); return (c.user + c.system) / 1000; })();
const wallMs = performance.now() - t0;

console.log("A save's rebuild");
console.log(`  ${summary.rebuilt} rebuilt, ${summary.unchanged} unchanged, ` +
  `${summary.dropped} dropped, ${summary.failed} failed`);
console.log(`  ${cpuMs.toFixed(0)} ms CPU, ${wallMs.toFixed(0)} ms wall (no network latency simulated)`);
console.log(`  ${stats.docsRead.toLocaleString()} documents read, ${stats.writes} written\n`);
console.log(`  Note: unchanged scopes are not written back, which is why a race-night save`);
console.log(`  costs far fewer writes than it does reads.\n`);
