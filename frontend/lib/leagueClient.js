"use client";

// The active league id, persisted in localStorage so it survives reloads and is
// readable synchronously by the api() fetch wrapper (which stamps it as the
// X-League-Id header) without threading React context through every call.
// LeagueProvider is the single writer; api() and the provider are the readers.
export const LEAGUE_KEY = "prlm-league";

export function getActiveLeagueId() {
  try {
    return localStorage.getItem(LEAGUE_KEY) || "";
  } catch {
    return "";
  }
}

export function setActiveLeagueId(id) {
  try {
    if (id) localStorage.setItem(LEAGUE_KEY, id);
    else localStorage.removeItem(LEAGUE_KEY);
  } catch {
    /* SSR / private-mode: header just won't be sent, reads stay unscoped */
  }
}
