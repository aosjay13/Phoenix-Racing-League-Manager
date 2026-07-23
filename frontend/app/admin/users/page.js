"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminGate } from "@/components/AdminGate";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";

// Searchable driver-profile picker. Typing filters the global roster; picking a
// row (or "Unlink") reports the chosen driver id (or null) up to the caller.
function DriverLinkSelect({ drivers, valueId, valueName, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setText(""); } }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = drivers || [];
    if (!q) return list;
    return list.filter(d => String(d.name || "").toLowerCase().includes(q));
  }, [drivers, text]);

  function pick(id, name) {
    setOpen(false);
    setText("");
    onChange?.(id, name);
  }

  return (
    <div ref={boxRef} style={{ position: "relative", minWidth: 220 }}>
      <input
        value={open ? text : (valueName || "")}
        disabled={disabled}
        placeholder={valueId ? valueName : "Search roster to link…"}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setText(""); }}
        autoComplete="off"
        style={valueId ? { fontWeight: 600 } : undefined}
      />
      {open && !disabled && (
        <div style={{
          position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0,
          maxHeight: 260, overflowY: "auto", background: "var(--bg-elevated)",
          border: "1px solid var(--border)", borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}>
          {valueId && (
            <button type="button" onClick={() => pick(null, null)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "8px 12px", background: "transparent", border: "none",
                borderBottom: "1px solid var(--border)", color: "var(--accent-red, #e5484d)", cursor: "pointer",
              }}>
              <span className="avatar avatar-sm avatar-fallback">✕</span>
              <span>Unlink current profile</span>
            </button>
          )}
          {matches.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
              No matching driver in the roster.
            </div>
          ) : matches.map(d => (
            <button key={d.id} type="button" onClick={() => pick(d.id, d.name)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "8px 12px", background: d.id === valueId ? "var(--accent-cyan-dim)" : "transparent",
                border: "none", color: "var(--ink-0)", cursor: "pointer",
              }}>
              <span className="avatar avatar-sm avatar-fallback">🏎</span>
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block" }}>{d.name}</strong>
                {d.user_id && d.user_id !== valueId && (
                  <span style={{ fontSize: "0.72rem", color: "var(--accent-amber, #ffb224)" }}>
                    already linked to another account — picking overrides it
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserAccountsInner() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [busy, setBusy] = useState({});   // uid -> true while a write is in flight
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, d] = await Promise.all([api("/api/admin/users"), api("/api/drivers")]);
      setUsers(u);
      setDrivers(d);
    } catch (err) {
      setError(err.message);
      setUsers([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patchUser(uid, body, successMsg) {
    setBusy(b => ({ ...b, [uid]: true }));
    try {
      await api(`/api/admin/users/${uid}`, { method: "PATCH", body });
      await load();
      if (successMsg) showToast("success", successMsg);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [uid]: false }));
    }
  }

  function toggleAdmin(u) {
    const makeAdmin = u.role !== "admin";
    patchUser(u.uid, { role: makeAdmin ? "admin" : "player" },
      makeAdmin ? `${u.display_name || "User"} is now an admin.` : `Admin access revoked for ${u.display_name || "user"}.`);
  }

  function linkDriver(u, driverId, driverName) {
    patchUser(u.uid, { driver_id: driverId || "" },
      driverId ? `Linked ${u.display_name || "user"} → ${driverName}.` : `Unlinked ${u.display_name || "user"}.`);
  }

  const adminCount = useMemo(() => (users || []).filter(u => u.role === "admin").length, [users]);

  return (
    <section>
      <div className="page-title"><h2>User Accounts</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 720 }}>
        Everyone who has signed in to the league. Grant or revoke <strong>admin</strong> access, and link each
        real account to the statistical <strong>Driver Profile</strong> it races as, so you always know who is who.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {error && <div className="empty-state"><span className="empty-state-icon">⚠️</span><p>{error}</p></div>}

      {users == null ? (
        <div className="skeleton" style={{ height: 240, marginTop: 16 }} />
      ) : users.length === 0 && !error ? (
        <div className="empty-state">
          <span className="empty-state-icon">👥</span>
          <p>No users have signed in yet.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: "0.8rem", color: "var(--ink-2)", margin: "12px 0 8px" }}>
            {users.length} account{users.length === 1 ? "" : "s"} · {adminCount} admin{adminCount === 1 ? "" : "s"}
          </p>
          <div className="table-wrap">
              <table className="stats-table" style={{ width: "100%", minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Account</th>
                    <th style={{ textAlign: "left" }}>Email</th>
                    <th style={{ textAlign: "left", minWidth: 240 }}>Linked Driver Profile</th>
                    <th style={{ textAlign: "center" }}>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isBusy = !!busy[u.uid];
                    const isMe = me?.uid === u.uid;
                    const name = u.display_name || u.email || "Unknown";
                    return (
                      <tr key={u.uid}>
                        <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {u.photo_url
                              ? <img src={u.photo_url} alt="" className="avatar avatar-sm" />
                              : <span className="avatar avatar-sm avatar-fallback">{String(name)[0]?.toUpperCase()}</span>}
                            <span>
                              <strong>{name}</strong>
                              {isMe && <span style={{ fontSize: "0.72rem", color: "var(--ink-2)" }}> (you)</span>}
                            </span>
                          </span>
                        </td>
                        <td style={{ textAlign: "left", whiteSpace: "normal", color: "var(--ink-1)" }}>{u.email || <span style={{ color: "var(--ink-2)" }}>—</span>}</td>
                        <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                          <DriverLinkSelect
                            drivers={drivers}
                            valueId={u.driver_id}
                            valueName={u.driver_name}
                            disabled={isBusy}
                            onChange={(id, dname) => linkDriver(u, id, dname)}
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {u.env_admin ? (
                            <span className="page-badge" title="Permanent admin set via ADMIN_EMAILS">🔒 Owner</span>
                          ) : (
                            <button
                              type="button"
                              className={`btn ${u.role === "admin" ? "btn-primary" : "btn-ghost"}`}
                              style={{ marginTop: 0, padding: "6px 14px", minWidth: 96 }}
                              disabled={isBusy || (isMe && u.role === "admin")}
                              title={isMe && u.role === "admin" ? "You can't remove your own admin access" : "Toggle admin access"}
                              onClick={() => toggleAdmin(u)}
                            >
                              {u.role === "admin" ? "✓ Admin" : "Make Admin"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function UserAccountsPage() {
  return <AdminGate><UserAccountsInner /></AdminGate>;
}
