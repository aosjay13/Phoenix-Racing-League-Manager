import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { db } from "@/lib/firebase";
import { cacheKeyFor } from "@/lib/statsKey";

// Where the precomputed answers live.
//
// ── What this collection is, and what it is NOT ────────────────────────────
//
// It is DERIVED. Every document in here is the output of the same scoring code
// the app has always run, kept so a reader doesn't have to run it again. The
// league's actual data — results, entries, races, seasons, classes, drivers,
// teams — is only ever READ to build these, never written, never migrated,
// never deleted.
//
// That matters more than it sounds. It means this whole collection can be
// dropped at any moment with no consequence beyond a slow page: readStored()
// answers "no" and the caller recomputes from source, which is exactly what the
// app did before any of this existed. Nothing in here is a source of truth, so
// nothing in here can be lost.
//
// Deliberately NOT part of a backup. lib/backup.js lists its collections
// explicitly and this one is absent on purpose — backing up derived data would
// bloat every snapshot with something a single rebuild regenerates. The same
// reasoning the backup-run log already follows there.
export const STATS_COLLECTION = "aggregated_stats";

// Bump when a change to the scoring code would make a stored answer wrong.
// Documents built under an older version are ignored and rebuilt, so a fix in
// standings.js reaches the screen on the next read rather than waiting for
// somebody to save a result.
export const STATS_BUILD_VERSION = 1;

// Firestore's hard limit is 1 MiB per document. Stay well under it: a payload
// that would push past this is not stored at all and its scope quietly falls
// back to computing live. A slow read is a far better failure than a write that
// throws in the middle of an admin's save.
export const MAX_STORED_BYTES = 800 * 1024;

// Firestore ids can't contain "/" and are capped at 1500 bytes, and a cache key
// holds arbitrary league/season/class ids. Hash it: fixed length, no illegal
// characters, and the same key always lands on the same document.
export function docIdFor(name, leagueId, params = {}) {
  const key = JSON.stringify(cacheKeyFor(name, leagueId, params));
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

// Payloads are stored gzipped, then base64'd because Firestore strings are
// UTF-8 and raw deflate bytes are not valid UTF-8.
//
// This is not premature: the schedule feed measured 254 KB of JSON at twelve
// seasons and grows with every round the league runs. JSON of this shape — long
// runs of repeated keys — compresses about tenfold; base64 gives a third of that
// back, so the stored document lands near a twentieth of the raw size. The
// gunzip on the way out costs well under a millisecond against the hundreds it
// saves.
export function encodePayload(body) {
  return gzipSync(Buffer.from(JSON.stringify(body), "utf8")).toString("base64");
}

export function decodePayload(encoded) {
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

// The stored answer for one scope, or null when there isn't a usable one.
//
// Null is never an error — it means "compute it yourself", and every caller can.
// A document that is missing, built by older scoring code, or corrupt on the way
// out all resolve the same way, because the correct response to all three is the
// same: ignore it and recompute.
export async function readStored(name, leagueId, params = {}) {
  let doc;
  try {
    doc = await db().collection(STATS_COLLECTION).doc(docIdFor(name, leagueId, params)).get();
  } catch (err) {
    console.error("Reading a precomputed stat failed", err);
    return null;
  }
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.version !== STATS_BUILD_VERSION) return null;
  try {
    return { status: data.status ?? 200, body: decodePayload(data.payload_gz) };
  } catch (err) {
    console.error("A precomputed stat could not be decoded — recomputing", err);
    return null;
  }
}

// Store one built answer. Returns what happened, so a rebuild can report how
// much it actually wrote rather than guessing.
//
// Never throws. This is called from the tail of an admin's save, and a save that
// has already been committed must not be reported as failed because a derived
// copy of it could not be filed.
export async function writeStored(name, leagueId, params, { status, body }) {
  try {
    const payload_gz = encodePayload(body);
    if (payload_gz.length > MAX_STORED_BYTES) {
      console.warn(
        `Precomputed ${name} for league ${leagueId || "(none)"} is ${payload_gz.length} bytes ` +
        `— over the ${MAX_STORED_BYTES} cap, so it stays on the live path.`,
      );
      return { written: false, reason: "too-large", bytes: payload_gz.length };
    }
    const ref = db().collection(STATS_COLLECTION).doc(docIdFor(name, leagueId, params));

    // Skip a write that would change nothing. Race weekends save session after
    // session, and most scopes are untouched by any one of them — this is what
    // keeps the Firestore write count down to the handful that actually moved.
    const existing = await ref.get();
    if (existing.exists) {
      const prev = existing.data();
      if (prev.version === STATS_BUILD_VERSION && prev.payload_gz === payload_gz) {
        return { written: false, reason: "unchanged", bytes: payload_gz.length };
      }
    }

    await ref.set({
      league_id: leagueId || null,
      name,
      params,
      status,
      payload_gz,
      version: STATS_BUILD_VERSION,
      built_at: new Date().toISOString(),
    });
    return { written: true, bytes: payload_gz.length };
  } catch (err) {
    console.error(`Storing the precomputed ${name} failed`, err);
    return { written: false, reason: "error" };
  }
}
