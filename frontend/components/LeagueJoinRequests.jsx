"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { groupJoinRequests, waitingFor } from "@/lib/leagueJoin";
import { leagueJoinsChanged } from "@/lib/leagueJoinAlerts";

// People asking to be let into a league.
//
// This is the other half of strict league isolation. Membership is no longer
// handed out by merely opening a league (it used to be — see
// /api/users/me), so somebody has to decide, and this is where they do it.
// Approving writes ONE key: Player standing in that one league. It hands out no
// staff role, touches no other league, and puts nobody on a season roster —
// joining a series is still its own request, on the Queue tab.
//
// ── What an admin can see here ─────────────────────────────────────────────
//
// Only the leagues they actually run. A Moderator/Admin/Owner of League A sees
// people asking to join League A and nobody else; switching the league menu
// neither widens nor narrows it, because the scope comes from the account's own
// role map rather than from the league on screen. The application Owner sees
// every league's queue. That rule lives on the server
// (lib/leagueJoinServer.js) — this component just renders whatever it is
// allowed to have, which is why there is no league filter in the UI.
//
// Rows are grouped BY LEAGUE for the person who runs more than one: deciding
// who gets into a league is a per-league judgement, and a flat list would
// invite approving somebody into the wrong one.
export function LeagueJoinRequests({ empty = null }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [denying, setDenying] = useState(null);   // request id being denied
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api("/api/admin/league-join-requests")
    .then(list => setRows(Array.isArray(list) ? list : []))
    .catch(() => setRows([])), []);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }

  async function resolve(req, action, denyReason = "") {
    setBusy(b => ({ ...b, [req.id]: true }));
    try {
      const res = await api(`/api/admin/league-join-requests/${req.id}`, {
        method: "PATCH",
        body: { action, ...(denyReason ? { reason: denyReason } : {}) },
      });
      await load();
      // One fewer job in the queue — drop the sidebar badge now rather than on
      // its next poll.
      leagueJoinsChanged();
      if (action === "approve") {
        showToast("success",
          `${res.user_name || req.user_name} is now a ${res.role_label || "Player"} of ${res.league_name || req.league_name}.`
          + (res.granted ? "" : " (They already held standing there.)"));
      } else {
        showToast("success",
          `Turned down ${req.user_name}'s request to join ${req.league_name}.`);
      }
    } catch (err) {
      showToast("error", err.message);
      await load();
    } finally {
      setBusy(b => ({ ...b, [req.id]: false }));
      setDenying(null);
      setReason("");
    }
  }

  if (rows === null) return <div className="skeleton" style={{ height: 140 }} />;
  if (rows.length === 0) {
    return (
      <>
        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
        {empty}
      </>
    );
  }

  const byLeague = groupJoinRequests(rows);

  return (
    <div className="form-card pending-signups" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        League Join Requests
        <span className="nav-badge" style={{ position: "static" }}>{rows.length}</span>
      </h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 760 }}>
        Accounts asking to be let into a league you run. <strong>Approve</strong> gives them
        Player standing in <em>that league only</em> — they appear on its user roster, can be
        linked to one of its driver profiles, and can start signing up for its series.
        It hands out no staff role and changes nothing in any other league.{" "}
        <strong>Deny</strong> grants nothing and records why, which they can read on their own
        Leagues page. Promoting somebody past Player is a separate, deliberate job on{" "}
        <Link href="/accounts">User Accounts</Link>.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {[...byLeague.entries()].map(([leagueId, list]) => (
        <div key={leagueId} style={{ marginTop: 14 }}>
          {/* Which league these people are asking about. Said once per group
              rather than on every row, and said even when there is only one
              group — approving somebody into a league is the kind of thing
              that should never be done from an unlabelled list. */}
          <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem", color: "var(--accent-cyan)" }}>
            {list[0]?.league_name || "League"}
            <span style={{ color: "var(--ink-2)", fontWeight: 400 }}>
              {" "}· {list.length} waiting
            </span>
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {list.map(req => {
              const rBusy = !!busy[req.id];
              const waited = waitingFor(req.created_at);
              return (
                <div key={req.id} className="pending-signup-row">
                  {req.user_photo
                    ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                    : <span className="avatar avatar-sm avatar-fallback">
                        {String(req.user_name || "?")[0]?.toUpperCase()}
                      </span>}
                  <span style={{ flex: 1, minWidth: 240 }}>
                    <strong>{req.user_name || "Unknown"}</strong>
                    <span className="pending-new-badge" title="No standing in this league yet — approving makes them a Player of it">
                      new to this league
                    </span>
                    {req.user_email && (
                      <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>
                    )}
                    <span style={{ display: "block", fontSize: "0.85rem", color: "var(--ink-1)" }}>
                      Asked to join <strong>{req.league_name || "this league"}</strong>
                      {waited && <> · waiting {waited}</>}
                    </span>
                    {req.message && (
                      <span style={{ display: "block", marginTop: 2, fontSize: "0.8rem", color: "var(--ink-2)" }}>
                        &ldquo;{req.message}&rdquo;
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
      ))}
    </div>
  );
}
