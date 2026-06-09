"use client";

import { useState, useEffect, useCallback } from "react";

const API = "";
const CURRENT_SEASON = 2026;

const BLANK_FORM = { name: "", number: "", team: "", season: CURRENT_SEASON };

export default function RosterPage() {
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [editUid, setEditUid] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchDrivers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/drivers?season=${CURRENT_SEASON}`);
      if (res.ok) setDrivers(await res.json());
    } catch {
      showToast("error", "Could not load drivers — is the API running?");
    }
  }, []);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form, number: Number(form.number) };
      const endpoint = editUid ? `${API}/api/drivers/${editUid}` : `${API}/api/drivers`;
      const method = editUid ? "PUT" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast("success", editUid ? "Driver updated." : "Driver added.");
      setForm(BLANK_FORM);
      setEditUid(null);
      fetchDrivers();
    } catch (err) {
      showToast("error", err.message || "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(driver) {
    setEditUid(driver.uid);
    setForm({ name: driver.name, number: driver.number, team: driver.team, season: driver.season });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancel() {
    setEditUid(null);
    setForm(BLANK_FORM);
  }

  async function confirmAndDelete(driver) {
    setConfirmDelete(null);
    try {
      const res = await fetch(`${API}/api/drivers/${driver.uid}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      showToast("success", `Deleted ${driver.name}.`);
      if (editUid === driver.uid) handleCancel();
      fetchDrivers();
    } catch (err) {
      showToast("error", err.message || "Delete failed.");
    }
  }

  return (
    <section>
      <div className="page-title">
        <h2>Roster Management</h2>
        <span className="page-badge">Season {CURRENT_SEASON}</span>
      </div>

      <form className="form-card" style={{ marginTop: 18 }} onSubmit={handleSubmit}>
        <h3>{editUid ? "✏️ Edit Driver" : "➕ Add Driver"}</h3>

        <div className="field">
          <label>Full Name</label>
          <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Alex Turner" />
        </div>
        <div className="field">
          <label>Car Number</label>
          <input required type="number" min={0} max={999} value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} placeholder="e.g. 18" />
        </div>
        <div className="field">
          <label>Team</label>
          <input required value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))} placeholder="e.g. Summit Racing" />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? "Saving…" : editUid ? "Update Driver" : "Add Driver"}
          </button>
          {editUid && (
            <button className="btn btn-ghost" type="button" onClick={handleCancel}>Cancel</button>
          )}
        </div>

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </form>

      {/* Inline delete confirmation */}
      {confirmDelete && (
        <div className="form-card" style={{ marginTop: 14, maxWidth: 560, borderColor: "rgba(230,57,70,0.3)" }}>
          <p style={{ margin: "0 0 14px", color: "var(--ink-0)" }}>
            Remove <strong>{confirmDelete.name}</strong> (#{confirmDelete.number}) from the {CURRENT_SEASON} roster?
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-danger" style={{ marginTop: 0 }} onClick={() => confirmAndDelete(confirmDelete)}>
              Yes, delete
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 0 }} onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="section-header">
        <h3>Current Roster</h3>
        <span className="page-badge">{drivers.length} drivers</span>
      </div>

      <div className="table-wrap">
        {drivers.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">🏎️</span>
            <p>No drivers yet for Season {CURRENT_SEASON}.</p>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>Add your first driver using the form above.</p>
          </div>
        ) : (
          drivers.map(d => (
            <div className="driver-row" key={d.uid}>
              <span className="badge">#{d.number}</span>
              <span style={{ flex: 1 }}>
                <strong style={{ color: "var(--ink-0)" }}>{d.name}</strong>
                <span style={{ color: "var(--ink-1)", marginLeft: 8, fontSize: "0.88rem" }}>{d.team}</span>
              </span>
              <button
                className="btn btn-ghost"
                style={{ marginTop: 0, padding: "5px 14px", fontSize: "0.82rem" }}
                onClick={() => handleEdit(d)}
              >
                Edit
              </button>
              <button
                className="btn btn-danger"
                style={{ marginTop: 0, padding: "5px 14px", fontSize: "0.82rem" }}
                onClick={() => setConfirmDelete(d)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
