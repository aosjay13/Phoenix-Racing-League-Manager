// Where the Fluid Active CPU goes.
//
//   npm run profile:cpu
//   npm run profile:cpu -- --seasons 20 --iterations 5
//   npm run profile:cpu -- --latency 0        (prove wall time isn't the bill)
//   npm run profile:cpu -- --json report.json
//
// Runs each API route's real handler against an in-memory Firestore (see
// fake-firestore.mjs) and measures the CPU it burns, because Active CPU — not
// wall clock, not request count — is what Vercel Fluid charges for. The
// absolute microseconds are a model, not a bill; what the run is for is the
// RANKING, and how each number moves when the league gets bigger.
//
// The last section is the one that matters: the routes below are polled by the
// browser on a timer whether or not anybody touches the app, so their cost is
// multiplied by every hour every tab stays open.

import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDataset, describe } from "./dataset.mjs";
import { adminAuth, db, loadStore, mintToken, resetStats, stats } from "./fake-firestore.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");

// ── Arguments ─────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

const SEASONS = Number(arg("seasons", 12));
const RACES = Number(arg("races", 20));
const DRIVERS = Number(arg("drivers", 28));
const USERS = Number(arg("users", 120));
const ITERATIONS = Number(arg("iterations", 3));
const LATENCY = Number(arg("latency", 12));
const ONLY = arg("only", "");
const JSON_OUT = arg("json", "");

// ── The dataset ───────────────────────────────────────────────────────────
const dataset = buildDataset({
  seasons: SEASONS, racesPerSeason: RACES, driversPerSeason: DRIVERS, users: USERS,
});
loadStore(dataset.data, { latencyMs: LATENCY, decode: true });

const LEAGUE = dataset.leagueId;
const LAST_SEASON = `season-${SEASONS - 1}`;
const TOKEN = mintToken({ uid: "uid-0", email: "driver0@example.com", email_verified: true });

