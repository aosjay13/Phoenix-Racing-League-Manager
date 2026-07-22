"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Create a global driver-pool entry straight from the Drivers directory — the
// same identity League Setup's "Create Driver" makes. A driver can optionally
// be linked to a player account; `users` is the account directory the page
// already loaded for the join.
export function DriverPoolCreateModal({ users = [], onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", user_id: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), user_id: form.user_id, notes: form.notes };
      const driver = await api("/api/drivers", { method: "POST", body });
      onCreated(driver);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Driver" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Driver Name</label>
          <input required autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. J. May" />
        </div>
        <div className="field">
          <label>Linked Player Account (optional)</label>
          <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
            <option value="">Not linked</option>
            {users.map(u => <option key={u.uid} value={u.uid}>{u.display_name || u.email || u.uid}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
        </div>
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create Driver"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
