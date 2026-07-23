"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminGate } from "@/components/AdminGate";
import { useAuth } from "@/components/AuthProvider";
import { USERS_SEEN_KEY, USERS_SEEN_EVENT } from "@/components/AppShell";
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
  const [requests, setRequests] = useState([]);   // pending driver-claim requests
  const [busy, setBusy] = useState({});   // uid -> true while a write is in flight
  const [reqBusy, setReqBusy] = useState({});   // request id -> true while resolving
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  // Timestamp of the admin's previous visit, captured before the effect below
  // stamps "now" — lets us flag the rows that signed up since then as NEW.
  const prevSeenRef = useRef(typeof window !== "undefined" ? (localStorage.getItem(USERS_SEEN_KEY) || "") : "");

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, d, r] = await Promise.all([
        api("/api/admin/users"),
        api("/api/drivers"),
        api("/api/admin/claim-requests"),
      ]);
      setUsers(u);
      setDrivers(d);
      setRequests(r);
    } catch (err) {
      setError(err.message);
      setUsers([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Opening this page acknowledges every account that exists right now, clearing
  // the red "new signups" badge in the sidebar (see AppShell useNewAccountCount).
  useEffect(() => {
    if (users == null) return;
    localStorage.setItem(USERS_SEEN_KEY, new Date().toISOString());
    window.dispatchEvent(new Event(USERS_SEEN_EVENT));
  }, [users]);

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

  async function resolveRequest(req, action) {
    setReqBusy(b => ({ ...b, [req.id]: true }));
    try {
      await api(`/api/admin/claim-requests/${req.id}`, { method: "PATCH", body: { action } });
      await load();
      // Refresh the sidebar alert badge (pending count changed).
      window.dispatchEvent(new Event(USERS_SEEN_EVENT));
      showToast("success",
        action === "approve"
          ? `Linked ${req.user_name} → ${req.driver_name}.`
          : `Denied ${req.user_name}'s request for ${req.driver_name}.`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setReqBusy(b => ({ ...b, [req.id]: false }));
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

      {requests.length > 0 && (
        <div className="form-card" style={{ marginTop: 16, borderColor: "var(--accent-amber, #ffb224)" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            Pending Profile Claims
            <span className="nav-badge" style={{ position: "static" }}>{requests.length}</span>
          </h3>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 720 }}>
            Players asking to link a <strong>Driver Profile</strong> to their account. Approving writes the link;
            approving one profile auto-denies any other requests for the same profile.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {requests.map(req => {
              const rBusy = !!reqBusy[req.id];
              return (
                <div key={req.id} style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  padding: "10px 12px", borderRadius: 10, background: "var(--card-hover)",
                }}>
                  {req.user_photo
                    ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                    : <span className="avatar avatar-sm avatar-fallback">{String(req.user_name || "?")[0]?.toUpperCase()}</span>}
                  <span style={{ flex: 1, minWidth: 220 }}>
                    <strong>{req.user_name}</strong>
                    {req.user_email && <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>}
                    <span style={{ display: "block", fontSize: "0.85rem", color: "var(--ink-1)" }}>
                      wants to claim{" "}
                      <Link href={`/drivers/${req.driver_id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                        {req.driver_name}
                      </Link>
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" style={{ marginTop: 0, padding: "6px 14px" }}
                      disabled={rBusy} onClick={() => resolveRequest(req, "approve")}>
                      {rBusy ? "…" : "✓ Approve"}
                    </button>
                    <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 14px" }}
                      disabled={rBusy} onClick={() => resolveRequest(req, "deny")}>
                      Deny
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                    const isNew = (u.created_at || "") > prevSeenRef.current;
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
                              {isNew && !isMe && <span className="nav-badge" style={{ marginLeft: 8, position: "static" }}>NEW</span>}
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
