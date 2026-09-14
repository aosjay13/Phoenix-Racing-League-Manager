"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canApproveLeagueJoins } from "@/lib/leagueJoin";

// The league-join half of the sidebar's Approvals badge.
//
// Modelled on lib/pendingSignupAlerts.js, with one difference that matters: a
// pending sign-up belongs to the ACTIVE league, so that badge re-counts when the
// league switches. A league join request belongs to whichever league it names,
// and this count covers every league the account RUNS — so switching leagues
// doesn't change it, and nothing here listens for the switch.
export const LEAGUE_JOINS_CHANGED_EVENT = "pr-league-joins-changed";

const POLL_MS = 60_000;

// Tells every badge on screen to re-count — call it after deciding a request.
export function leagueJoinsChanged() {
  window.dispatchEvent(new Event(LEAGUE_JOINS_CHANGED_EVENT));
}

// Pending league join requests this account is allowed to decide, or 0 for
// anybody who runs no league. The fetch is not attempted at all in that case,
// so a plain player's browser never calls the admin API.
export function useLeagueJoinCount(standing) {
  const allowed = canApproveLeagueJoins(standing);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!allowed) { setCount(0); return; }
    try {
      const res = await api("/api/admin/league-join-requests/count");
      setCount(Number(res?.pending) || 0);
    } catch { /* leave the count unchanged on transient errors */ }
  }, [allowed]);

  useEffect(() => {
    load();
    if (!allowed) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    window.addEventListener(LEAGUE_JOINS_CHANGED_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(LEAGUE_JOINS_CHANGED_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, allowed]);

  return count;
}
