#!/usr/bin/env node
// Fetch a full application backup from the running app and save it to disk.
//
// This is the workhorse behind the automatic Saturday-morning backup, and it
// doubles as the manual "save a copy to my local drive" command:
//
//   APP_URL=https://your-app.vercel.app \
//   BACKUP_CRON_SECRET=… \
//   BACKUP_DIR=/Volumes/Backups/phoenix \
//   node scripts/fetch-backup.mjs
//
// Environment:
//   APP_URL             Base URL of the deployed app (required).
//   BACKUP_CRON_SECRET  Shared secret matching the app's env var (required).
//   BACKUP_DIR          Where to write the file. Default: ./backups
//   BACKUP_SCOPE        "all" (default) or "league".
//   BACKUP_LEAGUE_ID    Which league, when BACKUP_SCOPE=league.
//   BACKUP_KEEP         How many files to keep in BACKUP_DIR. Default 12,
//                       i.e. roughly three months of weekly backups. 0 = keep
//                       everything.
//
// It refuses to write a file that doesn't parse as one of our backups or that
// contains no records at all — a backup folder full of plausible-looking
// garbage is worse than one that's visibly missing this week's run.

import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const APP_URL = (process.env.APP_URL || process.env.BACKUP_APP_URL || "").replace(/\/+$/, "");
const SECRET = process.env.BACKUP_CRON_SECRET || "";
const DIR = resolve(process.env.BACKUP_DIR || "backups");
const SCOPE = process.env.BACKUP_SCOPE === "league" ? "league" : "all";
const LEAGUE_ID = process.env.BACKUP_LEAGUE_ID || "";
const KEEP = Number.isFinite(Number(process.env.BACKUP_KEEP)) ? Number(process.env.BACKUP_KEEP) : 12;

const FORMAT = "phoenix-racing-league-manager/backup";
const RETRIES = 4;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchBackup() {
  const url = new URL(`${APP_URL}/api/admin/backup`);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("pretty", "1");
  if (SCOPE === "league" && LEAGUE_ID) url.searchParams.set("league_id", LEAGUE_ID);

  let lastError = "";
  // A cold serverless start or a blip shouldn't cost a week's backup, so retry
  // with the same exponential backoff the rest of the project uses.
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.log(`  retrying in ${wait / 1000}s (${attempt}/${RETRIES})…`);
      await sleep(wait);
    }
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${SECRET}`, "X-Backup-Token": SECRET },
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
        // Auth and request errors won't fix themselves on a retry.
        if (res.status === 401 || res.status === 403 || res.status === 400) break;
        continue;
      }
      return { text, disposition: res.headers.get("content-disposition") || "" };
    } catch (err) {
      lastError = err.message;
    }
  }
  fail(`Couldn't fetch the backup. ${lastError}`);
}

// Delete all but the newest `KEEP` backup files, so the folder (and the repo)
// doesn't grow without bound.
async function prune() {
  if (KEEP <= 0) return [];
  const names = (await readdir(DIR))
    .filter(n => n.startsWith("phoenix-league-backup-") && n.endsWith(".json"))
    .sort();                                   // timestamped names sort chronologically
  const stale = names.slice(0, Math.max(0, names.length - KEEP));
  for (const name of stale) await unlink(join(DIR, name));
  return stale;
}

async function main() {
  if (!APP_URL) fail("APP_URL is not set — point it at the deployed app, e.g. https://your-app.vercel.app");
  if (!SECRET) fail("BACKUP_CRON_SECRET is not set — it must match the value configured on the app.");

  console.log(`→ Fetching ${SCOPE === "league" ? "league" : "full"} backup from ${APP_URL}`);
  const { text, disposition } = await fetchBackup();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("The response wasn't valid JSON — refusing to save it.");
  }
  if (parsed.format !== FORMAT) fail("The response isn't a backup file — refusing to save it.");
  if (!parsed.total) fail("The backup came back with zero records — refusing to overwrite good history with an empty file.");

  const name = disposition.match(/filename="([^"]+)"/)?.[1]
    || `phoenix-league-backup-${SCOPE === "league" ? "league" : "full"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  await mkdir(DIR, { recursive: true });
  const path = join(DIR, name);
  await writeFile(path, text, "utf8");
  const { size } = await stat(path);

  console.log(`✓ Saved ${path} (${(size / 1024).toFixed(0)} KB, ${parsed.total} records)`);
  for (const [collection, count] of Object.entries(parsed.counts || {})) {
    if (count) console.log(`    ${String(count).padStart(6)}  ${collection}`);
  }

  const pruned = await prune();
  if (pruned.length) console.log(`✓ Pruned ${pruned.length} older backup(s), keeping the newest ${KEEP}`);

  // Hand the details to the workflow steps that commit and upload the file.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT,
      `path=${path}\nname=${name}\nrecords=${parsed.total}\nsize=${size}\n`);
  }
}

main().catch(err => fail(err.stack || err.message));
