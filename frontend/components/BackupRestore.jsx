"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { clientAuth } from "@/lib/firebaseClient";
import { getActiveLeagueId } from "@/lib/leagueClient";

// Backup & Restore — the Owner-only recovery screen in League Setup.
//
// Export writes the whole application (or one league) to a single JSON file.
// Import reads one back. Both halves are deliberately blunt instruments with a
// lot of signposting: this is the screen someone opens on the worst day, after
// a crash, a bad import or a compromised account, and it should be obvious what
// each button is about to do.

const CONFIRM_PHRASE = "RESTORE";

// Uploads are staged server-side in Firestore docs (1 MB ceiling each), and the
// host caps a single request body well below the size of a full backup — so the
// file goes up in pieces. 400k characters leaves generous headroom for
// multi-byte characters in driver names.
const CHUNK_CHARS = 400_000;

// Friendly names for the raw Firestore collection keys, so the summary reads
// like the app rather than like the database.
const COLLECTION_LABELS = {
  leagues: "Leagues",
  users: "User accounts",
  claim_requests: "Claim requests",
  games: "Games",
  series: "Series",
  seasons: "Seasons",
  classes: "Classes",
  races: "Races",
  entries: "Roster entries",
  teams: "Teams",
  results: "Results",
  drivers: "Drivers",
  tracks: "Tracks",
  points_templates: "Points templates",
};

