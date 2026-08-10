import { GeoPoint } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";

// ─────────────────────────────────────────────────────────────────────────────
// Whole-application backup & restore.
//
// A backup is a single JSON document holding EVERY Firestore document the app
// owns — league structure, races, results, drivers, accounts and all — keyed by
// collection and document id. Restoring writes those documents back under the
// SAME ids, so every cross-reference in the data (season_id, race_id,
// driver_id, class_id, user_id, …) still resolves afterward. That id fidelity
// is the whole point: an export/import that minted new ids would restore the
// rows but shred the relationships between them.
//
// What a backup does NOT contain:
//   • Firebase Auth accounts (passwords/sign-in providers live in Auth, not
//     Firestore). The `users` docs — display name, role, driver link — restore
//     fine; the sign-in credential behind a uid is Firebase's to keep.
//   • Uploaded images. Those live in Cloud Storage; the docs keep their URLs,
//     which keep working as long as the bucket is intact.
// ─────────────────────────────────────────────────────────────────────────────

export const BACKUP_FORMAT = "phoenix-racing-league-manager/backup";
export const BACKUP_VERSION = 1;

// Collections partitioned per league — every doc carries a `league_id`, so a
// league-scoped backup can filter on it. Kept in sync with (and imported by)
// the containment migration at /api/admin/leagues/migrate.
export const SCOPED_COLLECTIONS = [
  "games", "series", "seasons", "classes", "races", "entries", "teams",
  "results", "drivers", "tracks", "points_templates",
  // Players waiting for an admin to let them onto a roster. Backed up like
  // anything else: a restore that dropped the queue would silently lose
  // everyone who had signed up but not yet been approved.
  "signup_requests",
];

// Collections that belong to the app as a whole rather than to one league.
// `users` and `claim_requests` are people, and an account spans leagues;
// `leagues` is the partition list itself.
export const GLOBAL_COLLECTIONS = ["leagues", "users", "claim_requests"];

export const ALL_COLLECTIONS = [...GLOBAL_COLLECTIONS, ...SCOPED_COLLECTIONS];

// Where automatic/manual export runs are recorded so the admin screen can show
// "last backed up". Deliberately NOT part of a backup — restoring an old copy
// of the log would erase the record of the backups taken since.
export const BACKUP_LOG_COLLECTION = "backup_log";

// Staging area for a chunked restore upload (see readUpload/clearUpload). Also
// excluded from backups: it is transient scratch space, never league data.
export const RESTORE_UPLOAD_COLLECTION = "restore_uploads";

// Firestore writes cap at 500 operations per batch; stay clear of the edge.
const BATCH_SIZE = 400;

// ── Value (de)serialization ─────────────────────────────────────────────────
// Almost everything this app stores is already JSON-native — dates are written
// as ISO strings, points structures as plain objects. But Firestore can hand
// back Timestamp / GeoPoint / DocumentReference / Bytes values (from an older
// write, a console edit, or an import), and JSON.stringify would flatten those
// into unusable shapes. Wrap them in a tagged envelope on the way out and
// rebuild the real instance on the way back in, so a round trip is lossless.

const TAG = "__frb";

function isPlainish(value) {
  return typeof value === "object" && value !== null;
}

export function encodeValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value instanceof Date) return { [TAG]: "date", value: value.toISOString() };
  // Timestamp: duck-typed so we never depend on the exact firebase-admin build.
  if (typeof value.toDate === "function" && typeof value.seconds === "number") {
    return { [TAG]: "timestamp", value: value.toDate().toISOString() };
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { [TAG]: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  // DocumentReference — store the path so it can be rebuilt.
  if (typeof value.path === "string" && value.firestore) {
    return { [TAG]: "ref", value: value.path };
  }
  if (Buffer.isBuffer(value)) return { [TAG]: "bytes", value: value.toString("base64") };
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
  return out;
}

export function decodeValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (isPlainish(value) && typeof value[TAG] === "string") {
    switch (value[TAG]) {
      // Dates and Timestamps both come back as JS Dates; Firestore stores a
      // Date as a Timestamp, which is what the original value was.
      case "date":
      case "timestamp": {
        const d = new Date(value.value);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      case "geopoint":
        return new GeoPoint(value.latitude, value.longitude);
      case "ref":
        return db().doc(value.value);
      case "bytes":
        return Buffer.from(value.value, "base64");
      default:
        return null;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v);
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────

// Read one collection, optionally narrowed to a league. Global collections
// ignore `leagueId` entirely — accounts and the league list itself are never
// partitioned. A scoped collection with no leagueId means "everything",
// including legacy docs that predate the containment migration and so carry no
// league_id at all.
async function readCollection(name, leagueId) {
  const scoped = SCOPED_COLLECTIONS.includes(name);
  const query = scoped && leagueId
    ? db().collection(name).where("league_id", "==", leagueId)
    : db().collection(name);
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, data: encodeValue(d.data()) }));
}

