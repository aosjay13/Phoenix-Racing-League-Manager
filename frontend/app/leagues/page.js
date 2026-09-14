"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/roles";
import {
  DENIED, MEMBER, PENDING, discoverableLeagues, joinButton, joinStateNote,
} from "@/lib/leagueJoin";

// ── Leagues ────────────────────────────────────────────────────────────────
//
// Every league on the installation, and the one thing a player can do about the
// ones they aren't in: ask to be let in.
//
// This page is the counterpart to the isolation rule. Membership used to be
// automatic — opening a league made you a player of it — and the price of taking
// that away is that somebody has to be able to find a league and knock on the
// door. So this is a deliberately plain list: the league's name, where the
// player stands with it, and a button.
//
// Nothing here grants anything. Pressing Join files a pending request
// (POST /api/league-join-requests) that only that league's own staff — or the
// application Owner — can approve. The page says so before the button is
// pressed, so an approval isn't a surprise and a wait isn't a bug.
//
// It is also the landing page for a brand-new account, which belongs to no
// league at all: see landingRedirect in lib/leagueJoin.js.
export default function LeaguesPage() {
  const { user, profile, leagueRoles, loading, refreshProfile } = useAuth();
  const league = useLeague();
  const [requests, setRequests] = useState(null);
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);

  const loadRequests = useCallback(() => {
    if (!user) { setRequests([]); return Promise.resolve(); }
    return api("/api/league-join-requests")
      .then(rows => setRequests(Array.isArray(rows) ? rows : []))
      .catch(() => setRequests([]));
  }, [user]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  // Re-ask for the account's own standing when this page opens.
  //
  // The profile is fetched at sign-in and on a league switch, so an approval
  // granted since then hasn't reached this browser: the card would still offer
  // "Join League" for a league the player is now in, and pressing it would earn
  // them a 409. One extra read on the one page where membership is the subject.
  useEffect(() => { if (user) refreshProfile(); }, [user, refreshProfile]);

  const rows = useMemo(() => discoverableLeagues({
    leagues: league?.leagues || [],
    leagueRoles,
    requests: requests || [],
    signupLeagueId: profile?.signup_league_id || "",
  }), [league?.leagues, leagueRoles, requests, profile?.signup_league_id]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }

  async function join(row) {
    setBusy(b => ({ ...b, [row.id]: true }));
    try {
      await api("/api/league-join-requests", { method: "POST", body: { league_id: row.id } });
      await loadRequests();
      showToast("success",
        `Request sent to ${row.name || "that league"}. Their admins will review it — you'll be in as soon as one approves.`);
    } catch (err) {
      // "You're already in this league" means the answer arrived while this page
      // sat open. Re-read both sides rather than arguing with the server.
      if (err?.data?.code === "already-a-member") await refreshProfile();
      await loadRequests();
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [row.id]: false }));
    }
  }

  async function withdraw(row) {
    if (!row.request?.id) return;
    setBusy(b => ({ ...b, [row.id]: true }));
    try {
      await api(`/api/league-join-requests/${row.request.id}`, { method: "DELETE" });
      await loadRequests();
      showToast("success", `Withdrew your request to join ${row.name || "that league"}.`);
    } catch (err) {
      await loadRequests();
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [row.id]: false }));
    }
  }

  if (loading) return <div className="skeleton" style={{ height: 260 }} />;

  if (!user) {
    return (
      <section>
        <div className="page-title"><h2>Leagues</h2></div>
        <div className="empty-state">
          <span className="empty-state-icon">📝</span>
          <p>Sign in to find a league and ask to join it.</p>
          <Link href="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </section>
    );
  }

  const mine = rows.filter(r => r.state === MEMBER);
  const waiting = rows.filter(r => r.state === PENDING);

  return (
    <section>
      <div className="page-title">
        <h2>Leagues</h2>
        <Link href="/signups" className="page-badge">Join a series →</Link>
      </div>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        Every league running on this installation. Leagues are kept separate —
        rosters, standings, seasons and staff all belong to one league and nothing carries
        between them — so joining one is something that league <strong>grants</strong> rather
        than something you can take. Press <strong>Join League</strong> and a request goes to
        that league&rsquo;s own admins; you&rsquo;re in the moment one of them approves it.
        Then head to <Link href="/signups">Series Sign-Ups</Link> to get on a grid.
      </p>

      {profile?.unaffiliated && (
        <div className="toast toast-error" style={{ maxWidth: 760 }}>
          <strong>You&rsquo;re not in a league yet.</strong> Until a league lets you in you can
          read its public pages, but you won&rsquo;t appear on its roster or be able to sign up
          for its series. Ask to join one below.
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`} style={{ maxWidth: 760 }}>{toast.msg}</div>}

      {requests === null ? (
        <div className="skeleton" style={{ height: 160, marginTop: 14 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>There aren&rsquo;t any leagues on this installation yet.</p>
        </div>
      ) : (
        <>
          {(mine.length > 0 || waiting.length > 0) && (
            <p style={{ margin: "16px 0 8px", color: "var(--ink-2)", fontSize: "0.82rem" }}>
              {[
                mine.length > 0 ? `In ${mine.length} league${mine.length === 1 ? "" : "s"}` : null,
                waiting.length > 0
                  ? `${waiting.length} request${waiting.length === 1 ? "" : "s"} waiting`
                  : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="join-list">
            {rows.map(row => (
              <LeagueCard key={row.id} row={row} busy={!!busy[row.id]}
                active={row.id === league?.leagueId}
                onJoin={join} onWithdraw={withdraw}
                onOpen={() => league?.switchLeague?.(row.id)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// One league. The left-hand side is what it is; the right-hand side is the one
// action available for the state the player is in.
function LeagueCard({ row, busy, active, onJoin, onWithdraw, onOpen }) {
  const button = joinButton(row.state);
  const note = joinStateNote(row);
  return (
    <div className="join-card">
      <span className="join-card-main" style={{ cursor: "default" }}>
        {row.logo_url
          ? <img src={row.logo_url} alt="" className="join-card-logo" />
          : <span className="join-card-logo join-card-logo-fallback" aria-hidden="true">🏆</span>}
        <span className="join-card-body">
          <strong>{row.name || "League"}</strong>
          {row.description && <span className="join-card-season">{row.description}</span>}
          <span className="join-card-chips">
            {row.state === MEMBER && (
              <span className="join-chip">{ROLE_LABELS[row.role] || "Player"}</span>
            )}
            {active && <span className="join-chip">Viewing</span>}
            {row.state === PENDING && (
              <span className="join-chip join-chip-muted">⏳ Waiting on their admins</span>
            )}
            {row.state === DENIED && <span className="join-chip">Turned down</span>}
          </span>
          {note && (
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>{note}</span>
          )}
        </span>
      </span>

      <div className="join-card-go">
        {/* Somebody who is in this league wants to go and use it, which means
            making it the active one — every other page in the app answers for
            whichever league the switcher is on. */}
        {row.state === MEMBER && !active && (
          <button type="button" className="btn btn-ghost join-card-btn"
            title="Make this the league every other page answers for"
            onClick={onOpen}>
            Open League
          </button>
        )}
        {row.state === PENDING ? (
          <button type="button" className="btn btn-ghost join-card-btn" disabled={busy}
            title="Take your request back — you can ask again later"
            onClick={() => onWithdraw(row)}>
            {busy ? "…" : "Withdraw"}
          </button>
        ) : null}
        <button type="button"
          className={`btn join-card-btn ${row.state === MEMBER ? "btn-ghost" : "btn-primary"}`}
          disabled={button.disabled || busy}
          title={button.title}
          onClick={() => onJoin(row)}>
          {busy && !button.disabled ? "…" : button.label}
        </button>
      </div>
    </div>
  );
}