function label(key) {
  return COLLECTION_LABELS[key] || key;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function randomId() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// A table of per-collection record counts — used for both the file being
// imported and the result of the import.
function CountsTable({ counts, removed }) {
  const rows = Object.entries(counts || {}).filter(([, n]) => n > 0);
  if (!rows.length) return <p style={{ color: "var(--ink-2)", fontSize: "0.85rem" }}>No records.</p>;
  return (
    <div className="backup-counts">
      {rows.map(([key, n]) => (
        <div key={key} className="backup-count">
          <span className="backup-count-n">{n.toLocaleString()}</span>
          <span className="backup-count-label">{label(key)}</span>
          {removed && removed[key] > 0 && (
            <span className="backup-count-removed">−{removed[key].toLocaleString()} removed</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function BackupRestore() {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const { league: active, leagueId, reloadLeagues, refresh } = useLeague() || {};

  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [log, setLog] = useState([]);

  // The file the admin picked, parsed and checked in the browser before a byte
  // is sent — so a wrong file is caught instantly instead of after an upload.
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [mode, setMode] = useState("merge");
  const [confirmText, setConfirmText] = useState("");
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const flash = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 6000);
  }, []);

  const loadLog = useCallback(() => {
    api("/api/admin/backup/log").then(setLog).catch(() => setLog([]));
  }, []);
  useEffect(() => { if (isOwner) loadLog(); }, [isOwner, loadLog]);

  if (!isOwner) {
    return (
      <div>
        <h3 className="setup-section-title">
          Backup &amp; Restore
          <span className="setup-section-hint">Owner only</span>
        </h3>
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <p style={{ margin: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
            Only the league Owner can export or import the application&rsquo;s data.
          </p>
        </div>
      </div>
    );
  }

  // ── Export ───────────────────────────────────────────────────────────────
  async function download() {
    setBusy(true);
    try {
      const user = clientAuth().currentUser;
      const headers = {};
      if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
      const activeId = getActiveLeagueId();
      if (activeId) headers["X-League-Id"] = activeId;

      const res = await fetch(`/api/admin/backup?scope=${scope}&pretty=1`, { headers, cache: "no-store" });
      if (!res.ok) {
        let msg = `Backup failed (${res.status})`;
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || "phoenix-league-backup.json";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      flash("success", `Saved ${name} (${formatBytes(blob.size)}). Keep a copy somewhere off this machine.`);
      loadLog();
    } catch (err) {
      flash("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────
  async function pickFile(e) {
    const picked = e.target.files?.[0] || null;
    setFile(null); setPreview(null); setFileError(null); setResult(null); setConfirmText("");
    if (!picked) return;
    try {
      const text = await picked.text();
      const parsed = JSON.parse(text);
      if (parsed?.format !== "phoenix-racing-league-manager/backup") {
        setFileError("That doesn't look like a Phoenix Racing League Manager backup file.");
        return;
      }
      const counts = {};
      for (const [key, docs] of Object.entries(parsed.collections || {})) {
        counts[key] = Array.isArray(docs) ? docs.length : 0;
      }
      setFile({ name: picked.name, size: picked.size, text });
      setPreview({
        created_at: parsed.created_at,
        scope: parsed.scope || "all",
        league_id: parsed.league_id || null,
        includes_accounts: parsed.includes_accounts !== false && (parsed.scope || "all") === "all",
        kind: parsed.kind,
        created_by: parsed.created_by,
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      });
    } catch (err) {
      setFileError(`Couldn't read that file: ${err.message}`);
    }
  }

  async function runImport() {
    if (!file || confirmText.trim().toUpperCase() !== CONFIRM_PHRASE) return;
    setBusy(true);
    setResult(null);
    try {
      const uploadId = randomId();
      const chunks = [];
      for (let i = 0; i < file.text.length; i += CHUNK_CHARS) {
        chunks.push(file.text.slice(i, i + CHUNK_CHARS));
      }
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ done: i, total: chunks.length });
        await api("/api/admin/restore", {
          method: "POST",
          body: { action: "chunk", upload_id: uploadId, index: i, total: chunks.length, data: chunks[i] },
        });
      }
      setProgress({ done: chunks.length, total: chunks.length, restoring: true });

      const res = await api("/api/admin/restore", {
        method: "POST",
        body: { action: "commit", upload_id: uploadId, mode, confirm: CONFIRM_PHRASE },
      });
      setResult(res);
      setConfirmText("");
      flash("success",
        `Restored ${res.total.toLocaleString()} record${res.total === 1 ? "" : "s"}` +
        (res.removed ? ` and removed ${res.removed.toLocaleString()} that weren't in the backup.` : "."));
      await reloadLeagues?.();
      refresh?.();
      loadLog();
    } catch (err) {
      flash("error", err.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  return (
    <div>
      <h3 className="setup-section-title">
        Backup &amp; Restore
        <span className="setup-section-hint">
          Export the whole application to a JSON file — and put it back if you ever need to
        </span>
      </h3>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="two-col" style={{ marginTop: 14 }}>
        {/* ── Export ── */}
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>Export a Backup</h3>
          <p style={{ color: "var(--ink-1)", fontSize: "0.88rem", marginTop: -2 }}>
            Downloads one JSON file containing every record the app has — leagues, games, series,
            seasons, classes, races, sessions, results, drivers, teams, tracks, points templates,
            roster entries, user accounts and their roles. Every record keeps its original ID, so
            importing the file rebuilds the data <em>and</em> every link between it.
          </p>

          <div className="field"><label>What to export</label>
            <select value={scope} onChange={e => setScope(e.target.value)}>
              <option value="all">Entire application (recommended)</option>
              <option value="league">Only the active league{active?.name ? ` — ${active.name}` : ""}</option>
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              {scope === "all"
                ? "Everything, including user accounts and every league. This is the file you want for disaster recovery."
                : "Just this league's racing data. User accounts are not included, so this file can be shared or moved between projects."}
            </span>
          </div>

          <button className="btn btn-primary" disabled={busy || (scope === "league" && !leagueId)} onClick={download}>
            {busy ? "Working…" : "⬇ Download Backup JSON"}
          </button>
          {scope === "league" && !leagueId && (
            <p style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>Select a league in the top bar first.</p>
          )}

          <p style={{ fontSize: "0.78rem", color: "var(--ink-2)", marginBottom: 0 }}>
            <strong>Not in the file:</strong> sign-in passwords (those live in Firebase Auth, not in the
            database) and uploaded images (those stay in storage; the file keeps their links).
          </p>
        </div>

        {/* ── Import ── */}
        <div className="form-card backup-danger-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>Import a Backup</h3>
          <p style={{ color: "var(--ink-1)", fontSize: "0.88rem", marginTop: -2 }}>
            Reads a backup file back into the live database. Use this after a crash, a corruption, or a
            bad import — or to clone the app into a fresh Firebase project.
          </p>

          <div className="field"><label>Backup file</label>
            <input type="file" accept="application/json,.json" onChange={pickFile} disabled={busy} />
          </div>

          {fileError && <div className="toast toast-error">{fileError}</div>}

          {preview && (
            <div className="backup-preview">
              <p style={{ margin: "0 0 8px" }}>
                <strong>{file.name}</strong> · {formatBytes(file.size)}
              </p>
              <p style={{ margin: "0 0 8px", fontSize: "0.84rem", color: "var(--ink-1)" }}>
                Taken <strong>{formatWhen(preview.created_at)}</strong>
                {preview.kind ? ` (${preview.kind})` : ""} ·{" "}
                {preview.scope === "league" ? "one league" : "entire application"} ·{" "}
                {preview.total.toLocaleString()} record{preview.total === 1 ? "" : "s"}
                {preview.created_by?.email ? ` · by ${preview.created_by.email}` : ""}
              </p>
              <CountsTable counts={preview.counts} />
            </div>
          )}

          {preview && (
            <>
              <div className="field"><label>How to import</label>
                <select value={mode} onChange={e => setMode(e.target.value)} disabled={busy}>
                  <option value="merge">Merge — add and overwrite, keep everything else</option>
                  <option value="replace">Replace — make the database match the backup exactly</option>
                </select>
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  {mode === "merge"
                    ? "Every record in the file is written over the top of what's there now. Records added since the backup was taken are left alone. Safest option."
                    : "As well as writing the file's records, this DELETES anything the backup doesn't contain — races run since, drivers added since, accounts created since. Use it when the live data is corrupted and you want the backup, exactly."}
                </span>
              </div>

              {mode === "replace" && (
                <div className="toast toast-error" style={{ marginBottom: 10 }}>
                  ⚠ Replace deletes live records that aren&rsquo;t in this backup
                  {preview.scope === "league"
                    ? " (within this backup's league only — other leagues and all user accounts are untouched)."
                    : ", across the whole application, including user accounts."}{" "}
                  Export a fresh backup first if you might want today&rsquo;s data back.
                </div>
              )}

              <div className="field"><label>Type {CONFIRM_PHRASE} to confirm</label>
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE} disabled={busy} autoComplete="off" />
              </div>

              <button className="btn btn-danger" disabled={busy || !confirmed} onClick={runImport}>
                {busy
                  ? (progress?.restoring
                      ? "Restoring…"
                      : `Uploading ${progress ? `${progress.done}/${progress.total}` : ""}…`)
                  : `Import & ${mode === "replace" ? "Replace" : "Merge"}`}
              </button>
            </>
          )}

          {result && (
            <div className="backup-preview" style={{ marginTop: 12 }}>
              <p style={{ margin: "0 0 8px" }}>
                ✅ Restored <strong>{result.total.toLocaleString()}</strong> record
                {result.total === 1 ? "" : "s"}
                {result.removed ? ` · removed ${result.removed.toLocaleString()}` : ""}
              </p>
              <CountsTable counts={result.written} removed={result.deleted} />
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
                Reload the page to see the restored data everywhere.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Automatic backups ── */}
      <div className="form-card" style={{ maxWidth: "100%", marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Automatic Weekly Backup</h3>
        <p style={{ color: "var(--ink-1)", fontSize: "0.88rem", marginTop: -2 }}>
          A scheduled job takes the same full export every <strong>Saturday at 3:00 AM Eastern</strong> and
          files it away without anyone having to remember. It commits the JSON into the{" "}
          <code>backups/</code> folder of the GitHub repository, keeps a copy as a downloadable workflow
          artifact, and — if a Google Drive folder is configured — uploads it there too. See{" "}
          <code>.github/workflows/weekly-backup.yml</code> and the Backups section of the README for the
          two secrets it needs.
        </p>

        <h4 style={{ margin: "14px 0 6px", fontSize: "0.9rem" }}>Recent backup activity</h4>
        {log.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: "0.85rem", margin: 0 }}>
            Nothing recorded yet. Runs show up here as soon as the first export — manual or scheduled — completes.
          </p>
        ) : (
          <div className="backup-log">
            {log.map(row => (
              <div key={row.id} className="backup-log-row">
                <span className={`backup-log-kind kind-${row.kind || "manual"}`}>
                  {row.kind === "scheduled" ? "🕒 Scheduled" : row.kind === "restore" ? "♻ Restore" : "👤 Manual"}
                </span>
                <span className="backup-log-when">{formatWhen(row.created_at)}</span>
                <span className="backup-log-meta">
                  {row.scope === "league" ? "one league" : "entire app"} · {Number(row.total || 0).toLocaleString()} records
                  {row.mode ? ` · ${row.mode}` : ""}
                  {row.removed ? ` · ${row.removed} removed` : ""}
                  {row.by ? ` · ${row.by}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
