"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/components/AuthProvider";
import { USERS_SEEN_KEY, USERS_SEEN_EVENT } from "@/components/AppShell";
import { api } from "@/lib/api";
import { ROLE_LABELS, roleLevel, canManage, assignableRoles } from "@/lib/roles";

// Small coloured pill showing a role, keyed by the role's rank so Owner reads
// as the strongest. Used wherever a role can't (or shouldn't) be edited.
const ROLE_PILL = {
  owner: { bg: "var(--accent-amber, #ffb224)", fg: "#1a1205" },
  admin: { bg: "var(--accent-cyan, #2ee6d6)", fg: "#04201d" },
  moderator: { bg: "var(--border-accent, #3a5bd0)", fg: "#eaf0ff" },
  statistician: { bg: "var(--card-hover, #2a2a33)", fg: "var(--ink-0)" },
  player: { bg: "transparent", fg: "var(--ink-2)" },
};
function RoleBadge({ role, locked, title }) {
  const c = ROLE_PILL[role] || ROLE_PILL.player;
  return (
    <span title={title} style={{
      display: "inline-block", padding: "4px 12px", borderRadius: 999, minWidth: 96,
      fontSize: "0.8rem", fontWeight: 600, background: c.bg, color: c.fg,
      border: role === "player" ? "1px solid var(--border)" : "none",
    }}>
      {locked ? "🔒 " : ""}{ROLE_LABELS[role] || "Player"}
    </span>
  );
}

