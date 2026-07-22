"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Edit a global driver-pool entry straight from the Drivers directory. Only the
// pool fields are editable here (name + notes); a driver linked to a player
// account shows that account's display name on their profile, so renaming here
// affects the fallback name for unlinked drivers.
export function DriverEditModal({ driver, onClose, onSaved }) {
  const [form, setForm] = useState({ name: driver.name || "", notes: driver.notes || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), notes: form.notes };
      const updated = await api(`/api/drivers/${driver.id}`, { method: "PATCH", body });
      onSaved({ ...driver, name: updated.name ?? body.name });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Driver" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Driver Name</label>
          <input required autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jane Doe" />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
        </div>
        {driver.linked && (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            This driver is linked to a player account, so their profile shows the account’s display name.
          </p>
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
