"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminGate } from "@/components/AdminGate";
import { AdminMessages } from "@/components/AdminMessages";
import { AwaitingPlacements } from "@/components/AwaitingPlacements";
import { LeagueJoinRequests } from "@/components/LeagueJoinRequests";
import { PendingSignups } from "@/components/PendingSignups";
import { APPROVALS_MIN_LEVEL, SIGNUPS_CHANGED_EVENT } from "@/lib/pendingSignupAlerts";
import { APPROVED_FOR_PLACEMENTS } from "@/lib/signupQueue";
import { useLeagueJoinCount } from "@/lib/leagueJoinAlerts";
import { useAuth } from "@/components/AuthProvider";

// The league-wide approvals queue — where the sidebar's red badge points.
//
// Two jobs live here, and they are deliberately two TABS rather than one long
// page, because they are worked at different times and by different reasoning:
//
//   • Queue — everything nobody has decided yet. Sign-ups, number changes, and
//     the replies players have sent back about decisions already made.
//   • League Join Requests — accounts asking to be let into a league at all,
//     which is a different question from joining one of its series. Scoped to
//     the leagues this account RUNS rather than to the league on screen: a
//     League Admin sees their own league's applicants and nobody else's, and
//     the application Owner sees every league. See
//     components/LeagueJoinRequests.jsx.
//   • Placement Roster — the drivers an approval deliberately did NOT seat.
//     Approving a sign-up for a placement-graded series acknowledges it and
//     puts them on no roster at all, and this is the only screen in the app
//     that says those people exist. It's a roster of a session that hasn't
//     been run yet, so it reads like one: name, series, season, class, and how
//     long they have been waiting.
//
// The same queue is on Admin ▸ Driver Roster, but scoped to the season being
// worked on. This page answers the question the badge asks: "somebody is
// waiting — who, and for what?", across every series in the league at once, so
// nobody sits in the queue merely because an admin never selected their season.
//
// Moderator and above. A Statistician clears the general staff gate but doesn't
// action sign-ups, so they get neither this page nor the badge; the API behind
// both enforces the same floor.
export default function ApprovalsPage() {
  const [tab, setTab] = useState("queue");   // queue | placements | leagues

  // …openable directly. /approvals?tab=placements is the address of the
  // placement roster, so a link from anywhere else in the app (or a message to
  // another admin) lands on the list rather than on the queue with an
  // instruction to click something. Read off the address bar rather than
  // through useSearchParams, which would need a Suspense boundary around a page
  // that is entirely client-rendered anyway.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "placements" || wanted === "leagues") setTab(wanted);
  }, []);

  return (
    <section>
      <div className="page-title">
        <h2>Approvals</h2>
      </div>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        Everything players have asked for and nobody has decided yet, across the whole league —
        <strong> sign-ups</strong> (approving puts that driver on the season&rsquo;s roster with the
        number and car they asked for) and <strong>car number changes</strong> (approving moves the
        number on the roster entry they already have) — plus anything players have said back
        about a decision you&rsquo;ve already made. A sign-up flagged{" "}
        <strong>⏱ Awaiting Placement</strong> is the exception: that series is placement-graded, so
        approving it acknowledges the registration and puts them on <em>no</em> roster — they move
        to the <strong>Placement Roster</strong> tab until a session places them.
      </p>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        <strong>League Join Requests</strong> is a different question: accounts asking to be let
        into a league at all, rather than onto one of its grids. That tab only ever shows the
        leagues <em>you</em> run — a League Admin never sees another league&rsquo;s applicants —
        and approving there grants Player standing in that one league and nothing more.
      </p>

      <AdminGate minLevel={APPROVALS_MIN_LEVEL}>
        <ApprovalsTabs tab={tab} onTab={setTab} />

        {tab === "leagues" ? (
          // Who gets into a LEAGUE, as opposed to who gets onto one of its
          // rosters. Nothing here is scoped to the league on screen — see the
          // component.
          <LeagueJoinRequests
            empty={(
              <div className="empty-state">
                <span className="empty-state-icon">📝</span>
                <p>Nobody is waiting to join a league you run.</p>
              </div>
            )}
          />
        ) : tab === "queue" ? (
          <>
            {/* The conversation half. Every decision made below lands on that
                player's Dashboard, and what they say in reply arrives here — see
                components/AdminMessages.jsx. Renders nothing until the league has
                sent its first message. */}
            <AdminMessages />

            <PendingSignups
              scope="league"
              empty={(
                <div className="empty-state">
                  <span className="empty-state-icon">✅</span>
                  <p>Nothing waiting — every sign-up has been dealt with.</p>
                  <Link href="/roster" className="btn btn-ghost">Go to Driver Roster</Link>
                </div>
              )}
            />
          </>
        ) : (
          // Where an approved placement registration goes. It has left the queue
          // on the other tab — that's what clears the badge — but nobody on this
          // list is on a roster yet, and this is the only screen that says so.
          // See components/AwaitingPlacements.jsx.
          <AwaitingPlacements standalone />
        )}
      </AdminGate>
    </section>
  );
}

// The tab row, with the one count worth carrying: how many drivers are waiting
// on a placement session.
//
// It is a count rather than a red alert badge on purpose. A pending sign-up is
// a job nobody has done; a driver awaiting a placement is a job somebody has
// done exactly right, and the number is how big the next session is — not how
// far behind the league is.
function ApprovalsTabs({ tab, onTab }) {
  const [waiting, setWaiting] = useState(null);
  // Requests to join a league. Badged rather than counted, unlike the placement
  // roster beside it: a placement is a job done right and waiting on a session,
  // an unanswered application is somebody left at the door.
  const { leagueRoles, roleLevel, isGlobalOwner } = useAuth();
  const joinRequests = useLeagueJoinCount({ leagueRoles, roleLevel, isGlobalOwner });

  const load = useCallback(() => api(`/api/admin/signup-requests?status=${APPROVED_FOR_PLACEMENTS}`)
    .then(rows => setWaiting(Array.isArray(rows) ? rows.length : 0))
    .catch(() => setWaiting(null)), []);

  useEffect(() => {
    load();
    // Withdrawing somebody from the placement roster (or approving a gated
    // sign-up into it from the other tab) fires this, so the count moves with
    // the work rather than on the next navigation.
    window.addEventListener(SIGNUPS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SIGNUPS_CHANGED_EVENT, load);
  }, [load]);

  return (
    <div className="tab-row" style={{ flexWrap: "wrap", marginBottom: 16 }}>
      <button type="button" className={`tab${tab === "queue" ? " active" : ""}`}
        title="Sign-ups and number changes waiting on a decision"
        onClick={() => onTab("queue")}>
        ✅ Queue
      </button>
      <button type="button" className={`tab${tab === "placements" ? " active" : ""}`}
        title="Drivers approved for a placement-graded series — acknowledged, and on no roster until a session places them"
        onClick={() => onTab("placements")}>
        ⏱ Placement Roster
        {waiting > 0 && <span className="badge" style={{ marginLeft: 8 }}>{waiting}</span>}
      </button>
      <button type="button" className={`tab${tab === "leagues" ? " active" : ""}`}
        title="Accounts asking to be let into a league you run — approving gives them Player standing in that league only"
        onClick={() => onTab("leagues")}>
        📝 League Join Requests
        {joinRequests > 0 && <span className="nav-badge" style={{ position: "static", marginLeft: 8 }}>{joinRequests}</span>}
      </button>
    </div>
  );
}
