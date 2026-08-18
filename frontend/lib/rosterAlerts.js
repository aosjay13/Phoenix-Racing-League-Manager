"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LEAGUE_CHANGE_EVENT } from "@/lib/leagueClient";
import { newAdditions } from "@/lib/rosterAdditions";

// The red badge on the sidebar's Driver Roster link: drivers who have been
// approved onto a roster since this admin last opened the screen.
//
// It works like the User Accounts badge and NOT like the Approvals one, and the
// difference is the point. Approvals counts an outstanding JOB — it falls when
// somebody does the work. This counts NEWS: the work is already done, the
// driver is already on the roster, and what's left is for an admin to know
// about it. So it clears by being read, against a "seen" stamp, rather than by
// anything being actioned.
export const ROSTER_SEEN_KEY = "pr_roster_last_seen";
export const ROSTER_SEEN_EVENT = "pr-roster-seen";

const POLL_MS = 60_000;

// Re-check on a timer, so an approval made by one admin reaches another who is
// sitting on a page without them having to navigate.
export function useRosterAdditions(isAdmin) {
  const [additions, setAdditions] = useState([]);

  const load = useCallback(async () => {
    if (!isAdmin) { setAdditions([]); return; }
    try {
      const rows = await api("/api/admin/signup-requests?status=approved");
      // Stamped on the first ever load so an admin opening this for the first
      // time isn't greeted by every driver the league has ever approved. From
      // then on the stamp only moves when they actually read the panel.
      if (Array.isArray(rows) && !localStorage.getItem(ROSTER_SEEN_KEY)) {
        localStorage.setItem(ROSTER_SEEN_KEY, new Date().toISOString());
      }
      setAdditions(newAdditions(rows, localStorage.getItem(ROSTER_SEEN_KEY) || ""));
    } catch { /* leave the count unchanged on transient errors */ }
  }, [isAdmin]);

  useEffect(() => {
    load();
    if (!isAdmin) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    // Approving a sign-up, or marking the panel read, fires this — the badge
    // moves at once rather than up to a minute later.
    // Every count below is scoped to the ACTIVE LEAGUE (api() stamps the
    // header), so a league switch makes the number on screen wrong until the
    // next poll. Re-ask the moment it changes.
    window.addEventListener(LEAGUE_CHANGE_EVENT, load);
    window.addEventListener(ROSTER_SEEN_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(LEAGUE_CHANGE_EVENT, load);
      window.removeEventListener(ROSTER_SEEN_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, isAdmin]);

  return additions;
}

// Marks everything approved up to now as read, and tells every badge on screen
// to re-count. Deliberately NOT called just by opening the screen: the panel is
// the thing that has to be read, so it carries the button that calls this.
export function markRosterSeen() {
  localStorage.setItem(ROSTER_SEEN_KEY, new Date().toISOString());
  window.dispatchEvent(new Event(ROSTER_SEEN_EVENT));
}

// Tells the badge to re-count without marking anything read — for the moment an
// approval happens, so the news appears immediately for whoever approved it.
export function rosterAdditionsChanged() {
  window.dispatchEvent(new Event(ROSTER_SEEN_EVENT));
}
