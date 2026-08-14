"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AWAITING_PLACEMENT_BADGE, AWAITING_PLACEMENT_HINT } from "@/lib/carSelection";
import { signupIsPlacementGated, isNumberChange, requestSummary } from "@/lib/signupQueue";
import { normalizeAliases } from "@/lib/aliases";
import { signupsChanged } from "@/lib/pendingSignupAlerts";

// The approvals queue: players who have submitted a sign-up from their
// Dashboard and are waiting to be let onto a roster.
//
// Nothing they submitted is live yet. Approving is what creates the roster
// entry — with the number and car they asked for — and, for a
// player the league has never seen, their driver profile as well. Denying
// leaves them off and records why.
//
// It renders in two places, off the same component so the two can't drift:
//
//   • with a `seasonId` — at the top of Admin ▸ Driver Roster, showing that
//     ONE season's queue, because "who's waiting to get in" belongs next to
//     "who's in";
//   • with no `seasonId` (`scope="league"`) — on /approvals, the whole league's
//     queue in one list, which is where the sidebar's red badge points. Each
//     row then names the series and season it's for.
//
// A row for a PLACEMENT-GATED series carries an extra flag — "Awaiting
// Placement" — and approving it does something different. That series is one an
// admin marked as earned rather than joined (a Gold Series, a Pro class), so
// the driver submitted a request to be PLACED, not a request for a specific
// spot: approving creates no roster entry, moves the row to
// `approved_for_placements`, and hands them to the Placement Roster tab on
// /approvals until a session sorts them. The toast below says so rather than
// the usual "they're on the roster", which would be untrue.
//
// The API resolves the gate live, so it holds for a series switched on after
// these people signed up.
//
// `empty` is what to render when nothing is waiting. The roster panel passes
// nothing and disappears; the Approvals page says so out loud.
export function PendingSignups({ seasonId = null, seasonName, scope = "season", onApproved, empty = null }) {
  // Only an explicit league scope widens the query — a season-scoped panel with
  // no season selected yet asks for nothing rather than for everything.
  const leagueWide = scope === "league";
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [denying, setDenying] = useState(null);   // request id being denied
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    // Season-scoped with no season chosen yet has nothing to ask for; the
    // league-wide queue omits the filter and gets everything pending.
    if (!leagueWide && !seasonId) { setRows([]); return Promise.resolve(); }
    return api(leagueWide
      ? "/api/admin/signup-requests"
      : `/api/admin/signup-requests?season_id=${seasonId}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [seasonId, leagueWide]);

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
      // One fewer job in the queue — drop the sidebar badge now rather than on
      // its next poll.
      signupsChanged();
      if (action === "approve" && isNumberChange(req)) {
        showToast("success",
          `${res.driver_name || req.name} now runs ${res.number ? `#${res.number}` : "no number"}.`);
        onApproved?.();
      } else if (action === "approve" && res.awaiting_placement) {
        // NOT on the roster, and the toast must not imply otherwise — this is
        // the one approval that seats nobody. Drawn as a warning rather than a
        // success for the same reason: something is still owed.
        showToast("error",
          `${res.driver_name || req.name} is registered for placements — not on the roster yet.`
          + (res.created_driver ? " Their driver profile was created." : "")
          + " They're on the Placement Roster until a session places them.");
        onApproved?.();
      } else if (action === "approve") {
        showToast(res.note ? "error" : "success",
          `${res.driver_name || req.name} is on the roster.`
          + (res.created_driver ? " Their driver profile was created." : "")
          + (res.note ? ` ${res.note}` : ""));
        onApproved?.();
      } else {
        showToast("success", isNumberChange(req)
          ? `Denied ${req.name}'s number change.`
          : `Denied ${req.name}'s sign-up.`);
      }
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [req.id]: false }));
      setDenying(null);
      setReason("");
    }
  }

  if (rows === null) return empty === null ? null : <div className="skeleton" style={{ height: 120 }} />;
  // Nothing waiting is the normal state — stay silent rather than showing an
  // empty panel above every roster. The Approvals page passes an `empty` to
  // say so instead, since a blank page there reads as broken.
  if (rows.length === 0) return empty;

  return (
    <div className="form-card pending-signups" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        Pending Approvals
        <span className="nav-badge" style={{ position: "static" }}>{rows.length}</span>
      </h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 760 }}>
        What players have asked for {leagueWide
          ? <>across <strong>any series in this league</strong></>
          : <>in <strong>{seasonName || "this season"}</strong></>}, from their
        Dashboard. Nothing they sent is live yet. A <strong>sign-up</strong> is approved onto the
        roster with the number and car they asked for (creating their driver profile, for anyone
        new to the league); a <strong>number change</strong> is approved onto the roster entry they
        already have. <strong>Deny</strong> leaves things as they are. A row flagged{" "}
        <strong>⏱ Awaiting Placement</strong> is the exception — that series is placement-graded,
        so approving it registers them for a session and puts them on{" "}
        <strong>no roster</strong>.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(req => {
          const rBusy = !!busy[req.id];
          const numberChange = isNumberChange(req);
          // A number change is about one field on a row that already exists, so
          // its platform usernames aren't the thing being decided — don't
          // repeat them under every row.
          const aliases = numberChange ? [] : normalizeAliases(req.aliases).filter(a => a.value);
          const summary = requestSummary(req);
          // One reading of the gate, shared with the API (lib/signupQueue.js) —
          // a number change is somebody already on the roster, so there's
          // nothing to place.
          const placement = signupIsPlacementGated(req);
          return (
            <div key={req.id} className="pending-signup-row">
              {req.user_photo
                ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                : <span className="avatar avatar-sm avatar-fallback">{String(req.name || "?")[0]?.toUpperCase()}</span>}
              <span style={{ flex: 1, minWidth: 240 }}>
                <strong>{req.name}</strong>
                {numberChange && (
                  <span className="pending-kind-badge" title="Already on the roster — approving changes their car number">number change</span>
                )}
                {!numberChange && req.new_driver && (
                  <span className="pending-new-badge" title="No driver profile yet — approving creates one">new driver</span>
                )}
                {placement && (
                  <span className="pending-placement-badge" title={AWAITING_PLACEMENT_HINT}>
                    ⏱ {AWAITING_PLACEMENT_BADGE}
                  </span>
                )}
                {req.user_email && (
                  <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>
                )}
                {/* Which season they're asking to join. Only worth saying on
                    the league-wide queue — the roster panel is already inside
                    one season. */}
                {leagueWide && (
                  <span style={{ display: "block", fontSize: "0.8rem", color: "var(--accent-cyan)", fontWeight: 600 }}>
                    {[req.series_name, req.season_name].filter(Boolean).join(" · ") || "Unknown season"}
                    {req.game_name && (
                      <span style={{ color: "var(--ink-2)", fontWeight: 400 }}> · {req.game_name}</span>
                    )}
                  </span>
                )}
                <span style={{ display: "block", fontSize: "0.85rem", color: "var(--ink-1)" }}>
                  {summary || "No number or car requested"}
                </span>
                {numberChange && req.reason && (
                  <span style={{ display: "block", marginTop: 2, fontSize: "0.8rem", color: "var(--ink-2)" }}>
                    &ldquo;{req.reason}&rdquo;
                  </span>
                )}
                {aliases.length > 0 && (
                  <span style={{ display: "block", marginTop: 2, fontSize: "0.76rem", color: "var(--ink-2)" }}>
                    {aliases.map(a => `${a.label}: ${a.value}`).join(" · ")}
                  </span>
                )}
                {/* What the flag means and where to act on it. A badge on its
                    own tells an admin something is different about this row
                    without telling them what to do about it, and the hub they
                    need is two screens away. */}
                {placement && (
                  <span className="pending-placement-hint">
                    {AWAITING_PLACEMENT_HINT}{" "}
                    <Link href="/time-trials">Time Trials &amp; Placements →</Link>
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