// Searchable driver-profile picker rendered as a proper select: a trigger that
// always shows the current link, and a roomy dropdown listing every driver with
// its availability (unclaimed / linked here / linked to another account).
function DriverLinkSelect({ drivers, valueId, valueName, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setText(""); } }
    function onKey(e) { if (e.key === "Escape") { setOpen(false); setText(""); } }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const list = drivers || [];
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return list;
    return list.filter(d => String(d.name || "").toLowerCase().includes(q));
  }, [list, text]);

  function pick(id, name) {
    setOpen(false);
    setText("");
    onChange?.(id, name);
  }

  return (
    <div ref={boxRef} style={{ position: "relative", minWidth: 260 }}>
      {/* Trigger — reads like a native <select>, always shows the current link. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
          padding: "8px 12px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
          background: "var(--bg-elevated)", border: `1px solid ${valueId ? "var(--border-accent)" : "var(--border)"}`,
          color: valueId ? "var(--ink-0)" : "var(--ink-2)", opacity: disabled ? 0.6 : 1,
        }}>
        <span className="avatar avatar-sm avatar-fallback">{valueId ? "🏎" : "＋"}</span>
        <span style={{ flex: 1, fontWeight: valueId ? 600 : 400 }}>
          {valueId ? valueName : "No driver linked — click to link"}
        </span>
        <span style={{ color: "var(--ink-2)", fontSize: "0.7rem" }}>▾</span>
      </button>

      {open && !disabled && (
        <div style={{
          position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)", overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              ref={inputRef}
              value={text}
              placeholder={`Search ${list.length} driver${list.length === 1 ? "" : "s"}…`}
              onChange={e => setText(e.target.value)}
              autoComplete="off"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {/* Always-present "no driver" / unlink option. */}
            <button type="button" onClick={() => pick(null, null)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "9px 12px", background: !valueId ? "var(--accent-cyan-dim)" : "transparent",
                border: "none", borderBottom: "1px solid var(--border)",
                color: valueId ? "var(--accent-red, #e5484d)" : "var(--ink-1)", cursor: "pointer",
              }}>
              <span className="avatar avatar-sm avatar-fallback">{valueId ? "✕" : "—"}</span>
              <span>{valueId ? "Unlink current profile" : "No driver linked"}</span>
            </button>

            {matches.length === 0 ? (
              <div style={{ padding: "12px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
                No driver matches “{text}”.
              </div>
            ) : matches.map(d => {
              const isCurrent = d.id === valueId;
              const takenElsewhere = d.user_id && !isCurrent;
              return (
                <button key={d.id} type="button" onClick={() => pick(d.id, d.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    padding: "9px 12px", background: isCurrent ? "var(--accent-cyan-dim)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border)", color: "var(--ink-0)", cursor: "pointer",
                  }}>
                  <span className="avatar avatar-sm avatar-fallback">🏎</span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block" }}>{d.name}</strong>
                    <span style={{
                      fontSize: "0.72rem",
                      color: isCurrent ? "var(--accent-cyan)" : takenElsewhere ? "var(--accent-amber, #ffb224)" : "var(--ink-2)",
                    }}>
                      {isCurrent ? "✓ Linked to this account" : takenElsewhere ? "Linked to another account — picking overrides it" : "Available to link"}
                    </span>
                  </span>
                  {isCurrent && <span style={{ color: "var(--accent-cyan)" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// The account directory: roles, driver-profile links and pending claims.
// Rendered as the "User Accounts" tab of the Drivers page (it used to be its
// own /admin/users screen).
export function UserAccountsManager() {
  const { user: me, role: myRole, roleLevel: myLevel } = useAuth();
  const [users, setUsers] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [requests, setRequests] = useState([]);   // pending driver-claim requests
  const [busy, setBusy] = useState({});   // uid -> true while a write is in flight
  const [reqBusy, setReqBusy] = useState({});   // request id -> true while resolving
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);   // account pending deletion
  const [editingName, setEditingName] = useState(null);     // uid whose name is being edited
  const [nameDraft, setNameDraft] = useState("");
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

  async function deleteAccount(u) {
    await api(`/api/admin/users/${u.uid}`, { method: "DELETE" });
    await load();
    window.dispatchEvent(new Event(USERS_SEEN_EVENT));
    showToast("success", `Deleted ${u.display_name || u.email || "account"}.`);
  }

  function changeRole(u, newRole) {
    if (newRole === u.role) return;
    patchUser(u.uid, { role: newRole },
      `${u.display_name || "User"} is now ${ROLE_LABELS[newRole] || newRole}.`);
  }

  function startEditName(u) { setEditingName(u.uid); setNameDraft(u.display_name || ""); }
  function cancelEditName() { setEditingName(null); setNameDraft(""); }
  async function saveName(u) {
    const dn = nameDraft.trim();
    if (!dn || dn === (u.display_name || "")) { cancelEditName(); return; }
    await patchUser(u.uid, { display_name: dn }, `Renamed to “${dn}”.`);
    cancelEditName();
  }

  function linkDriver(u, driverId, driverName) {
    patchUser(u.uid, { driver_id: driverId || "" },
      driverId ? `Linked ${u.display_name || "user"} → ${driverName}.` : `Unlinked ${u.display_name || "user"}.`);
  }

  // Roles this admin is allowed to hand out (never above their own level).
  const roleOptions = useMemo(() => assignableRoles(myRole), [myRole]);
  const staffCount = useMemo(() => (users || []).filter(u => roleLevel(u.role) >= roleLevel("statistician")).length, [users]);

  return (
    <section>
      <div className="page-title"><h2>User Accounts</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 720 }}>
        Everyone who has signed in to the league. Assign each account a <strong>role</strong> —
        Owner ▸ Admin ▸ Moderator ▸ Statistician all manage league data; Players don&apos;t —
        and link each account to the statistical <strong>Driver Profile</strong> it races as, so you always know who is who.
        You can only manage accounts ranked at or below your own role.
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
            {users.length} account{users.length === 1 ? "" : "s"} · {staffCount} staff
          </p>
          <div className="table-wrap">
              <table className="stats-table" style={{ width: "100%", minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Account</th>
                    <th style={{ textAlign: "left" }}>Email</th>
                    <th style={{ textAlign: "left", minWidth: 240 }}>Linked Driver Profile</th>
                    <th style={{ textAlign: "center", minWidth: 150 }}>Role</th>
                    <th style={{ textAlign: "center" }}>Manage</th>
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
                            {editingName === u.uid ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <input autoFocus value={nameDraft} disabled={isBusy}
                                  onChange={e => setNameDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveName(u); if (e.key === "Escape") cancelEditName(); }}
                                  style={{ width: 160, padding: "4px 8px" }} placeholder="Display name" />
                                <button type="button" className="btn btn-primary" style={{ marginTop: 0, padding: "4px 10px" }} disabled={isBusy} onClick={() => saveName(u)}>Save</button>
                                <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 8px" }} disabled={isBusy} onClick={cancelEditName}>✕</button>
                              </span>
                            ) : (
                              <span>
                                <strong>{name}</strong>
                                {(isMe || canManage(myRole, u.role)) && (
                                  <button type="button" className="btn btn-ghost" title="Edit display name"
                                    style={{ marginTop: 0, padding: "0 6px", color: "var(--ink-2)" }}
                                    disabled={isBusy} onClick={() => startEditName(u)}>✎</button>
                                )}
                                {isMe && <span style={{ fontSize: "0.72rem", color: "var(--ink-2)" }}> (you)</span>}
                                {isNew && !isMe && <span className="nav-badge" style={{ marginLeft: 8, position: "static" }}>NEW</span>}
                              </span>
                            )}
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
                            <RoleBadge role="owner" locked title="Permanent Owner set via ADMIN_EMAILS" />
                          ) : isMe ? (
                            <RoleBadge role={u.role} title="You can't change your own role" />
                          ) : !canManage(myRole, u.role) ? (
                            // Target ranks at or above the viewer — read-only.
                            <RoleBadge role={u.role} title={`${ROLE_LABELS[u.role]} ranks at or above your role — you can't change it`} />
                          ) : (
                            <select
                              value={u.role}
                              disabled={isBusy}
                              onChange={e => changeRole(u, e.target.value)}
                              style={{ minWidth: 140, padding: "6px 10px" }}
                              title="Set this account's role"
                            >
                              {roleOptions.map(r => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {u.env_admin || isMe || !canManage(myRole, u.role) ? (
                            <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }} title={
                              isMe ? "You can't delete your own account"
                                : u.env_admin ? "Permanent Owner — can't be deleted"
                                : `${ROLE_LABELS[u.role]} ranks at or above your role — you can't delete it`
                            }>—</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ marginTop: 0, padding: "6px 14px" }}
                              disabled={isBusy}
                              onClick={() => setDeletingUser(u)}
                            >
                              Delete
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

      {deletingUser && (
        <ConfirmDialog
          title="Delete Account"
          message={`Permanently delete ${deletingUser.display_name || deletingUser.email || "this account"}? Their linked driver profile returns to the unclaimed pool (race results stay on record), and they'll be signed out and unable to sign back in. This can't be undone.`}
          confirmLabel="Delete Account"
          onConfirm={() => deleteAccount(deletingUser)}
          onClose={() => setDeletingUser(null)}
        />
      )}
    </section>
  );
}
