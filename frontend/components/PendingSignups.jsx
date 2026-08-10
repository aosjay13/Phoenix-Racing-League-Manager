"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { requestSummary } from "@/lib/signupQueue";
import { normalizeAliases } from "@/lib/aliases";

// The approvals queue: players who have submitted a sign-up from their
// Dashboard and are waiting to be let onto this season's roster.
//
// Nothing they submitted is live yet. Approving is what creates the roster
// entry — with the number, car and manufacturer they asked for — and, for a
// player the league has never seen, their driver profile as well. Denying
// leaves them off and records why.
//
// Rendered at the top of Drivers ▸ Roster & Teams, above the roster itself,
// because "who's waiting to get in" belongs next to "who's in".
export function PendingSignups({ seasonId, seasonName, onApproved }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [denying, setDenying] = useState(null);   // request id being denied
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    if (!seasonId) { setRows([]); return Promise.resolve(); }
    return api(`/api/admin/signup-requests?season_id=${seasonId}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [seasonId]);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  async function resolve(req, action, denyReason = "") {
    setBusy(b => ({ ...b, [req.id]: true }));
    try {
      const res = await api(`/api/admin/signup-requests/${req.id}`, {
        method: "PATCH",
        body: { action, ...(denyReason ? { reason: denyReason } : {}) },
      });
      await load();
      if (action === "approve") {
        showToast(res.note ? "error" : "success",
          `${res.driver_name || req.name} is on the roster.`
          + (res.created_driver ? " Their driver profile was created." : "")
          + (res.note ? ` ${res.note}` : ""));
        onApproved?.();
      } else {
        showToast("success", `Denied ${req.name}'s sign-up.`);
      }
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [req.id]: false }));
      setDenying(null);
      setReason("");
    }
  }

  // Nothing waiting is the normal state — stay silent rather than showing an
  // empty panel above every roster.
  if (!rows || rows.length === 0) return null;

  return (
    <div className="form-card pending-signups" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        Pending Sign-ups
        <span className="nav-badge" style={{ position: "static" }}>{rows.length}</span>
      </h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 760 }}>
        Players who have signed up for <strong>{seasonName || "this season"}</strong> from their
        Dashboard. None of them is on the roster yet — <strong>Approve</strong> adds them with the
        number and car they asked for (and creates the driver profile, for anyone new to the
        league). <strong>Deny</strong> leaves them off.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(req => {
          const rBusy = !!busy[req.id];
          const aliases = normalizeAliases(req.aliases).filter(a => a.value);
          const summary = requestSummary(req);
          return (
            <div key={req.id} className="pending-signup-row">
              {req.user_photo
                ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                : <span className="avatar avatar-sm avatar-fallback">{String(req.name || "?")[0]?.toUpperCase()}</span>}
              <span style={{ flex: 1, minWidth: 240 }}>
                <strong>{req.name}</strong>
                {req.new_driver && (
                  <span className="pending-new-badge" title="No driver profile yet — approving creates one">new driver</span>
                )}
                {req.user_email && (
                  <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>
                )}
                <span style={{ display: "block", fontSize: "0.85rem", color: "var(--ink-1)" }}>
                  {summary || "No number or car requested"}
                </span>
                {aliases.length > 0 && (
                  <span style={{ display: "block", marginTop: 2, fontSize: "0.76rem", color: "var(--ink-2)" }}>
                    {aliases.map(a => `${a.label}: ${a.value}`).join(" · ")}
                  </span>
                )}
              </span>
              {denying === req.id ? (
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                    maxLength={300} placeholder="Reason (optional)" style={{ width: 200 }} />
                  <button className="btn btn-danger" style={{ marginTop: 0, padding: "6px 14px" }}
                    disabled={rBusy} onClick={() => resolve(req, "deny", reason)}>
                    {rBusy ? "…" : "Confirm Deny"}
                  </button>
                  <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 10px" }}
                    disabled={rBusy} onClick={() => { setDenying(null); setReason(""); }}>✕</button>
                </span>
              ) : (
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" style={{ marginTop: 0, padding: "6px 14px" }}
                    disabled={rBusy} onClick={() => resolve(req, "approve")}>
                    {rBusy ? "…" : "✓ Approve"}
                  </button>
                  <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 14px" }}
                    disabled={rBusy} onClick={() => { setDenying(req.id); setReason(""); }}>
                    Deny
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
