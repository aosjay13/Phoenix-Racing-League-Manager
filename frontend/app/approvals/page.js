"use client";

import Link from "next/link";
import { AdminGate } from "@/components/AdminGate";
import { AdminMessages } from "@/components/AdminMessages";
import { PendingSignups } from "@/components/PendingSignups";
import { APPROVALS_MIN_LEVEL } from "@/lib/pendingSignupAlerts";

// The league-wide approvals queue — where the sidebar's red badge points.
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
        about a decision you&rsquo;ve already made.
      </p>

      <AdminGate minLevel={APPROVALS_MIN_LEVEL}>
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
      </AdminGate>
    </section>
  );
}
