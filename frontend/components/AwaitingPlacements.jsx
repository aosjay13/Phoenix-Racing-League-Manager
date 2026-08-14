"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { APPROVED_FOR_PLACEMENTS } from "@/lib/signupQueue";
import { applyQueueFilters, queueFilterOptions, waitingFor } from "@/lib/placementQueue";
import { signupsChanged } from "@/lib/pendingSignupAlerts";

// The Placement Roster: drivers who registered for a placement-graded tier,
// were acknowledged, and are on no roster.
//
// This list exists because of what approving one of those sign-ups deliberately
// does NOT do. A tier marked "Placements Required" is earned in a session, so
// approving its sign-up creates no roster entry — it moves the row to
// `approved_for_placements`, which clears the queue and the badge. That is the
// behaviour asked for, and on its own it loses people: off the queue, off the
// badge, on no roster, with nothing anywhere saying a session is owed them.
//
// So the acknowledgement has somewhere to land, and it is drawn as a ROSTER
// rather than as a feed — the same table shape as the season rosters next door,
// because that is what it is: the field of a season that hasn't been sorted
// yet. Every row says which Series, Season and Class the driver signed up for,
// since "who is waiting for the season I'm about to run?" is the only question
// anybody opens this with, and Game ▸ Series ▸ Season dropdowns above narrow it
// to exactly that.
//
// Oldest first, never truncated: whoever has been waiting longest is the driver
// the next session is owed to.
//
// The only action offered is the one that gets a mistake back out again — a
// driver who registered and never turned up. Putting somebody ON a roster is
// not a button here on purpose: that happens by placing them in a session and
// building the roster from it, which is the whole point of the gate. Completing
// that session is also what takes them off this list (see
// lib/placementQueueServer.js), so it stays a list of people still owed one.
//
// `standalone` is what to do with an empty queue. On its own tab an empty panel
// reads as broken, so it says so out loud; embedded under another list it
// renders nothing at all, which is the normal state for a league that gates
// nothing.
export function AwaitingPlacements({ standalone = false }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [denying, setDenying] = useState(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState({ game_id: "", series_id: "", season_id: "" });

  const load = useCallback(() => api(`/api/admin/signup-requests?status=${APPROVED_FOR_PLACEMENTS}`)
    .then(r => setRows(Array.isArray(r) ? r : []))
    .catch(() => setRows([])), []);

  useEffect(() => { load(); }, [load]);

  // The menus are built from the QUEUE, not from the league's hierarchy: a
  // season nobody is waiting for is a dead end, and this screen is only ever
  // opened to find the people who are.
  const all = rows || [];
  const options = useMemo(() => queueFilterOptions(all, filters), [all, filters]);
  const shown = useMemo(() => applyQueueFilters(all, filters), [all, filters]);

  // Picking a game or series drops any narrower filter that no longer belongs
  // to it — otherwise the roster empties with nothing on screen saying why.
  function setFilter(patch) {
    setFilters(f => {
      const next = { ...f, ...patch };
      if (patch.game_id !== undefined) { next.series_id = ""; next.season_id = ""; }
      if (patch.series_id !== undefined) next.season_id = "";
      return next;
    });
  }

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

  // Still loading. Nothing is drawn either way — a skeleton for a panel that
  // usually has nothing in it is worse than a moment of silence.
  if (rows === null) return null;
  if (!rows.length && !standalone) return null;

  return (
    <div className="form-card awaiting-placements" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        ⏱ Placement Roster
        <span className="badge">{rows.length}</span>
      </h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 820 }}>
        Registrations you&rsquo;ve approved for a <strong>placement-graded</strong> series.
        They&rsquo;re acknowledged and out of the approvals queue &mdash; and{" "}
        <strong>none of these drivers is on a roster</strong>. Open{" "}
        <Link href="/time-trials" className="awaiting-placements-link">
          Time Trials &amp; Placements
        </Link>, pick the divisions the session is sorting into, press{" "}
        <strong>Import from Placements Queue</strong> to pull this list onto the sheet, and
        complete the session. Building the roster from it is what puts them on a grid, in the
        class their times earned — and what takes them off this list.
      </p>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Game ▸ Series ▸ Season, the same drill-down as the top bar, but scoped
          to this list rather than to the league — an admin preparing one
          season's placement night wants that season's field and nothing else. */}
      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label htmlFor="pr_game">Game</label>
            <select id="pr_game" value={filters.game_id}
              onChange={e => setFilter({ game_id: e.target.value })}>
              <option value="">All Games</option>
              {options.games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label htmlFor="pr_series">Series</label>
            <select id="pr_series" value={filters.series_id}
              onChange={e => setFilter({ series_id: e.target.value })}>
              <option value="">All Series</option>
              {options.series.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label htmlFor="pr_season">Season</label>
            <select id="pr_season" value={filters.season_id}
              onChange={e => setFilter({ season_id: e.target.value })}>
              <option value="">All Seasons</option>
              {options.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <span style={{ fontSize: "0.8rem", color: "var(--ink-2)", paddingBottom: 6 }}>
            Showing <strong style={{ color: "var(--ink-0)" }}>{shown.length}</strong> of {rows.length}{" "}
            waiting
            {shown.length !== rows.length && (
              <button className="btn btn-ghost" type="button"
                style={{ marginTop: 0, marginLeft: 8, padding: "2px 10px", fontSize: "0.78rem" }}
                onClick={() => setFilters({ game_id: "", series_id: "", season_id: "" })}>
                Clear filters
              </button>
            )}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🎽</span>
          <p>
            Nobody is waiting on a placement session. Approving a sign-up for a series marked{" "}
            <strong>Placements Required</strong> puts that driver here rather than on a roster.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p style={{ color: "var(--ink-2)", fontSize: "0.86rem" }}>
          Nobody waiting matches those filters — {rows.length} driver{rows.length === 1 ? " is" : "s are"}{" "}
          waiting on other series.
        </p>
      ) : (
        <PlacementRosterTable rows={shown} action={req => {
          const rBusy = !!busy[req.id];
          if (denying !== req.id) {
            return (
              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 14px" }}
                title="They never turned up to a session. Takes them off this roster and tells them why."
                disabled={rBusy} onClick={() => { setDenying(req.id); setReason(""); }}>
                Withdraw
              </button>
            );
          }
          return (
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                maxLength={300} placeholder="Reason (optional)" style={{ width: 170 }} />
              <button className="btn btn-danger" style={{ marginTop: 0, padding: "6px 14px" }}
                disabled={rBusy} onClick={() => drop(req)}>
                {rBusy ? "…" : "Confirm"}
              </button>
              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 10px" }}
                disabled={rBusy} onClick={() => { setDenying(null); setReason(""); }}>✕</button>
            </span>
          );
        }} />
      )}
    </div>
  );
}

