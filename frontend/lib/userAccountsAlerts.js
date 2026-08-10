"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// localStorage key + custom event shared by everything that shows the "new
// accounts" alert: the sidebar (components/AppShell.jsx), the Drivers page tab
// row, and the User Accounts tab itself (components/UserAccountsManager.jsx),
// which stamps "everything up to now has been seen" when an admin opens it and
// so clears the red badges everywhere at once.
export const USERS_SEEN_KEY = "pr_users_last_seen";
export const USERS_SEEN_EVENT = "pr-users-seen";

// How often we re-check for signups that happened while the admin sat on a
// page — without this the badge only appears on the next navigation.
const ALERTS_POLL_MS = 60_000;

const EMPTY = { accounts: 0, claims: 0, total: 0 };

// Count of User Accounts items needing admin attention: accounts created since
// the admin last opened the User Accounts tab PLUS pending driver-claim
// requests. The new-signup baseline is stamped to "now" on first ever load so
// an admin isn't greeted by their whole existing roster.
//
// `total` counts *people*, not events: a brand-new signup who also asks to
// claim a driver profile is one person to look at, so they're counted once
// rather than showing up in both halves and inflating the badge.
export function useUserAccountsAlerts(isAdmin) {
  const [alerts, setAlerts] = useState(EMPTY);

  const load = useCallback(async () => {
    if (!isAdmin) { setAlerts(EMPTY); return; }
    try {
      const [users, requests] = await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/claim-requests"),
      ]);
      const userList = Array.isArray(users) ? users : [];
      const claimList = Array.isArray(requests) ? requests : [];
      if (Array.isArray(users) && !localStorage.getItem(USERS_SEEN_KEY)) {
        localStorage.setItem(USERS_SEEN_KEY, new Date().toISOString());
      }
      const seen = localStorage.getItem(USERS_SEEN_KEY) || "";
      const newUids = new Set(
        userList.filter(u => (u.created_at || "") > seen).map(u => u.uid)
      );
      const people = new Set(newUids);
      for (const r of claimList) people.add(r.uid || `claim:${r.id}`);
      setAlerts({ accounts: newUids.size, claims: claimList.length, total: people.size });
    } catch { /* leave count unchanged on transient errors */ }
  }, [isAdmin]);

  useEffect(() => {
    load();
    function onSeen() { load(); }
    // Re-check on a timer and whenever the admin comes back to the tab, so a
    // signup during an open session raises the badge on its own.
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, ALERTS_POLL_MS);
    window.addEventListener(USERS_SEEN_EVENT, onSeen);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(USERS_SEEN_EVENT, onSeen);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return alerts;
}

// "2 new accounts · 1 driver claim request" — spells out what the badge covers.
export function alertsTitle({ accounts, claims }) {
  const parts = [];
  if (accounts) parts.push(`${accounts} new account${accounts === 1 ? "" : "s"}`);
  if (claims) parts.push(`${claims} driver claim request${claims === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing new";
}

// Marks every account that exists right now as seen and tells the sidebar +
// tab row to drop their badges.
export function markUserAccountsSeen() {
  localStorage.setItem(USERS_SEEN_KEY, new Date().toISOString());
  window.dispatchEvent(new Event(USERS_SEEN_EVENT));
}