function request(url) {
  return new Request(`https://league.example${url}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-league-id": LEAGUE,
      "content-type": "application/json",
    },
  });
}

// ── What gets profiled ────────────────────────────────────────────────────
//
// `poll` is the interval, in seconds, at which a browser calls this route with
// nobody touching the app. Read from the client source at the bottom of this
// file rather than written down here, so the projection can't drift from the
// code.
const ROUTES = [
  // Polled in the background by any open admin tab.
  { name: "GET /api/admin/users?include_unaffiliated=1", file: "app/api/admin/users/route.js", url: "/api/admin/users?include_unaffiliated=1", poller: "userAccountsAlerts" },
  { name: "GET /api/admin/claim-requests", file: "app/api/admin/claim-requests/route.js", url: "/api/admin/claim-requests", poller: "userAccountsAlerts" },
  { name: "GET /api/admin/messages", file: "app/api/admin/messages/route.js", url: "/api/admin/messages", poller: "messageAlerts" },
  { name: "GET /api/admin/signup-requests?status=approved", file: "app/api/admin/signup-requests/route.js", url: "/api/admin/signup-requests?status=approved", poller: "rosterAlerts" },
  { name: "GET /api/admin/signup-requests/count", file: "app/api/admin/signup-requests/count/route.js", url: "/api/admin/signup-requests/count", poller: "pendingSignupAlerts" },
  { name: "GET /api/messages", file: "app/api/messages/route.js", url: "/api/messages", poller: "MessagesProvider" },
  { name: "GET /api/users/me/series", file: "app/api/users/me/series/route.js", url: "/api/users/me/series", poller: "MySignupsProvider" },

  // Loaded when somebody opens a screen.
  //
  // The five routes that used to head this table — standings, stats,
  // team-stats, skill-ratings and schedule — are gone. Every one of them scored
  // the league on the read path; that work now runs in the browser (see
  // lib/rawBundle.js), and what the server serves in their place is the raw
  // pass-through below. The "moved to the browser" section at the end of this
  // report measures what it costs there.
  { name: "GET /api/raw?scope=season", file: "app/api/raw/route.js", url: `/api/raw?scope=season&season_id=${LAST_SEASON}` },
  { name: "GET /api/raw?scope=game", file: "app/api/raw/route.js", url: "/api/raw?scope=game&game_id=iracing" },
  { name: "GET /api/raw?scope=league", file: "app/api/raw/route.js", url: "/api/raw?scope=league" },
  { name: "GET /api/drivers/[id] (career)", file: "app/api/drivers/[id]/route.js", url: "/api/drivers/drv-0", params: { id: "drv-0" } },
  { name: "GET /api/roster", file: "app/api/roster/route.js", url: "/api/roster" },
  { name: "GET /api/drivers", file: "app/api/drivers/route.js", url: "/api/drivers" },
  { name: "GET /api/entries?season_id", file: "app/api/entries/route.js", url: `/api/entries?season_id=${LAST_SEASON}` },
  { name: "GET /api/results?season_id", file: "app/api/results/route.js", url: `/api/results?season_id=${LAST_SEASON}` },
  { name: "GET /api/seasons?series_id", file: "app/api/seasons/route.js", url: "/api/seasons?series_id=series-0" },
  { name: "GET /api/calendar.ics", file: "app/api/calendar.ics/route.js", url: "/api/calendar.ics" },
  { name: "GET /api/users", file: "app/api/users/route.js", url: "/api/users" },
];

// ── Cold start ────────────────────────────────────────────────────────────
//
// Every new Fluid instance pays this before it serves its first byte. It is
// pure CPU — parsing and evaluating modules — and firebase-admin is a large
// dependency to drag in.
async function measureColdStart() {
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  await import("firebase-admin/app");
  await import("firebase-admin/firestore");
  await import("firebase-admin/auth");
  const c1 = process.cpuUsage(c0);
  return { cpuMs: (c1.user + c1.system) / 1000, wallMs: performance.now() - t0 };
}

// ── One route ─────────────────────────────────────────────────────────────
async function measure(route) {
  const url = pathToFileURL(path.join(appRoot, route.file)).href;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    return { ...route, skipped: `import failed: ${err.message}` };
  }
  const handler = mod.GET;
  if (typeof handler !== "function") return { ...route, skipped: "no GET export" };

  // Warm up: first call pays JIT and lazy-init costs that a long-lived Fluid
  // instance only pays once, and we are measuring the steady state.
  const ctx = { params: route.params || {} };
  let probe;
  try {
    probe = await handler(request(route.url), ctx);
  } catch (err) {
    return { ...route, skipped: `threw: ${err.message}` };
  }
  const status = probe?.status ?? 0;
  if (status >= 400) {
    return { ...route, skipped: `HTTP ${status}: ${String(await probe.text()).slice(0, 120)}` };
  }
  const bytes = (await probe.clone().arrayBuffer()).byteLength;

  resetStats();
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) await handler(request(route.url), ctx);
  const cpu = process.cpuUsage(c0);
  const wallMs = (performance.now() - t0) / ITERATIONS;
  const cpuMs = (cpu.user + cpu.system) / 1000 / ITERATIONS;

  return {
    ...route,
    cpuMs, wallMs, bytes, status,
    docsRead: Math.round(stats.docsRead / ITERATIONS),
    authListed: Math.round(stats.authListed / ITERATIONS),
    queries: Math.round(stats.queries / ITERATIONS),
  };
}

// ── Poll intervals, read from the client source ───────────────────────────
//
// Parsed rather than hardcoded: if somebody changes a POLL_MS, this projection
// changes with it instead of quietly lying.
function pollIntervals() {
  const files = {
    messageAlerts: "lib/messageAlerts.js",
    pendingSignupAlerts: "lib/pendingSignupAlerts.js",
    userAccountsAlerts: "lib/userAccountsAlerts.js",
    rosterAlerts: "lib/rosterAlerts.js",
    MessagesProvider: "components/MessagesProvider.jsx",
    MySignupsProvider: "components/MySignupsProvider.jsx",
  };
  const out = {};
  for (const [key, rel] of Object.entries(files)) {
    try {
      const src = readFileSync(path.join(appRoot, rel), "utf8");
      const m = src.match(/(?:POLL_MS|ALERTS_POLL_MS)\s*=\s*([\d_]+)/);
      if (m) out[key] = { seconds: Number(m[1].replace(/_/g, "")) / 1000, file: rel };
    } catch { /* a poller that has been removed simply drops out */ }
  }
  return out;
}

// ── Growth ────────────────────────────────────────────────────────────────
//
// The most useful number in this file is not what a route costs today — it is
// the SHAPE of the curve. A route whose CPU tracks the number of documents in
// the league gets more expensive every week the league races, with no code
// change and no traffic change to explain it. That is what "the bill went up
// and I didn't do anything" looks like from the inside.
async function measureGrowth(sizes) {
  const probes = [
    { name: "GET /api/raw?scope=league", file: "app/api/raw/route.js", url: () => "/api/raw?scope=league" },
    { name: "GET /api/raw?scope=season", file: "app/api/raw/route.js", url: n => `/api/raw?scope=season&season_id=season-${n - 1}` },
    { name: "GET /api/drivers/[id] (career)", file: "app/api/drivers/[id]/route.js", url: () => "/api/drivers/drv-0", params: { id: "drv-0" } },
    { name: "GET /api/admin/users", file: "app/api/admin/users/route.js", url: () => "/api/admin/users?include_unaffiliated=1" },
  ];
  // Warm every probe at the LARGEST size first. Without this the first size
  // measured pays the JIT cost for all of them and the curve reads backwards —
  // an artifact of profiling in one long-lived process, not a property of the
  // code.
  const warmSize = Math.max(...sizes);
  const warm = buildDataset({ seasons: warmSize, racesPerSeason: RACES, driversPerSeason: DRIVERS, users: USERS });
  loadStore(warm.data, { latencyMs: 0, decode: true });
  for (const probe of probes) {
    const mod = await import(pathToFileURL(path.join(appRoot, probe.file)).href);
    for (let i = 0; i < 3; i++) {
      try { await mod.GET(request(probe.url(warmSize)), { params: probe.params || {} }); } catch { /* reported below */ }
    }
  }

  const out = [];
  for (const size of sizes) {
    const ds = buildDataset({ seasons: size, racesPerSeason: RACES, driversPerSeason: DRIVERS, users: USERS });
    // Latency off: this section is about CPU, and idle waiting only makes the
    // run slower without changing a single number in it.
    loadStore(ds.data, { latencyMs: 0, decode: true });
    const row = { size, results: ds.data.results.length, cells: {} };
    for (const probe of probes) {
      const mod = await import(pathToFileURL(path.join(appRoot, probe.file)).href);
      const url = probe.url(size);
      try {
        const ctx = { params: probe.params || {} };
        await mod.GET(request(url), ctx);                     // warm
        resetStats();
        const c0 = process.cpuUsage();
        for (let i = 0; i < ITERATIONS; i++) await mod.GET(request(url), ctx);
        const cpu = process.cpuUsage(c0);
        row.cells[probe.name] = (cpu.user + cpu.system) / 1000 / ITERATIONS;
      } catch {
        row.cells[probe.name] = null;
      }
    }
    out.push(row);
  }
  // Put the original dataset back, so anything after this measures what it said
  // it would.
  loadStore(dataset.data, { latencyMs: LATENCY, decode: true });
  return { probes: probes.map(p => p.name), rows: out };
}

// ── What moved to the browser ─────────────────────────────────────────────
//
// The five heaviest read routes are gone; the maths they did now runs on the
// viewer's machine. This measures it there — the SAME compute modules the
// client components call, over a bundle fetched through the same pass-through
// reader the raw route uses.
//
// Two numbers matter. The bundle fetch is what the server still pays. The
// compute is what it no longer pays: CPU that used to be billed per visitor,
// per visit, now spent once in a browser and re-used from memory every time
// that visitor switches a tab, a class, or a sort order.
async function measureClientCompute() {
  const url = f => pathToFileURL(path.join(appRoot, f)).href;
  const { fetchRawBundle } = await import(url("lib/rawBundle.js"));
  const { indexBundle } = await import(url("lib/rawIndex.js"));
  const { buildStandings } = await import(url("lib/standingsCompute.js"));
  const { buildStats } = await import(url("lib/statsCompute.js"));
  const { buildTeamStats } = await import(url("lib/teamStatsCompute.js"));
  const { buildSkillRatings } = await import(url("lib/skillRatingsCompute.js"));
  const { buildSchedule } = await import(url("lib/scheduleCompute.js"));

  const scopes = {};
  const bundleFor = async (scope, ids = {}) => {
    const key = `${scope}|${ids.gameId || ""}|${ids.seasonId || ""}`;
    if (!scopes[key]) {
      const raw = await fetchRawBundle(LEAGUE, { scope, ...ids });
      scopes[key] = { bytes: Buffer.byteLength(JSON.stringify(raw.body)), index: indexBundle(raw.body) };
    }
    return scopes[key];
  };

  const season = await bundleFor("season", { seasonId: LAST_SEASON });
  const game = await bundleFor("game", { gameId: "iracing" });
  const league = await bundleFor("league");

  const cases = [
    { name: "Standings (one season)", bundle: season, run: () => buildStandings(season.index, { seasonId: LAST_SEASON }) },
    { name: "Schedule (one season)", bundle: season, run: () => buildSchedule(season.index, { seasonId: LAST_SEASON }) },
    { name: "Stats (one season)", bundle: season, run: () => buildStats(season.index, { scope: "season", seasonId: LAST_SEASON }) },
    { name: "Skill Ratings (one game)", bundle: game, run: () => buildSkillRatings(game.index, { scope: "game", gameId: "iracing" }) },
    { name: "Stats (whole league)", bundle: league, run: () => buildStats(league.index, { scope: "league" }) },
    { name: "Team profile (whole league)", bundle: league, run: () => buildTeamStats(league.index, { team: "Team 0" }) },
    { name: "Schedule feed (whole league)", bundle: league, run: () => buildSchedule(league.index, {}) },
  ];

  const out = [];
  for (const c of cases) {
    try {
      c.run(); c.run();                                 // warm
      const c0 = process.cpuUsage();
      for (let i = 0; i < ITERATIONS; i++) c.run();
      const cpu = process.cpuUsage(c0);
      out.push({ name: c.name, cpuMs: (cpu.user + cpu.system) / 1000 / ITERATIONS, bytes: c.bundle.bytes });
    } catch (err) {
      out.push({ name: c.name, error: err.message });
    }
  }
  return out;
}

// ── Hot spot: the per-race full scan ──────────────────────────────────────
//
// summarizeRace (lib/raceSummaryServer.js) starts with
//
//     results.filter(r => r.race_id === race.id && inClass(r))
//
// and the schedule feed calls it once per race — plus once per class per race
// for a multi-class round. `results` there is EVERY result in the league, so
// the cost is races x results, and both sides of that product grow every
// season. That is the superlinear curve in the growth table above.
//
// This measures the same function two ways over identical data: as the feed
// calls it today, and with the results grouped by race_id once up front. Same
// function, same arguments, same output — the only difference is that each call
// is handed its own race's results instead of the whole league's. The outputs
// are compared, so a speed-up that changed an answer would fail here rather
// than look like a win.
async function measureHotspot() {
  const { summarizeRace } = await import(pathToFileURL(path.join(appRoot, "lib/raceSummaryServer.js")).href);
  const { data } = dataset;
  const entriesById = Object.fromEntries(data.entries.map(e => [e.id, e]));
  const races = data.races;
  const results = data.results;

  const scanAll = () => races.map(r => summarizeRace(r, results, entriesById, null));

  const grouped = () => {
    const byRace = {};
    for (const r of results) (byRace[r.race_id] ??= []).push(r);
    return races.map(r => summarizeRace(r, byRace[r.id] || [], entriesById, null));
  };

  // Same answers, or this section has proved nothing.
  const same = JSON.stringify(scanAll()) === JSON.stringify(grouped());

  const time = (fn) => {
    fn(); fn();                                   // warm
    const c0 = process.cpuUsage();
    for (let i = 0; i < ITERATIONS; i++) fn();
    const c = process.cpuUsage(c0);
    return (c.user + c.system) / 1000 / ITERATIONS;
  };

  return {
    races: races.length,
    results: results.length,
    comparisons: races.length * results.length,
    identical: same,
    scanMs: time(scanAll),
    groupedMs: time(grouped),
  };
}

// ── Report ────────────────────────────────────────────────────────────────
const ms = n => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const kb = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

function table(rows, columns) {
  const head = columns.map(c => c.label);
  const body = rows.map(r => columns.map(c => String(c.get(r) ?? "")));
  const width = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (cells) => cells.map((c, i) => (columns[i].right ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  ");
  return [line(head), width.map(w => "─".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

async function main() {
  console.log("\n\x1b[1mFluid Active CPU profile\x1b[0m");
  console.log(`  league: ${SEASONS} seasons x ${RACES} rounds x ${DRIVERS} drivers, ${USERS} accounts`);
  console.log(`  rows:   ${Object.entries(describe(dataset)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  run:    ${ITERATIONS} iteration(s) per route, ${LATENCY}ms simulated Firestore latency\n`);

  const cold = await measureColdStart();
  console.log(`\x1b[1mCold start\x1b[0m — firebase-admin import: ${ms(cold.cpuMs)} ms CPU (${ms(cold.wallMs)} ms wall)`);
  console.log("  Paid once per new Fluid instance, before the first request is served.\n");

  const selected = ONLY ? ROUTES.filter(r => r.name.includes(ONLY)) : ROUTES;
  const results = [];
  for (const route of selected) results.push(await measure(route));

  const ok = results.filter(r => !r.skipped).sort((a, b) => b.cpuMs - a.cpuMs);
  const skipped = results.filter(r => r.skipped);

  console.log("\x1b[1mCPU per request, most expensive first\x1b[0m");
  console.log(table(ok, [
    { label: "route", get: r => r.name },
    { label: "CPU ms", get: r => ms(r.cpuMs), right: true },
    { label: "wall ms", get: r => ms(r.wallMs), right: true },
    { label: "CPU%", get: r => `${((r.cpuMs / r.wallMs) * 100).toFixed(0)}%`, right: true },
    { label: "docs", get: r => r.docsRead + r.authListed, right: true },
    { label: "queries", get: r => r.queries, right: true },
    { label: "payload", get: r => kb(r.bytes), right: true },
  ]));
  console.log("\n  CPU%  = share of wall time actually spent burning CPU. Everything else");
  console.log("          is idle waiting on Firestore, which Fluid does not bill at full rate.");
  console.log("          Over 100% is real: garbage collection runs on its own threads, so a");
  console.log("          route that allocates hard can bill more CPU than it takes wall time.");
  console.log("  docs  = documents pulled over the wire and decoded, per request.\n");

  // ── The part that explains the bill ──────────────────────────────────────
  const intervals = pollIntervals();
  const polled = ok.filter(r => r.poller && intervals[r.poller]);
  if (polled.length) {
    const rows = polled.map(r => {
      const perHour = 3600 / intervals[r.poller].seconds;
      return { ...r, perHour, cpuHourMs: r.cpuMs * perHour };
    }).sort((a, b) => b.cpuHourMs - a.cpuHourMs);

    const totalPerHour = rows.reduce((s, r) => s + r.perHour, 0);
    const totalCpuMs = rows.reduce((s, r) => s + r.cpuHourMs, 0);

    console.log("\x1b[1mBackground polling — CPU burned per open tab, per hour, with nobody touching the app\x1b[0m");
    console.log(table(rows, [
      { label: "route", get: r => r.name },
      { label: "every", get: r => `${intervals[r.poller].seconds}s`, right: true },
      { label: "calls/hr", get: r => r.perHour.toFixed(0), right: true },
      { label: "CPU ms/hr", get: r => ms(r.cpuHourMs), right: true },
      { label: "docs/hr", get: r => ((r.docsRead + r.authListed) * r.perHour).toFixed(0), right: true },
      { label: "driven by", get: r => intervals[r.poller].file },
    ]));

    const perTabHour = totalCpuMs / 1000;
    console.log(`\n  ${totalPerHour.toFixed(0)} requests/hour and ${ms(totalCpuMs)} ms of CPU per open tab, idle.`);
    console.log(`  One admin leaving a tab open 8h/day, 22 days/month:`);
    console.log(`    ${(perTabHour * 8 * 22 / 3600).toFixed(2)} CPU-hours/month, ${(totalPerHour * 8 * 22).toFixed(0)} invocations/month — from nobody doing anything.`);
    console.log(`  Five such tabs: ${(perTabHour * 8 * 22 * 5 / 3600).toFixed(2)} CPU-hours/month.\n`);
  }

  // ── The work that left the server ───────────────────────────────────────
  const client = await measureClientCompute();
  const clientOk = client.filter(c => !c.error);
  if (clientOk.length) {
    console.log("\x1b[1mMoved to the browser — CPU the server no longer spends\x1b[0m");
    console.log(table(clientOk, [
      { label: "screen", get: c => c.name },
      { label: "CPU ms", get: c => ms(c.cpuMs), right: true },
      { label: "bundle", get: c => kb(c.bytes), right: true },
    ]));
    console.log("\n  CPU ms = what the VIEWER'S machine spends deriving that screen, once,");
    console.log("           from a bundle it already holds. Vercel is billed for none of it,");
    console.log("           and a second view of the same data (another tab, another class,");
    console.log("           another sort) costs a re-render rather than a request.");
    console.log("  bundle = the raw payload that scope ships. This is the trade: the server");
    console.log("           sends more bytes so it can stop doing the arithmetic, and the");
    console.log("           edge cache serves the repeats without waking a function.\n");
  }
  for (const c of client.filter(x => x.error)) console.log(`  (${c.name}: ${c.error})`);

  if (arg("hotspots", false)) {
    const h = await measureHotspot();
    console.log("\x1b[1mHot spot — summarizeRace scans every result in the league, once per race\x1b[0m");
    console.log(`  ${h.races} races x ${h.results} results = ${h.comparisons.toLocaleString()} comparisons per schedule feed`);
    console.log(`  as written (full scan per race): ${ms(h.scanMs)} ms CPU`);
    console.log(`  results grouped by race_id first: ${ms(h.groupedMs)} ms CPU`);
    console.log(`  same output: ${h.identical ? "yes" : "NO — the two forms disagree, do not act on this number"}`);
    if (h.identical && h.groupedMs > 0) {
      console.log(`  \x1b[1m${(h.scanMs / h.groupedMs).toFixed(1)}x less CPU\x1b[0m for identical results.\n`);
    } else {
      console.log();
    }
  }

  if (arg("growth", false)) {
    const sizes = String(arg("growth-sizes", "4,8,16,24")).split(",").map(Number);
    const growth = await measureGrowth(sizes);
    console.log("\x1b[1mGrowth — CPU ms per request as the league races more seasons\x1b[0m");
    console.log(table(growth.rows, [
      { label: "seasons", get: r => r.size, right: true },
      { label: "result rows", get: r => r.results, right: true },
      ...growth.probes.map(name => ({
        label: name.replace("GET /api/", ""),
        get: r => (r.cells[name] == null ? "—" : ms(r.cells[name])),
        right: true,
      })),
    ]));
    const first = growth.rows[0], last = growth.rows[growth.rows.length - 1];
    console.log(`\n  ${first.size} seasons -> ${last.size} seasons is ${(last.results / first.results).toFixed(1)}x the result rows.`);
    for (const name of growth.probes) {
      if (first.cells[name] && last.cells[name]) {
        console.log(`    ${name.replace("GET /api/", "").padEnd(28)} ${(last.cells[name] / first.cells[name]).toFixed(1)}x the CPU`);
      }
    }
    console.log();
  }

  if (skipped.length) {
    console.log("\x1b[1mNot measured\x1b[0m");
    for (const r of skipped) console.log(`  ${r.name} — ${r.skipped}`);
    console.log();
  }

  if (JSON_OUT && typeof JSON_OUT === "string") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(JSON_OUT, JSON.stringify({
      config: { seasons: SEASONS, races: RACES, drivers: DRIVERS, users: USERS, iterations: ITERATIONS, latency: LATENCY },
      rows: describe(dataset), coldStart: cold, routes: results, pollIntervals: intervals,
    }, null, 2));
    console.log(`Wrote ${JSON_OUT}\n`);
  }
}

// Keep the double honest: if a route ever reaches past this module for data,
// the run should fail loudly rather than report a flattering number.
if (typeof db !== "function" || typeof adminAuth !== "function") {
  throw new Error("the Firestore double did not load — check profile-hooks.mjs");
}

main().catch(err => { console.error(err); process.exit(1); });
