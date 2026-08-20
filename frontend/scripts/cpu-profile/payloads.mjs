// Dump every profiled route's response body, so a refactor can be checked
// against the tree it came from rather than eyeballed.
//
//   git stash && node … payloads.mjs > /tmp/before.json && git stash pop
//   node … payloads.mjs > /tmp/after.json && diff /tmp/before.json /tmp/after.json
//
// Same Firestore double and same seeded dataset as profile.mjs, so the only
// thing that can move the output is the code under it. A caching layer that
// changed an answer would show up here as a diff — which is the one thing a
// caching layer must never do.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDataset } from "./dataset.mjs";
import { loadStore, mintToken } from "./fake-firestore.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dataset = buildDataset({ seasons: Number(arg("seasons", 6)), racesPerSeason: 8, driversPerSeason: 12, users: 24 });
loadStore(dataset.data, { latencyMs: 0, decode: true });

const LEAGUE = dataset.leagueId;
const TOKEN = mintToken({ uid: "uid-0", email: "driver0@example.com", email_verified: true });
const LAST = `season-${Number(arg("seasons", 6)) - 1}`;

const CASES = [
  ["schedule/all", "app/api/schedule/route.js", "/api/schedule"],
  ["schedule/game", "app/api/schedule/route.js", "/api/schedule?game_id=iracing"],
  ["schedule/season", "app/api/schedule/route.js", `/api/schedule?season_id=${LAST}`],
  ["schedule/season+class", "app/api/schedule/route.js", `/api/schedule?season_id=${LAST}&class_id=class-${Number(arg("seasons", 6)) - 1}-0`],
  ["standings/season", "app/api/standings/route.js", `/api/standings?season_id=${LAST}`],
  ["standings/class", "app/api/standings/route.js", `/api/standings?season_id=${LAST}&class_name=Pro`],
  ["standings/missing", "app/api/standings/route.js", "/api/standings"],
  ["standings/unknown", "app/api/standings/route.js", "/api/standings?season_id=nope"],
  ["stats/league", "app/api/stats/route.js", "/api/stats?scope=league"],
  ["stats/game", "app/api/stats/route.js", "/api/stats?scope=game&game_id=iracing"],
  ["stats/series", "app/api/stats/route.js", "/api/stats?scope=series&series_id=series-0"],
  ["stats/season", "app/api/stats/route.js", `/api/stats?scope=season&season_id=${LAST}`],
  ["stats/class", "app/api/stats/route.js", "/api/stats?scope=league&class_name=Pro"],
  ["stats/badscope", "app/api/stats/route.js", "/api/stats?scope=nonsense"],
  ["stats/nogame", "app/api/stats/route.js", "/api/stats?scope=game"],
  ["stats/unknown", "app/api/stats/route.js", "/api/stats?scope=season&season_id=nope"],
  ["team-stats/team", "app/api/team-stats/route.js", "/api/team-stats?team=Team%200"],
  ["team-stats/missing", "app/api/team-stats/route.js", "/api/team-stats"],
  ["team-stats/unknown", "app/api/team-stats/route.js", "/api/team-stats?team=Nobody"],
  ["skill/game", "app/api/skill-ratings/route.js", "/api/skill-ratings?scope=game&game_id=iracing"],
  ["skill/season", "app/api/skill-ratings/route.js", `/api/skill-ratings?scope=season&season_id=${LAST}`],
  ["skill/series", "app/api/skill-ratings/route.js", "/api/skill-ratings?scope=series&series_id=series-0"],
  ["skill/league", "app/api/skill-ratings/route.js", "/api/skill-ratings?scope=league"],
  ["skill/unknown", "app/api/skill-ratings/route.js", "/api/skill-ratings?scope=season&season_id=nope"],
];

function request(url) {
  return new Request(`https://league.example${url}`, {
    headers: { authorization: `Bearer ${TOKEN}`, "x-league-id": LEAGUE, "content-type": "application/json" },
  });
}

const out = {};
for (const [name, file, url] of CASES) {
  try {
    const { GET } = await import(pathToFileURL(path.join(appRoot, file)).href);
    const res = await GET(request(url), { params: {} });
    out[name] = { status: res.status, body: await res.json() };
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
console.log(JSON.stringify(sorted, null, 2));
