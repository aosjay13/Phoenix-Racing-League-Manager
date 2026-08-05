#!/usr/bin/env node
// Upload a backup file to a Google Drive folder — the off-site copy, so a
// backup survives losing the repository as well as losing the database.
//
//   GOOGLE_SERVICE_ACCOUNT_JSON='{"client_email":…,"private_key":…}' \
//   GOOGLE_DRIVE_FOLDER_ID=1AbC… \
//   node scripts/upload-to-drive.mjs backups/phoenix-league-backup-full-….json
//
// Environment:
//   GOOGLE_SERVICE_ACCOUNT_JSON  The service-account key JSON, verbatim.
//   GOOGLE_DRIVE_FOLDER_ID       Target folder id (share the folder with the
//                                service account's email, as Editor).
//   GOOGLE_DRIVE_KEEP            Keep only this many backups in the folder.
//                                Default 12; 0 keeps everything.
//
// Talks to the Drive REST API directly with a self-signed JWT, so there's no
// googleapis dependency to install (and nothing to keep up to date) in what is
// otherwise a Next.js project. Uses the `drive.file` scope, which grants access
// only to files this script itself created — it cannot read the rest of the
// Drive it's uploading into.

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createSign } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const KEEP = Number.isFinite(Number(process.env.GOOGLE_DRIVE_KEEP)) ? Number(process.env.GOOGLE_DRIVE_KEEP) : 12;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Exchange a service-account key for an OAuth access token (RFC 7523).
async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  // Env vars often carry the key with escaped newlines; cert() in the app does
  // the same normalization.
  const key = String(credentials.private_key || "").replace(/\\n/g, "\n");
  const signature = signer.sign(key, "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) fail(`Google rejected the service account: ${body.error_description || JSON.stringify(body)}`);
  return body.access_token;
}

async function upload(token, folderId, path) {
  const name = basename(path);
  const content = await readFile(path, "utf8");
  const boundary = `prlm-${Date.now().toString(16)}`;
  const metadata = { name, parents: [folderId], mimeType: "application/json" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const json = await res.json();
  if (!res.ok) fail(`Drive upload failed: ${json.error?.message || JSON.stringify(json)}`);
  return json;
}

// Trim the folder to the newest KEEP backups. Only ever sees (and so can only
// ever delete) files this script uploaded — that's what the drive.file scope
// restricts it to.
async function prune(token, folderId) {
  if (KEEP <= 0) return 0;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false and name contains 'phoenix-league-backup-'`);
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("fields", "files(id,name,createdTime)");
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) {
    console.warn(`  (couldn't list the Drive folder to prune it: ${json.error?.message || res.status})`);
    return 0;
  }
  const stale = (json.files || []).slice(KEEP);
  for (const file of stale) {
    const del = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?supportsAllDrives=true`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!del.ok) console.warn(`  (couldn't delete ${file.name})`);
  }
  return stale.length;
}

async function main() {
  const path = process.argv[2];
  if (!path) fail("Usage: node scripts/upload-to-drive.mjs <backup-file.json>");

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  if (!raw) fail("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  if (!folderId) fail("GOOGLE_DRIVE_FOLDER_ID is not set.");

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    fail("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid JSON — paste the whole service-account key file.");
  }
  if (!credentials.client_email || !credentials.private_key) {
    fail("That service-account key is missing client_email / private_key.");
  }

  const { size } = await stat(path);
  const token = await getAccessToken(credentials);
  const file = await upload(token, folderId, path);
  console.log(`✓ Uploaded ${file.name} to Google Drive (${(size / 1024).toFixed(0)} KB, id ${file.id})`);

  const pruned = await prune(token, folderId);
  if (pruned) console.log(`✓ Removed ${pruned} older backup(s) from Drive, keeping the newest ${KEEP}`);
}

main().catch(err => fail(err.stack || err.message));