/**
 * Build a full backup payload.
 *
 * @param {object}  opts
 * @param {string}  [opts.scope="all"]  "all" for the entire application, or
 *                                      "league" for just one league's data.
 * @param {string}  [opts.leagueId]     Required when scope is "league".
 * @param {object}  [opts.actor]        The requesting user, recorded in meta.
 * @param {string}  [opts.kind]         "manual" | "scheduled", recorded in meta.
 */
export async function buildBackup({ scope = "all", leagueId = "", actor = null, kind = "manual" } = {}) {
  const leagueScoped = scope === "league" && !!leagueId;
  // A league-scoped backup still needs the league doc itself (so restoring it
  // into an empty project recreates the environment) but not other leagues'.
  const names = leagueScoped
    ? ["leagues", ...SCOPED_COLLECTIONS]
    : ALL_COLLECTIONS;

  const collections = {};
  const counts = {};
  for (const name of names) {
    let docs = await readCollection(name, leagueScoped ? leagueId : "");
    if (leagueScoped && name === "leagues") docs = docs.filter(d => d.id === leagueId);
    collections[name] = docs;
    counts[name] = docs.length;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    scope: leagueScoped ? "league" : "all",
    league_id: leagueScoped ? leagueId : null,
    // Accounts and their roles ride along in an "all" backup; a league-scoped
    // one carries only that league's racing data. Spelled out here so a file
    // found on a drive a year from now still explains itself.
    includes_accounts: !leagueScoped,
    kind,
    created_by: actor ? { uid: actor.uid || null, email: actor.email || null } : null,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    collections,
  };
}

// A filesystem-safe, sortable name for a backup file.
export function backupFilename(backup) {
  const stamp = String(backup?.created_at || new Date().toISOString())
    .replace(/\.\d+Z$/, "Z").replace(/[:]/g, "-");
  const tag = backup?.scope === "league" ? "league" : "full";
  return `phoenix-league-backup-${tag}-${stamp}.json`;
}

// ── Validation ──────────────────────────────────────────────────────────────

// Reject anything that isn't recognisably one of our backups BEFORE it gets
// anywhere near a write batch. Returns { error } or { backup }.
export function validateBackup(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "That file isn't a backup — it didn't parse as a JSON object." };
  }
  if (payload.format !== BACKUP_FORMAT) {
    return { error: "That file isn't a Phoenix Racing League Manager backup (wrong or missing format marker)." };
  }
  if (Number(payload.version) > BACKUP_VERSION) {
    return {
      error: `This backup was written by a newer version of the app (v${payload.version}); this build understands up to v${BACKUP_VERSION}.`,
    };
  }
  if (!payload.collections || typeof payload.collections !== "object") {
    return { error: "That backup has no collections in it." };
  }
  const names = Object.keys(payload.collections);
  const unknown = names.filter(n => !ALL_COLLECTIONS.includes(n));
  if (unknown.length) {
    return { error: `That backup contains unrecognised collections: ${unknown.join(", ")}.` };
  }
  if (!names.length) {
    return { error: "That backup is empty — there's nothing to restore." };
  }
  for (const name of names) {
    const docs = payload.collections[name];
    if (!Array.isArray(docs)) return { error: `Collection "${name}" is malformed (expected a list of documents).` };
    for (const doc of docs) {
      if (!doc || typeof doc !== "object" || !doc.id || typeof doc.data !== "object" || doc.data === null) {
        return { error: `Collection "${name}" contains a malformed document (each needs an "id" and a "data" object).` };
      }
      // A document id is a single path segment. A "/" in one would resolve to a
      // subcollection — i.e. a hand-edited or hostile file could write outside
      // the collections this restore is supposed to touch.
      const id = String(doc.id);
      if (id.includes("/") || id === "." || id === "..") {
        return { error: `Collection "${name}" contains an invalid document id ("${id}").` };
      }
    }
  }
  return { backup: payload };
}