// The roster itself: one waiting driver per row, in the same table the season
// rosters use.
//
// Every column here is one an admin asked for by name — who, and exactly what
// they signed up for — because the decision this screen supports is "which of
// these people is the session I'm about to run for?", and a list of names alone
// can't answer it. The class column says "the session decides" rather than
// going blank for a driver who picked none: an undecided division is the normal
// case on a placement-graded series, not missing data.
//
// Split out from the panel above so it can be rendered — and asserted on —
// without a network round trip (see lib/__tests__/placementQueue.test.jsx).
export function PlacementRosterTable({ rows = [], action = null }) {
  return (
    <div className="table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th className="sticky-col" style={{ textAlign: "left" }}>Driver</th>
            <th style={{ textAlign: "left" }}>Series</th>
            <th style={{ textAlign: "left" }}>Season</th>
            <th style={{ textAlign: "left" }}>Class signed up for</th>
            <th style={{ textAlign: "left" }}>Asked for</th>
            <th style={{ textAlign: "left" }}>Waiting since</th>
            {action && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map(req => (
            <tr key={req.id}>
              <td className="sticky-col" style={{ textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {req.user_photo
                    ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                    : <span className="avatar avatar-sm avatar-fallback">
                      {String(req.name || "?")[0]?.toUpperCase()}
                    </span>}
                  <span>
                    <strong>{req.name}</strong>
                    {/* The whole point of the list, on every row: they are not
                        racing yet, however much this looks like a roster. */}
                    <span className="pending-placement-badge">⏱ Not on a roster</span>
                    {req.user_email && (
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>
                        {req.user_email}
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td style={{ textAlign: "left" }}>
                <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                  {req.series_name || "Unknown series"}
                </span>
                {req.game_name && (
                  <span style={{ display: "block", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                    {req.game_name}
                  </span>
                )}
              </td>
              <td style={{ textAlign: "left" }}>{req.season_name || "—"}</td>
              <td style={{ textAlign: "left" }}>
                {req.class_names?.length
                  ? req.class_names.map(name => (
                    <span key={name} className="class-scope-chip" style={{ marginRight: 4 }}>{name}</span>
                  ))
                  : <span style={{ color: "var(--ink-2)" }}>Undecided — the session decides</span>}
              </td>
              <td style={{ textAlign: "left", fontSize: "0.82rem", color: "var(--ink-1)" }}>
                {[req.number ? `#${req.number}` : null, req.car || null]
                  .filter(Boolean).join(" · ") || <span style={{ color: "var(--ink-2)" }}>—</span>}
              </td>
              <td style={{ textAlign: "left", fontSize: "0.82rem", color: "var(--ink-1)" }}>
                {waitingFor(req.created_at)}
              </td>
              {action && <td>{action(req)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
