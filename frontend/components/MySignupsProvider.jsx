"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

// ONE load of /api/users/me/series — "which series am I in, and what's still
// open to join?" — for the whole app.
//
// Three things read that answer: the Sign-ups screen (app/signups), the badge
// on its sidebar link, and the Dashboard's Series Information card. It's a
// context rather than a hook each of them calls because the route does real
// work per open season (a roster query and a pending-queue query apiece), so
// three copies of it would be three times the reads for one answer — and three
// answers that could disagree with each other for a second after a sign-up.
//
// Nothing is fetched at all for a signed-out visitor: somebody reading the
// standings has no sign-ups, and their browser shouldn't be asking.
//
// Everything DERIVED from the payload lives in lib/signupFlow.js and is pure,
// so the counts on the badge and the lists on the screen can't drift apart.
const MySignupsContext = createContext({ data: null, error: null, reload: () => {} });

export const MY_SIGNUPS_CHANGED_EVENT = "pr-my-signups-changed";

// Re-check on a timer so a season an admin opens — or a sign-up they approve —
// reaches a player sitting on a page, without a navigation.
const POLL_MS = 90_000;

export function MySignupsProvider({ children }) {
  const { user } = useAuth();
  // The payload is league-scoped (api() stamps X-League-Id), so switching
  // league has to re-ask: the other league's seasons are not this one's.
  const { leagueId } = useLeague() || {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const signedIn = !!user;

  const load = useCallback(async () => {
    if (!signedIn) { setData(null); setError(null); return; }
    try {
      const res = await api("/api/users/me/series");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [signedIn]);

  useEffect(() => {
    // A league switch invalidates what's on screen, so drop it rather than
    // showing the previous league's series until the new answer lands.
    setData(null);
    load();
    if (!signedIn) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    // Sending a sign-up, or locking a car in, fires this — every reader
    // updates at once rather than up to a poll later.
    window.addEventListener(MY_SIGNUPS_CHANGED_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MY_SIGNUPS_CHANGED_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, signedIn, leagueId]);

  return (
    <MySignupsContext.Provider value={{ data, error, reload: load }}>
      {children}
    </MySignupsContext.Provider>
  );
}

export function useMySignups() {
  return useContext(MySignupsContext);
}

// Tells every screen and badge showing this data to re-read it.
export function mySignupsChanged() {
  window.dispatchEvent(new Event(MY_SIGNUPS_CHANGED_EVENT));
}