// A quick, side-effect-free summary for the confirmation screen.
export function summarizeBackup(backup) {
  const counts = {};
  for (const [name, docs] of Object.entries(backup.collections || {})) counts[name] = docs.length;
  return {
    created_at: backup.created_at || null,
    scope: backup.scope || "all",
    league_id: backup.league_id || null,
    version: backup.version ?? null,
    kind: backup.kind || null,
    created_by: backup.created_by || null,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// ── Restore ─────────────────────────────────────────────────────────────────

async function commitInBatches(operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = db().batch();
    for (const op of operations.slice(i, i + BATCH_SIZE)) op(batch);
    await batch.commit();
  }
}

// Which existing docs a "replace" restore is allowed to delete. Only ever the
// docs the backup itself covers: an "all" backup owns whole collections, while
// a league-scoped backup owns only that league's rows — so restoring one league
// can never wipe another league sharing the same project.
async function docsToDelete(name, backup, keepIds) {
  const leagueScoped = backup.scope === "league" && backup.league_id;
  if (leagueScoped && name === "leagues") return [];        // never touch other leagues
  if (leagueScoped && GLOBAL_COLLECTIONS.includes(name)) return [];
  const query = leagueScoped && SCOPED_COLLECTIONS.includes(name)
    ? db().collection(name).where("league_id", "==", backup.league_id)
    : db().collection(name);
  const snap = await query.get();
  return snap.docs.filter(d => !keepIds.has(d.id)).map(d => d.ref);
}

/**
 * Write a backup back into Firestore.
 *
 * mode:
 *   "merge"   — upsert every document in the backup, leaving anything not in
 *               it untouched. Safe for filling in what was lost.
 *   "replace" — the true disaster-recovery restore: after upserting, DELETE
 *               every document in the covered collections that the backup
 *               doesn't contain, so the result matches the backup exactly.
 *
 * Documents are written with their original ids and with `set()` (no merge), so
 * a restored doc is the backup's doc — not the backup's fields layered over
 * whatever corrupted state was there.
 *
 * @returns {Promise<{written: object, deleted: object, total: number, removed: number}>}
 */
export async function restoreBackup(backup, { mode = "merge" } = {}) {
  const replace = mode === "replace";
  const written = {};
  const deleted = {};

  for (const [name, docs] of Object.entries(backup.collections)) {
    const ops = docs.map(doc => batch => {
      batch.set(db().collection(name).doc(String(doc.id)), decodeValue(doc.data));
    });
    await commitInBatches(ops);
    written[name] = docs.length;

    if (replace) {
      const keep = new Set(docs.map(d => String(d.id)));
      const refs = await docsToDelete(name, backup, keep);
      await commitInBatches(refs.map(ref => batch => batch.delete(ref)));
      deleted[name] = refs.length;
    } else {
      deleted[name] = 0;
    }
  }

  return {
    written,
    deleted,
    total: Object.values(written).reduce((a, b) => a + b, 0),
    removed: Object.values(deleted).reduce((a, b) => a + b, 0),
  };
}

// ── Backup log ──────────────────────────────────────────────────────────────

// Record that a backup was taken, so the admin screen can answer "when did this
// last run?" without anyone having to go look at a drive. Best-effort: a
// logging failure must never fail the export that succeeded.
export async function logBackup(entry) {
  try {
    await db().collection(BACKUP_LOG_COLLECTION).add({
      created_at: new Date().toISOString(),
      ...entry,
    });
  } catch {
    /* non-fatal */
  }
}

export async function readBackupLog(limit = 20) {
  try {
    const snap = await db().collection(BACKUP_LOG_COLLECTION).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}
