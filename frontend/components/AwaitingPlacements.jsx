"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { APPROVED_FOR_PLACEMENTS } from "@/lib/signupQueue";
import { signupsChanged } from "@/lib/pendingSignupAlerts";

// Drivers who registered for a placement-graded series, were acknowledged, and
// are on no roster.
//
// This list exists because of what approving one of those sign-ups deliberately
// does NOT do. A tier marked "Placements Required" is earned in a session, so
// approving its sign-up creates no roster entry — it moves the row to
// `approved_for_placements`, which clears the queue and the badge. That is the
// behaviour asked for, and on its own it loses people: off the queue, off the
// badge, on no roster, with nothing anywhere saying a session is owed them.
//
// So the acknowledgement has somewhere to land. It is a TO-DO list, not a feed:
// oldest first, never truncated, and it says out loud that nobody on it is
// racing yet.
//
// The only action offered is the one that gets it wrong back out again — a
// driver who registered and never turned up. Putting somebody ON a roster is
// not a button here on purpose: that happens by placing them in a session and
// building the roster from it, which is the whole point of the gate.
export function AwaitingPlacements() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [denying, setDenying] = useState(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api(`/api/admin/signup-requests?status=${APPROVED_FOR_PLACEMENTS}`)
    .then(r => setRows(Array.isArray(r) ? r : []))
    .catch(() => setRows([])), []);

  useEffect(() => { load(); }, [load]);

  async function drop(req) {
    setBusy(b => ({ ...b, [req.id]: true }));
    try {
      await api(`/api/admin/signup-requests/${req.id}`, {
        method: "PATCH",
        body: { action: "deny", ...(reason ? { reason } : {}) },
      });
      await load();
      signupsChanged();
      setToast({ type: "success", msg: `${req.name} is no longer awaiting a placement.` });
    } catch (err) {
      setToast({ type: "error", msg: err.message });
    } finally {
      setBusy(b => ({ ...b, [req.id]: false }));
      setDenying(null);
      setReason("");
      setTimeout(() => setToast(null), 4500);
    }
  }

  // Nothing waiting is the normal state for a league that doesn't gate anything,
  // so say nothing at all rather than showing an empty panel to everyone.
  if (!rows?.length) return null;

  return (
    <div className="form-card awaiting-placements" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        ⏱ Awaiting Placement
        <span className="badge">{rows.length}</span>
      </h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 760 }}>
        Registrations you&rsquo;ve approved for a <strong>placement-graded</strong> series.
        They&rsquo;re acknowledged and out of the queue &mdash; and{" "}
        <strong>none of these drivers is on a roster</strong>. Run them through a session in{" "}
        <Link href="/time-trials" className="awaiting-placements-link">
          Time Trials &amp; Placements
        </Link>{" "}
        and press <strong>Complete Session</strong>; building the roster from that session is what
        puts them on a grid, in the class their times earned.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(req => {
          const rBusy = !!busy[req.id];
          return (
            <div key={req.id} className="pending-signup-row">
              {req.user_photo
                ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                : <span className="avatar avatar-sm avatar-fallback">{String(req.name || "?")[0]?.toUpperCase()}</span>}
              <span style={{ flex: 1, minWidth: 240 }}>
                <strong>{req.name}</strong>
                <span className="pending-placement-badge">⏱ Not on a roster</span>
                {req.user_email && (
                  <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>
                )}
                <span style={{ display: "block", fontSize: "0.8rem", color: "var(--accent-cyan)", fontWeight: 600 }}>
                  {[req.series_name, req.season_name].filter(Boolean).join(" · ") || "Unknown season"}
                  {req.class_names?.length ? (
                    <span style={{ color: "var(--ink-2)", fontWeight: 400 }}>
                      {" "}· asked for {req.class_names.join(" · ")}
                    </span>
                  ) : null}
                </span>
                {/* Registered, not approved onto anything — the date that
                    matters is how long they've been waiting for a session. */}
                <span style={{ display: "block", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                  Registered {formatWhen(req.created_at)}
                  {req.number ? ` · asked for #${req.number}` : ""}
                  {req.car ? ` · ${req.car}` : ""}
                </span>
              </span>
              {denying === req.id ? (
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                    maxLength={300} placeholder="Reason (optional)" style={{ width: 200 }} />
                  <button className="btn btn-danger" style={{ marginTop: 0, padding: "6px 14px" }}
                    disabled={rBusy} onClick={() => drop(req)}>
                    {rBusy ? "…" : "Confirm"}
                  </button>
                  <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 10px" }}
                    disabled={rBusy} onClick={() => { setDenying(null); setReason(""); }}>✕</button>
                </span>
              ) : (
                <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 14px" }}
                  title="They never turned up to a session. Takes them off this list and tells them why."
                  disabled={rBusy} onClick={() => { setDenying(req.id); setReason(""); }}>
                  Withdraw
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "3 days ago" beats a timestamp here: the question this list answers is how
// long somebody has been waiting, not the minute they pressed the button.
function formatWhen(iso) {
  const then = Date.parse(iso ?? "");
  if (!Number.isFinite(then)) return "at some point";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString();
}
