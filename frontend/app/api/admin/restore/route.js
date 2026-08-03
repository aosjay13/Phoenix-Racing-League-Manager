import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withOwner } from "@/lib/serverAuth";
import {
  RESTORE_UPLOAD_COLLECTION,
  restoreBackup,
  summarizeBackup,
  validateBackup,
  logBackup,
} from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/admin/restore — import a backup JSON file back into the database.
//
// Owner-only, always. A restore overwrites live data, so unlike the export half
// there is no token/automation path: a human with the top role has to do it.
//
// Two ways in:
//
//  • One shot — { action: "restore", backup, mode, confirm }. Fine for small
//    backups and for scripts.
//
//  • Chunked — the browser path. Hosts cap request bodies (Vercel at ~4.5 MB),
//    and a league with a few seasons of results will sail past that, so the
//    screen uploads the file as a series of { action: "chunk" } calls and then
//    fires { action: "commit" }. The chunks are staged in Firestore and thrown
//    away as soon as the restore finishes (or fails).
//
// `mode`:
//   "merge"   — upsert what's in the backup, leave everything else alone.
//   "replace" — make the database match the backup exactly, deleting rows the
//               backup doesn't have. This is the real recovery mode.
// `confirm` must be the literal string "RESTORE" for either mode to run.

const CONFIRM_PHRASE = "RESTORE";

// Chunks older than this are abandoned uploads (a closed tab mid-upload) and
// get swept up the next time anyone commits one.
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

function chunkDocId(uploadId, index) {
  return `${uploadId}__${String(index).padStart(6, "0")}`;
}

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 });
}

async function storeChunk(body, user) {
  const uploadId = String(body.upload_id || "").trim();
  const index = Number(body.index);
  const total = Number(body.total);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(uploadId)) return badRequest("Bad upload id.");
  if (!Number.isInteger(index) || index < 0) return badRequest("Bad chunk index.");
  if (!Number.isInteger(total) || total < 1) return badRequest("Bad chunk count.");
  if (index >= total) return badRequest("Chunk index past the end of the upload.");
  if (typeof body.data !== "string") return badRequest("Chunk data must be a string.");

  await db().collection(RESTORE_UPLOAD_COLLECTION).doc(chunkDocId(uploadId, index)).set({
    upload_id: uploadId,
    index,
    total,
    data: body.data,
    created_at: new Date().toISOString(),
    uploaded_by: user.uid,
  });
  return NextResponse.json({ ok: true, upload_id: uploadId, index, total });
}

// Reassemble a chunked upload. Returns { text } or { error }.
async function readUpload(uploadId) {
  const snap = await db().collection(RESTORE_UPLOAD_COLLECTION)
    .where("upload_id", "==", uploadId).get();
  if (snap.empty) return { error: "That upload has expired or was never received — try the import again." };
  const chunks = snap.docs.map(d => d.data()).sort((a, b) => a.index - b.index);
  const total = chunks[0].total;
  if (chunks.length !== total) {
    return { error: `The upload is incomplete (${chunks.length} of ${total} pieces arrived) — try the import again.` };
  }
  for (let i = 0; i < total; i++) {
    if (chunks[i].index !== i) return { error: "The upload is missing a piece — try the import again." };
  }
  return { text: chunks.map(c => c.data).join("") };
}

async function deleteUpload(uploadId) {
  const snap = await db().collection(RESTORE_UPLOAD_COLLECTION)
    .where("upload_id", "==", uploadId).get();
  await Promise.all(snap.docs.map(d => d.ref.delete().catch(() => {})));
}

// Best-effort cleanup of uploads someone started and never finished.
async function sweepStaleUploads() {
  try {
    const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
    const snap = await db().collection(RESTORE_UPLOAD_COLLECTION)
      .where("created_at", "<", cutoff).get();
    await Promise.all(snap.docs.map(d => d.ref.delete().catch(() => {})));
  } catch {
    /* non-fatal */
  }
}

// Validate, restore, log. Shared by the one-shot and chunked paths.
async function runRestore(payload, { mode, confirm }, user) {
  if (confirm !== CONFIRM_PHRASE) {
    return badRequest(`Type ${CONFIRM_PHRASE} to confirm before importing — this overwrites live data.`);
  }
  if (mode !== "merge" && mode !== "replace") {
    return badRequest('mode must be "merge" or "replace".');
  }
  const { backup, error } = validateBackup(payload);
  if (error) return badRequest(error);

  const summary = summarizeBackup(backup);
  let result;
  try {
    result = await restoreBackup(backup, { mode });
  } catch (err) {
    return NextResponse.json({ error: `Restore failed partway through: ${err.message}` }, { status: 500 });
  }

  await logBackup({
    kind: "restore",
    mode,
    scope: summary.scope,
    league_id: summary.league_id,
    source_created_at: summary.created_at,
    counts: result.written,
    total: result.total,
    removed: result.removed,
    by: user.email || user.uid,
  });

  return NextResponse.json({ ok: true, mode, source: summary, ...result });
}

export const POST = withOwner(async (request, ctx, user) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Couldn't read the request — the file may be too large to send in one piece.");
  }

  const action = body.action || "restore";

  if (action === "chunk") return storeChunk(body, user);

  if (action === "commit") {
    const uploadId = String(body.upload_id || "").trim();
    if (!uploadId) return badRequest("Bad upload id.");
    const { text, error } = await readUpload(uploadId);
    if (error) {
      await deleteUpload(uploadId);
      return badRequest(error);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      await deleteUpload(uploadId);
      return badRequest("That file isn't valid JSON.");
    }
    try {
      return await runRestore(payload, body, user);
    } finally {
      // The staged copy is scratch space either way — never leave it behind.
      await deleteUpload(uploadId);
      await sweepStaleUploads();
    }
  }

  if (action === "restore") return runRestore(body.backup, body, user);

  return badRequest(`Unknown action "${action}".`);
});
