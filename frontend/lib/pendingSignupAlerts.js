"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_LEVEL } from "@/lib/roles";

// The red badge on the sidebar's Approvals link: how many player sign-ups are
// waiting for an admin to approve or deny them, league-wide.
//
// Unlike the User Accounts badge (lib/userAccountsAlerts.js) there is no
// "seen" baseline to stamp. A pending sign-up is not a notification that can be
// read and dismissed — it's an outstanding job, and it stays on the badge until
// somebody actions it. Approving or denying one is what makes the number fall,
// which is exactly what an admin expects of a queue counter.
export const SIGNUPS_CHANGED_EVENT = "pr-signups-changed";

// Re-check on a timer so a sign-up submitted while an admin sits on one page
// raises the badge without a navigation.
const POLL_MS = 60_000;

// Approvals are worked by Moderators and up. A Statistician clears the general
// AdminGate but doesn't run the queue, so neither the badge nor the API call
// behind it is theirs — the route enforces the same floor (see
// /api/admin/signup-requests/count).
export const APPROVALS_MIN_LEVEL = ROLE_LEVEL.moderator;

export function canSeeApprovals(roleLevel) {
  return (roleLevel ?? 0) >= APPROVALS_MIN_LEVEL;
}

// Count of pending sign-ups, or 0 for anyone who isn't allowed to see it. The
// fetch is not even attempted below Moderator, so a regular player's browser
// never calls the admin API at all.
export function usePendingSignupCount(roleLevel) {
  const allowed = canSeeApprovals(roleLevel);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!allowed) { setCount(0); return; }
    try {
      const res = await api("/api/admin/signup-requests/count");
      setCount(Number(res?.pending) || 0);
    } catch { /* leave the count unchanged on transient errors */ }
  }, [allowed]);

  useEffect(() => {
    load();
    if (!allowed) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    // Approving or denying from the queue fires this, so the badge drops the
    // moment the work is done rather than up to a minute later.
    window.addEventListener(SIGNUPS_CHANGED_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SIGNUPS_CHANGED_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, allowed]);

  return count;
}

// Tells every badge on screen to re-count — call it after resolving a sign-up.
export function signupsChanged() {
  window.dispatchEvent(new Event(SIGNUPS_CHANGED_EVENT));
}

// "3 sign-ups waiting for approval" — the badge's tooltip.
export function pendingSignupsTitle(count) {
  if (!count) return "No sign-ups waiting";
  return `${count} sign-up${count === 1 ? "" : "s"} waiting for approval`;
}
