"use client";

// Shareable links.
//
// Which game/series/season/class you are looking at lives in LeagueProvider (and
// localStorage), not in the address bar — so a copied URL used to say "the
// standings page" without saying *whose* standings, and whoever opened it landed
// on their own last selection instead of yours. These helpers mirror the current
// scope into the query string and read it back on load, which turns every page
// into a direct link: /standings?season=…&class=GT3 opens that exact table.
//
// The scope keys are the only ones touched — any other query param a page owns
// (a results tab, a session name) is left alone.
export const SCOPE_KEYS = ["league", "game", "series", "season", "class"];

// "All Games" / "All Classes" is a real choice, distinct from "no param given",
// so it travels as an explicit sentinel rather than an empty string that a
// fresh visitor would fill in with their own default.
const ALL = "all";

function search() {
  return new URLSearchParams(window.location.search);
}

// The raw scope params present in the URL, with "all" mapped back to the ""
// the provider uses for an explicit All-… selection. Keys the URL doesn't
// mention are left out entirely, so the caller can tell "not specified" (fall
// back to the saved selection) from "explicitly All".
export function readScopeParams() {
  if (typeof window === "undefined") return {};
  const p = search();
  const out = {};
  for (const key of SCOPE_KEYS) {
    const v = p.get(key);
    if (v !== null) out[key] = v === ALL ? "" : v;
  }
  return out;
}

// Rewrites the scope params in place. Uses replaceState rather than a router
// push: the address bar tracks the selection without stacking a history entry
// per dropdown change, and without re-rendering the page under it.
export function writeScopeParams(scope) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of SCOPE_KEYS) {
    const v = scope[key];
    // undefined/null = this level isn't meaningful here (no parent selected);
    // "" = an explicit All-…, which is worth carrying in the link.
    if (v == null) url.searchParams.delete(key);
    else url.searchParams.set(key, v === "" ? ALL : v);
  }
  if (url.toString() !== window.location.href) {
    window.history.replaceState(null, "", url.toString());
  }
}

// A link to a page AT A NAMED SCOPE, in exactly the shape readScopeParams()
// reads back — so the same encoding builds the link and resolves it.
//
// Used where a link has to carry its own scope instead of inheriting whatever
// the menus happen to be set to: a message about one season pointing at THAT
// season's standings. Levels left undefined are omitted, so the link only
// speaks about what it knows and everything else falls back to the reader's own
// selection; `""` still travels as an explicit All-….
//
// The href is only half of it. On a hard load the provider reads these params
// and opens on them, but a client-side navigation keeps the provider mounted —
// it never re-reads the URL, and re-stamps the address bar from the selection
// it already holds. So a link built here is paired with selectScope() from
// LeagueProvider on the click; see components/MessageBoard.jsx.
export function scopeHref(path, scope = {}) {
  const params = new URLSearchParams();
  for (const key of SCOPE_KEYS) {
    const v = scope[key];
    if (v == null) continue;
    params.set(key, v === "" ? ALL : v);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// Read/write for a single page-owned param (the Drivers/Teams tab on Standings,
// the session on a race page) so those choices survive a copied link too.
export function readParam(key) {
  if (typeof window === "undefined") return null;
  return search().get(key);
}

export function setParam(key, value) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value == null || value === "") url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  if (url.toString() !== window.location.href) {
    window.history.replaceState(null, "", url.toString());
  }
}

// Copies the current URL — scope params and all — to the clipboard. Falls back
// to a hidden textarea for browsers that withhold the async clipboard API
// outside HTTPS.
export async function copyCurrentLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
