"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { indexBundle } from "@/lib/rawIndex";
import { getActiveLeagueId } from "@/lib/leagueClient";

// Fetch one scope's raw documents and index them for the compute modules.
//
// This is the read side of the zero-server-compute model. The server no longer
// scores anything (see lib/rawBundle.js); a screen pulls the uncalculated
// documents for the narrowest scope that answers its question, and derives
// every table from them in a useMemo. Switching tabs, classes or sort order
// then costs a render rather than a round trip — and, more to the point, costs
// no Vercel CPU at all.
//
// ── Why plain fetch instead of api() ──────────────────────────────────────
//
// api() attaches the caller's Firebase ID token. A raw bundle is public league
// data (the collections behind it were already served unauthenticated by
// /api/results, /api/entries and friends), and a response that travels with an
// Authorization header is one a shared CDN cache will not touch. Sending no
// credentials is what lets the edge serve the repeats — which is the half of
// this that removes the function invocation rather than merely shrinking it.
//
// The active league therefore rides in the QUERY STRING, not the X-League-Id
// header: a CDN keys on the URL, so a header-scoped response would be a cache
// entry that could be handed to the wrong league.

const inFlight = new Map();

// The bundle URL for a scope, league scoping included. Exported for the two
// places that want a bundle outside a component's render — a save handler, a
// one-shot load — and must not silently drop the `league_id` the pooled
// collections (teams, drivers, the venue pool) are narrowed by.
export function rawBundlePath(params = {}) {
  return bundleUrl({ ...params, leagueId: params.leagueId ?? getActiveLeagueId() });
}

function bundleUrl({ scope, gameId, seriesId, seasonId, raceId, leagueId, include, refresh }) {
  const qs = new URLSearchParams({ scope });
  if (leagueId) qs.set("league_id", leagueId);
  if (include) qs.set("include", include);
  if (scope === "game" && gameId) qs.set("game_id", gameId);
  if (scope === "series" && seriesId) qs.set("series_id", seriesId);
  if (scope === "season" && seasonId) qs.set("season_id", seasonId);
  if (scope === "race" && raceId) qs.set("race_id", raceId);
  // A reload after the caller's own write carries a one-off token, which makes
  // it a different URL and therefore a guaranteed miss at the edge. Writes drop
  // the server's own caches (see lib/statsCache.js) but nothing can reach into
  // a CDN, so an admin who just adjusted a driver's points would otherwise sit
  // out the s-maxage window looking at the number they just changed.
  if (refresh) qs.set("_", String(refresh));
  return `/api/raw?${qs}`;
}

// One in-flight request per URL, shared. Several panels on a screen can want
// the same scope (the dashboard reads standings AND stats off one season), and
// each asking separately would undo the point of fetching raw.
function fetchBundle(url) {
  if (!inFlight.has(url)) {
    const p = fetch(url)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(body?.error || `Request failed (${res.status})`);
          err.status = res.status;
          throw err;
        }
        return body;
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, p);
  }
  return inFlight.get(url);
}

// `scope` is one of league | game | series | season | race. Pass `enabled: false` while
// the screen is still working out what it wants (waiting on LeagueProvider, or
// on a game being picked) so nothing is fetched twice.
export function useRawBundle({ scope, gameId = "", seriesId = "", seasonId = "", raceId = "", include = "", enabled = true } = {}) {
  const leagueId = typeof window === "undefined" ? "" : getActiveLeagueId();
  const [refresh, setRefresh] = useState(0);
  const url = enabled && scope ? bundleUrl({ scope, gameId, seriesId, seasonId, raceId, leagueId, include, refresh }) : null;

  const [state, setState] = useState({ url: null, bundle: null, error: null });
  // Which URL the newest request is for, so a slow answer for a scope the user
  // has already navigated away from cannot overwrite the current one.
  const latest = useRef(null);

  useEffect(() => {
    latest.current = url;
    if (!url) { setState({ url: null, bundle: null, error: null }); return; }
    setState(s => (s.url === url ? s : { url, bundle: null, error: null }));
    let live = true;
    fetchBundle(url)
      .then(bundle => { if (live && latest.current === url) setState({ url, bundle, error: null }); })
      .catch(err => { if (live && latest.current === url) setState({ url, bundle: null, error: err.message || "Failed to load." }); });
    return () => { live = false; };
  }, [url]);

  // Indexed once per bundle: the team index, the per-season grouping and the
  // points templates are shared by every table derived below, so rebuilding
  // them on each render would put back the cost this refactor removed.
  const index = useMemo(() => (state.bundle ? indexBundle(state.bundle) : null), [state.bundle]);

  // Re-fetch after a write of the caller's own (an adjusted points total, an
  // assigned class). See bundleUrl: the token makes it a URL nothing has cached,
  // so the admin sees the number they just changed rather than the one the edge
  // is still holding.
  const reload = useCallback(() => setRefresh(Date.now()), []);

  return {
    index,
    bundle: state.bundle,
    error: state.error,
    loading: !!url && !state.bundle && !state.error,
    reload,
  };
}
