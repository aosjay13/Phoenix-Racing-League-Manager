"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

// ONE load of the player's message board — every decision an admin has made
// about them, with the thread they can answer in.
//
// Two things read it: the board itself on the Dashboard, and the unread count
// on the Dashboard's sidebar link. A context rather than a hook apiece so the
// badge and the board can never disagree about what's unread, and so opening
// the Dashboard doesn't fetch the same inbox twice.
//
// Nothing is fetched for a signed-out visitor: somebody reading the standings
// has no inbox, and their browser shouldn't be asking for one.
//
// Everything derived from the payload lives in lib/messages.js and is pure, so
// the count on the badge and the cards on the screen come from one place.
const MessagesContext = createContext({ rows: [], error: null, reload: () => {} });

export const MESSAGES_CHANGED_EVENT = "pr-messages-changed";

// Re-check on a timer so an admin's decision — or their reply to a question —
// reaches a player sitting on a page, without a navigation.
const POLL_MS = 90_000;

export function MessagesProvider({ children }) {
  const { user } = useAuth();
  // The board is league-scoped, so switching league has to re-ask.
  const { leagueId } = useLeague() || {};
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const signedIn = !!user;

  const load = useCallback(async () => {
    if (!signedIn) { setRows([]); setError(null); return; }
    try {
      const res = await api("/api/messages");
      setRows(Array.isArray(res) ? res : []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [signedIn]);

  useEffect(() => {
    load();
    if (!signedIn) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    // Reading or answering a message fires this, so the badge falls the moment
    // the work is done rather than up to a poll later.
    window.addEventListener(MESSAGES_CHANGED_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MESSAGES_CHANGED_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, signedIn, leagueId]);

  return (
    <MessagesContext.Provider value={{ rows, error, reload: load }}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages() {
  return useContext(MessagesContext);
}

// Tells every screen and badge showing the board to re-read it.
export function messagesChanged() {
  window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
}
