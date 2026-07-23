"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { withDefaults, normalizeAliases } from "@/lib/aliases";

// Edit a global driver-pool entry straight from the Drivers directory. Editable
// here: name, notes, and the driver's Aliases / Connected Accounts — the
// platform usernames (Discord, PSN, Xbox, Steam, iRacing, …) that let the Smart
// Importer map an imported name to this one Driver Profile no matter which game
// it came from. A driver linked to a player account shows that account's display
// name on their profile, so renaming here affects the fallback name only.
export function DriverEditModal({ driver, onClose, onSaved }) {
  const [form, setForm] = useState({ name: driver.name || "", notes: driver.notes || "" });
  // Seed the alias rows with the standard platforms (pre-filled from any saved
  // values), followed by whatever custom platforms were already stored.
  const [aliases, setAliases] = useState(() => withDefaults(driver.aliases));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function setAlias(i, patch) {
    setAliases(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addAlias() { setAliases(rows => [...rows, { label: "", value: "" }]); }
  function removeAlias(i) { setAliases(rows => rows.filter((_, j) => j !== i)); }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Persist only labelled aliases; blank-value rows are kept (a labelled but
      // empty platform is fine) but rows with no label are dropped.
      const cleanAliases = normalizeAliases(aliases);
      const body = { name: form.name.trim(), notes: form.notes, aliases: cleanAliases };
      const updated = await api(`/api/drivers/${driver.id}`, { method: "PATCH", body });
      onSaved({ ...driver, name: updated.name ?? body.name, notes: body.notes, aliases: cleanAliases });
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

        <div className="field" style={{ marginTop: 8 }}>
          <label style={{ display: "block" }}>Aliases / Connected Accounts</label>
          <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Platform usernames this driver races under. The Smart Importer matches imported names against
            all of these, so results using any of them map back to this profile.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {aliases.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={a.label}
                  onChange={e => setAlias(i, { label: e.target.value })}
                  placeholder="Platform"
                  style={{ flex: "0 0 42%", minWidth: 0 }}
                />
                <input
                  value={a.value}
                  onChange={e => setAlias(i, { value: e.target.value })}
                  placeholder="Username / ID"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" className="btn btn-ghost" title="Remove field"
                  style={{ marginTop: 0, padding: "4px 10px", color: "var(--ink-2)" }}
                  onClick={() => removeAlias(i)}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8, padding: "4px 12px" }} onClick={addAlias}>
            ＋ Add platform
          </button>
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
