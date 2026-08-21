// Dump every computed payload the app renders, so a refactor can be checked
// against the tree it came from rather than eyeballed.
//
//   git stash && node … payloads.mjs > /tmp/before.json && git stash pop
//   node … payloads.mjs > /tmp/after.json && diff /tmp/before.json /tmp/after.json
//
//   node … payloads.mjs --verify         # check against the checked-in digests
//   node … payloads.mjs --write-digests  # re-bless them (only when the ANSWER
//                                        # is meant to change)
//
// Same in-memory Firestore and same seeded dataset every time, so the only
// thing that can move the output is the code under it.
//
// ── What it runs ──────────────────────────────────────────────────────────
//
// The championship maths does not live on the server any more (see
// lib/rawBundle.js): a screen fetches raw documents and derives its tables in a
// useMemo. So this walks that path — fetch a raw bundle, hand it to the compute
// module the browser runs — and dumps what a visitor would actually see.
//
// The digests in payload-digests.json were blessed from the OUTPUT OF THE OLD
// SERVER ROUTES, on this dataset, immediately before those routes were deleted.
// `--verify` is therefore not a self-consistency check: it is the standing proof
// that moving the work into the browser did not move a single number. Every case
// below covers a success path or a refusal, because a change that quietly turns
// a 404 into a 200 is still a broken change.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataset } from "./dataset.mjs";
import { loadStore } from "./fake-firestore.mjs";
import { fetchRawBundle } from "../../lib/rawBundle.js";
import { indexBundle } from "../../lib/rawIndex.js";
import { buildStandings } from "../../lib/standingsCompute.js";
import { buildStats } from "../../lib/statsCompute.js";
import { buildTeamStats } from "../../lib/teamStatsCompute.js";
import { buildSkillRatings } from "../../lib/skillRatingsCompute.js";
import { buildSchedule } from "../../lib/scheduleCompute.js";
import { buildRoster } from "../../lib/rosterCompute.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIGEST_FILE = path.join(here, "payload-digests.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = name => process.argv.includes(`--${name}`);

const SEASONS = Number(arg("seasons", 6));
const dataset = buildDataset({ seasons: SEASONS, racesPerSeason: 8, driversPerSeason: 12, users: 24 });
loadStore(dataset.data, { latencyMs: 0, decode: true });

const LEAGUE = dataset.leagueId;
const LAST = `season-${SEASONS - 1}`;
// Which game the last season belongs to. SR is gated per game, so the Skill
// Ratings screen fetches its bundle at GAME scope even when a season is
// selected — the rating is that whole game's timeline. LeagueProvider hands the
// page the game id; here it is read off the dataset the same way.
const LAST_GAME = dataset.data.seasons.find(s => s.id === LAST)?.game_id ?? "iracing";

// One bundle per (scope, id), fetched once and reused — exactly how a screen
// holds it: the Stats page re-derives every tab from the bundle it already has.
const bundles = new Map();
async function bundleFor(scope, ids = {}) {
  const key = `${scope}|${ids.gameId || ""}|${ids.seriesId || ""}|${ids.seasonId || ""}`;
  if (!bundles.has(key)) bundles.set(key, await fetchRawBundle(LEAGUE, { scope, ...ids }));
  return bundles.get(key);
}

