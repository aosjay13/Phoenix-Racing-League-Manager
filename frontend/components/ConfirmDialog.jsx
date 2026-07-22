"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

// A reusable destructive-action confirmation dialog. Renders a warning message
// and a Cancel / Confirm pair; the confirm button shows a busy state while the
// (optionally async) onConfirm runs, and surfaces any thrown error inline
// instead of closing. Callers gate this behind AdminGate / isAdmin — it is
// purely presentational and enforces no permissions itself.
export function ConfirmDialog({
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <p style={{ margin: "10px 0 0", color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.5 }}>
        {message}
      </p>
      {error && (
        <p style={{ margin: "10px 0 0", color: "#f85149", fontSize: "0.85rem" }}>⚠ {error}</p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button type="button" className="btn btn-danger" style={{ marginTop: 0 }} disabled={busy} onClick={run}>
          {busy ? "Deleting…" : confirmLabel}
        </button>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
