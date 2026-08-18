"use client";

// The active league id, persisted in localStorage so it survives reloads and is
// readable synchronously by the api() fetch wrapper (which stamps it as the
// X-League-Id header) without threading React context through every call.
// LeagueProvider is the single writer; api() and the provider are the readers.
export const LEAGUE_KEY = "prlm-league";

// Fired whenever the active league actually changes.
//
// Roles are per-league (see lib/leagueRoles.js), so "which league am I in?" and
// "what am I allowed to do?" are one question — and the two answers are held by
// two different providers. AuthProvider wraps LeagueProvider (it has to: the
// league list is fetched with the signed-in user's token), so it cannot read the
// league through context. This event is how it hears about a switch: the writer
// announces, and AuthProvider re-asks /api/users/me for the role it holds in the
// league that is now active.
export const LEAGUE_CHANGE_EVENT = "prlm-league-change";

export function getActiveLeagueId() {
  try {
    return localStorage.getItem(LEAGUE_KEY) || "";
  } catch {
    return "";
  }
}

export function setActiveLeagueId(id) {
  try {
    const before = localStorage.getItem(LEAGUE_KEY) || "";
    const after = id || "";
    if (after) localStorage.setItem(LEAGUE_KEY, after);
    else localStorage.removeItem(LEAGUE_KEY);
    // Only on a real change: the provider re-resolves the active league on every
    // refresh, and re-announcing the same league would re-fetch the profile on a
    // loop.
    if (before !== after && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(LEAGUE_CHANGE_EVENT, { detail: { leagueId: after } }));
    }
  } catch {
    /* SSR / private-mode: header just won't be sent, reads stay unscoped */
  }
}