// A case is [name, scope, ids, compute]. `compute` gets the indexed bundle and
// returns { status, body } — the envelope a screen branches on.
//
// A `null` compute is a refusal the screen makes before it ever reaches its
// useMemo (a scope naming no season, a season that doesn't exist). Those are
// asserted from REFUSALS below, since there is nothing to compute.
const CASES = [
  ["schedule/all", "league", {}, i => ({ status: 200, body: buildSchedule(i, {}) })],
  ["schedule/game", "game", { gameId: "iracing" }, i => ({ status: 200, body: buildSchedule(i, { gameId: "iracing" }) })],
  // A second game, whose drivers race under a DIFFERENT on-track name than their
  // overall one. Without it the per-game name resolution is untested: in
  // `iracing` the two names happen to be equal, so a table that ignored the game
  // entirely would still match.
  ["schedule/game-alias", "game", { gameId: "acc" }, i => ({ status: 200, body: buildSchedule(i, { gameId: "acc" }) })],
  ["schedule/season", "season", { seasonId: LAST }, i => ({ status: 200, body: buildSchedule(i, { seasonId: LAST }) })],
  ["schedule/season+class", "season", { seasonId: LAST }, i => ({ status: 200, body: buildSchedule(i, { seasonId: LAST, classId: `class-${SEASONS - 1}-0` }) })],

  ["standings/season", "season", { seasonId: LAST }, i => buildStandings(i, { seasonId: LAST })],
  ["standings/class", "season", { seasonId: LAST }, i => buildStandings(i, { seasonId: LAST, className: "Pro" })],
  ["standings/missing", "season", { seasonId: "" }, null],
  ["standings/unknown", "season", { seasonId: "nope" }, null],

  ["stats/league", "league", {}, i => buildStats(i, { scope: "league" })],
  ["stats/game", "game", { gameId: "iracing" }, i => buildStats(i, { scope: "game", gameId: "iracing" })],
  ["stats/game-alias", "game", { gameId: "acc" }, i => buildStats(i, { scope: "game", gameId: "acc" })],
  ["stats/series", "series", { seriesId: "series-0" }, i => buildStats(i, { scope: "series", seriesId: "series-0" })],
  ["stats/season", "season", { seasonId: LAST }, i => buildStats(i, { scope: "season", seasonId: LAST })],
  ["stats/class", "league", {}, i => buildStats(i, { scope: "league", className: "Pro" })],
  ["stats/badscope", "league", {}, i => buildStats(i, { scope: "nonsense" })],
  ["stats/nogame", "league", {}, i => buildStats(i, { scope: "game" })],
  ["stats/unknown", "season", { seasonId: "nope" }, null],

  ["team-stats/team", "league", {}, i => buildTeamStats(i, { team: "Team 0" })],
  ["team-stats/missing", "league", {}, i => buildTeamStats(i, { team: "" })],
  ["team-stats/unknown", "league", {}, i => buildTeamStats(i, { team: "Nobody" })],

  ["skill/game", "game", { gameId: "iracing" }, i => buildSkillRatings(i, { scope: "game", gameId: "iracing" })],
  ["skill/game-alias", "game", { gameId: "acc" }, i => buildSkillRatings(i, { scope: "game", gameId: "acc" })],
  ["skill/season", "game", { gameId: LAST_GAME }, i => buildSkillRatings(i, { scope: "season", seasonId: LAST })],
  ["skill/series", "game", { gameId: "iracing" }, i => buildSkillRatings(i, { scope: "series", seriesId: "series-0" })],
  ["skill/league", "league", {}, i => buildSkillRatings(i, { scope: "league" })],
  ["skill/unknown", "game", { gameId: "iracing" }, i => buildSkillRatings(i, { scope: "season", seasonId: "nope" })],

  ["roster/league", "league", {}, i => buildRoster(i, { scope: "league" })],
  ["roster/game", "game", { gameId: "iracing" }, i => buildRoster(i, { scope: "game", gameId: "iracing" })],
  ["roster/game-alias", "game", { gameId: "acc" }, i => buildRoster(i, { scope: "game", gameId: "acc" })],
  ["roster/series", "series", { seriesId: "series-0" }, i => buildRoster(i, { scope: "series", seriesId: "series-0" })],
  ["roster/season", "season", { seasonId: LAST }, i => buildRoster(i, { scope: "season", seasonId: LAST })],
  ["roster/badscope", "league", {}, i => buildRoster(i, { scope: "nonsense" })],
  ["roster/nogame", "league", {}, i => buildRoster(i, { scope: "game" })],
  ["roster/missing", "season", { seasonId: "" }, null],
  ["roster/unknown", "season", { seasonId: "nope" }, null],
];

// Refusals the raw reader phrases differently from the screen. The screen shows
// these, so these are what gets compared.
const REFUSALS = {
  "standings/missing": { status: 400, body: { error: "season_id required" } },
  "standings/unknown": { status: 404, body: { error: "Season not found" } },
  "stats/unknown": { status: 404, body: { error: "Season not found" } },
  "roster/missing": { status: 400, body: { error: "season_id required" } },
  "roster/unknown": { status: 404, body: { error: "Season not found" } },
};

const out = {};
for (const [name, scope, ids, compute] of CASES) {
  try {
    if (!compute) { out[name] = REFUSALS[name]; continue; }
    const raw = await bundleFor(scope, ids);
    if (raw.status !== 200) { out[name] = raw; continue; }
    out[name] = compute(indexBundle(raw.body));
  } catch (err) {
    out[name] = { threw: String(err?.message ?? err) };
  }
}

// Sorted case names, so a diff shows a changed ANSWER rather than a reordering.
// (Built as a new object — JSON.stringify's array argument is a property
// ALLOWLIST applied at every depth, not a sort, and quietly strips the payload
// down to almost nothing.)
const sorted = {};
for (const k of Object.keys(out).sort()) sorted[k] = out[k];

const digestOf = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const digests = Object.fromEntries(Object.keys(sorted).map(k => [k, digestOf(sorted[k])]));

if (flag("write-digests")) {
  writeFileSync(DIGEST_FILE, `${JSON.stringify({ seasons: SEASONS, cases: digests }, null, 2)}\n`);
  console.log(`wrote ${Object.keys(digests).length} digests to ${path.relative(process.cwd(), DIGEST_FILE)}`);
} else if (flag("verify")) {
  const blessed = JSON.parse(readFileSync(DIGEST_FILE, "utf8"));
  if (blessed.seasons !== SEASONS) {
    console.error(`digests were blessed at --seasons ${blessed.seasons}; rerun without --seasons to verify`);
    process.exit(1);
  }
  const bad = Object.keys({ ...blessed.cases, ...digests })
    .filter(name => blessed.cases[name] !== digests[name])
    .sort();
  if (bad.length) {
    console.error(`payloads changed in ${bad.length} case(s):\n  ${bad.join("\n  ")}`);
    console.error("\nRun without --verify and diff the output to see what moved.");
    console.error("If the new answer is the intended one, re-bless with --write-digests.");
    process.exit(1);
  }
  console.log(`all ${Object.keys(digests).length} payloads match the answers the server used to give`);
} else {
  console.log(JSON.stringify(sorted, null, 2));
}
