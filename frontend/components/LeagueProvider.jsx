"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { getActiveLeagueId, setActiveLeagueId } from "@/lib/leagueClient";
import { readScopeParams, writeScopeParams } from "@/lib/scopeLink";
import { isBangerScope } from "@/lib/bangerRacing";
import { isBracketScope } from "@/lib/bracketRacing";

const LeagueContext = createContext(null);
const STORAGE_KEY = "prlm-selection";

// The scope carried in the URL, in the shape the saved-selection code expects.
// This is what makes a copied link land on the same game/series/season/class
// the sender was looking at: anything the link spells out wins over the
// visitor's own saved selection, and anything it leaves out falls back to it.
// The class travels by NAME (that's its cross-season identity — see the classes
// effect below), so the id is cleared and re-resolved in the current scope.
function urlSelection() {
  const p = readScopeParams();
  const out = {};
  if (p.game !== undefined) out.gameId = p.game;
  if (p.series !== undefined) out.seriesId = p.series;
  if (p.season !== undefined) out.seasonId = p.season;
  if (p.class !== undefined) { out.className = p.class; out.classId = ""; }
  return out;
}

// Selection values: null = not initialized yet, "" = "All …" chosen by the
// user, otherwise a document id. Pages that need one concrete season treat
// "" the same as nothing selected.
function loadSaved() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { saved = {}; }
  return { ...saved, ...urlSelection() };
}

export function LeagueProvider({ children }) {
  // Only read so the scope params can be re-stamped after a navigation.
  const pathname = usePathname();

  // Multi-league layer: the list of leagues and which one is active. leagueId
  // is null until the list has loaded and an active league is resolved; only
  // then do the (league-scoped) game/series/season fetches run.
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(null);

  const [games, setGames] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [seasons, setSeasons] = useState([]);
  // Which parent each of those lists was actually loaded for. The tiers settle
  // one at a time — pick a new Series and `seriesId` changes immediately while
  // `seasons`/`seasonId` still describe the series you just left — so anything
  // that reads across tiers (the Class menu) needs to know whether they've
  // caught up yet. null = nothing loaded for any parent.
  const [seriesForGame, setSeriesForGame] = useState(null);
  const [seasonsForSeries, setSeasonsForSeries] = useState(null);
  // The fourth tier: the selected season's classes ("Pro"/"Amateur", GT3/LMP2…).
  // Empty for a season that doesn't run classes, in which case the Class
  // dropdown hides itself entirely.
  const [classes, setClasses] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [seriesId, setSeriesId] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [classId, setClassId] = useState(null);
  // The selected class's NAME, tracked alongside its id. A class doc belongs to
  // one season, so the id changes as you drill between scopes while the name is
  // what the user actually picked — see the classes effect below.
  const [className, setClassName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);
  // The classes effect reads the current selection without depending on it —
  // depending on classId would re-fetch the list every time a class is picked.
  const classIdRef = useRef(classId);
  useEffect(() => { classIdRef.current = classId; }, [classId]);
  // Sequence number for the classes fetch, so an earlier request that lands
  // late can't overwrite the current scope's menu.
  const classReqRef = useRef(0);

  // Load the league list and resolve the active league. Runs before anything
  // scoped so the X-League-Id header is set (via localStorage) by the time
  // /api/games is fetched. Re-runs on refresh() so a freshly created/renamed
  // league shows up immediately.
  const reloadLeagues = useCallback(async () => {
    try {
      const list = await api("/api/leagues");
      setLeagues(list);
      setLeagueId(prev => {
        // A link that names its league opens in that league even if the visitor
        // was last in a different one — otherwise every id in the link would
        // resolve against the wrong league's data.
        const wanted = prev ?? (readScopeParams().league || getActiveLeagueId());
        const chosen = list.find(l => l.id === wanted)?.id ?? list[0]?.id ?? "";
        setActiveLeagueId(chosen);
        return chosen;
      });
    } catch {
      setLeagues([]);
      setLeagueId(prev => prev ?? "");
    }
  }, []);

  useEffect(() => { reloadLeagues(); }, [reloadLeagues, version]);

  // Switch the active league: persist it, drop the game/series/season drill-down
  // (ids from another league are meaningless here) and its saved selection, then
  // refetch everything so the whole app re-renders for the new league.
  const switchLeague = useCallback((id) => {
    if (!id) return;
    setActiveLeagueId(id);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    // Drop the old league's ids out of the URL as well as out of storage —
    // they'd otherwise be re-read as this league's opening selection.
    writeScopeParams({ league: id, game: null, series: null, season: null, class: null });
    setLeagueId(id);
    setGames([]); setSeriesList([]); setSeasons([]); setClasses([]);
    setSeriesForGame(null); setSeasonsForSeries(null);
    setGameId(null); setSeriesId(null); setSeasonId(null); setClassId(null); setClassName(null);
    setLoading(true);
    setVersion(v => v + 1);
  }, []);

  // Move the menus to a named game/series/season/class in one go.
  //
  // A scope link (lib/scopeLink.js) only opens on its scope when the page is
  // loaded cold — that's when the provider reads the URL. Follow the same link
  // from inside the app and the provider never remounts, never re-reads the
  // query string, and re-stamps the address bar from the selection it already
  // holds, so the reader lands on the right PAGE at the wrong SEASON. This is
  // the other half: the click sets the scope, the href carries it for a new tab
  // or a copied link, and both routes end up in the same place.
  //
  // Setting all four together is what makes it land. Each tier re-resolves
  // itself when its parent's list arrives, keeping the current value when the
  // list contains it and falling back to the first row when it doesn't — so a
  // season set on its own, before its series and game, would be thrown away as
  // "not in this list" a moment later. Set together, every tier finds itself.
  //
  // The class is set by NAME for the same reason it's remembered by name: a
  // class doc belongs to one season, so the id means nothing until that
  // season's classes have loaded. Its id is cleared and the classes effect
  // below re-resolves it in the new scope.
  const selectScope = useCallback(({ game, series, season, className: cls } = {}) => {
    if (game !== undefined) setGameId(game || "");
    if (series !== undefined) setSeriesId(series || "");
    if (season !== undefined) setSeasonId(season || "");
    if (cls !== undefined) { setClassName(cls || ""); setClassId(""); }
  }, []);

  useEffect(() => {
    if (leagueId === null) return;          // wait until the active league is known
    const saved = loadSaved();
    setLoading(true);
    api("/api/games")
      .then(g => {
        setGames(g);
        setGameId(prev => {
          const current = prev === null ? saved.gameId : prev;
          if (current === "") return "";
          return g.find(x => x.id === current)?.id ?? g[0]?.id ?? "";
        });
      })
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, [leagueId, version]);

  useEffect(() => {
    if (gameId === null) return;
    if (!gameId) { setSeriesList([]); setSeriesForGame(""); setSeriesId(""); return; }
    const saved = loadSaved();
    api(`/api/series?game_id=${gameId}`)
      .then(s => {
        setSeriesList(s);
        setSeriesForGame(gameId);
        setSeriesId(prev => {
          const current = prev === null ? saved.seriesId : prev;
          if (current === "" && prev !== null) return "";
          if (s.find(x => x.id === current)) return current;
          return prev === null && saved.seriesId === "" ? "" : (s[0]?.id ?? "");
        });
      })
      .catch(() => { setSeriesList([]); setSeriesForGame(gameId); });
  }, [gameId, version]);

  useEffect(() => {
    if (seriesId === null) return;
    if (!seriesId) { setSeasons([]); setSeasonsForSeries(""); setSeasonId(""); return; }
    const saved = loadSaved();
    api(`/api/seasons?series_id=${seriesId}`)
      .then(s => {
        setSeasons(s);
        setSeasonsForSeries(seriesId);
        setSeasonId(prev => {
          const current = prev === null ? saved.seasonId : prev;
          if (current === "" && prev !== null) return "";
          if (s.find(x => x.id === current)) return current;
          // The list arrives newest first (by race date — see lib/seasonOrder.js),
          // so the season being raced now is the one at the top.
          return prev === null && saved.seasonId === "" ? "" : (s[0]?.id ?? "");
        });
      })
      .catch(() => { setSeasons([]); setSeasonsForSeries(seriesId); });
  }, [seriesId, version]);

  // Classes are available at EVERY scope, not just inside one season. A class
  // doc belongs to one season, so above season level /api/classes collapses the
  // same name across seasons into one row (carrying every matching id in
  // `ids`) — that's what keeps the Class menu populated at "All Seasons" and
  // lets a class be answered series- or game-wide.
  //
  // Because of that, the selection is remembered by NAME: drilling from a
  // series into one of its seasons keeps you on "GT3" even though the id
  // underneath changes. It falls back to "All Classes" only when the name
  // genuinely isn't raced in the new scope.
  const season = seasons.find(s => s.id === seasonId) || null;
  useEffect(() => {
    if (gameId === null || seriesId === null || seasonId === null) return;
    // The menu must never show a scope you aren't in. Two things used to let it:
    //
    //   • The tiers settle one at a time. Picking a different Series changes
    //     `seriesId` at once, but `seasonId` still points at the season of the
    //     series you left until the seasons refetch lands — so asking for
    //     "?season_id=<old season>" answered with the OLD series' classes.
    //   • Those requests overlap. A scope change fires this effect twice (once
    //     on the half-settled ids, once on the settled ones) and the responses
    //     can land in either order, so a stale answer could win.
    //
    // Hold off while the lists below still describe a different parent, and let
    // only the newest request write. Meanwhile the menu is emptied, which is
    // "All Classes" with nothing else to pick — the right answer for a game,
    // series or season that runs no classes, and for the moment in between.
    const settled = seriesForGame === gameId && seasonsForSeries === seriesId;
    const seq = ++classReqRef.current;
    if (!settled) {
      setClasses(prev => (prev.length ? [] : prev));
      setClassId(prev => (prev ? "" : prev));
      return;
    }
    const saved = loadSaved();
    const qs = seasonId ? `?season_id=${seasonId}`
      : seriesId ? `?series_id=${seriesId}`
      : gameId ? `?game_id=${gameId}`
      : "";
    api(`/api/classes${qs}`)
      .then(list => {
        if (seq !== classReqRef.current) return;   // a newer scope has taken over
        setClasses(list);
        setClassName(prevName => {
          const wantName = prevName === null ? (saved.className || "") : prevName;
          const wantId = classIdRef.current === null ? (saved.classId || "") : classIdRef.current;
          // An exact id still in scope wins (the same season, or a re-fetch);
          // otherwise re-resolve by name, which is what survives a scope change.
          const match = list.find(c => c.id === wantId) || (wantName ? list.find(c => c.name === wantName) : null);
          setClassId(match ? match.id : "");
          return match ? match.name : "";
        });
      })
      .catch(() => {
        if (seq !== classReqRef.current) return;
        setClasses([]); setClassId(""); setClassName("");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, seriesId, seasonId, seriesForGame, seasonsForSeries, version]);

  const raceClass = classes.find(c => c.id === classId) || null;

  useEffect(() => {
    if (gameId === null) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId, seriesId, seasonId, classId, className }));
  }, [gameId, seriesId, seasonId, classId, className]);

  // Mirror the resolved selection into the address bar, so the URL of any page
  // is already the shareable link to what's on screen — no extra step, and
  // nothing about the page itself changes. Held back until every level has
  // settled (null = still resolving), so a half-resolved scope is never the
  // thing someone copies. Re-stamped on every navigation as well, since moving
  // between pages starts each one with a clean query string.
  useEffect(() => {
    if (gameId === null || seriesId === null || seasonId === null || className === null) return;
    writeScopeParams({
      league: leagueId || null,
      game: gameId,
      // A level only appears once its parent is a concrete choice; below an
      // "All …" there is nothing left to name.
      series: gameId ? seriesId : null,
      season: gameId && seriesId ? seasonId : null,
      class: classes.length ? className : null,
    });
  }, [leagueId, gameId, seriesId, seasonId, className, classes.length, pathname]);

  const value = {
    leagues, leagueId: leagueId ?? "",
    league: leagues.find(l => l.id === leagueId) || null,
    switchLeague, reloadLeagues,
    games, seriesList, seasons, classes,
    gameId: gameId ?? "", seriesId: seriesId ?? "", seasonId: seasonId ?? "", classId: classId ?? "",
    setGameId, setSeriesId, setSeasonId, selectScope,
    // Picking a class records its name too, so the selection survives a change
    // of scope (where the same class is a different doc).
    setClassId: id => {
      setClassId(id);
      setClassName(classes.find(c => c.id === id)?.name ?? "");
    },
    game: games.find(g => g.id === gameId) || null,
    series: seriesList.find(s => s.id === seriesId) || null,
    season,
    raceClass,
    // The cross-season identity of the selected class. Every scoped API call
    // sends this rather than (only) the id, so a series- or game-wide view can
    // resolve it to that scope's own class docs.
    className: className ?? "",
    // A season only crowns one overall champion across its classes when the
    // admin left the combined championship on (the default).
    combinedChampionship: season?.combined_championship !== false,
    // Is the current scope a Demo Derby / Banger Racing one? The flag can sit on
    // the series, the season or a single class, and a scope counts as banger if
    // anything at or under the deepest selection carries it — a season with one
    // Banger class included, since part of that table races derby. Forced false
    // above series level, which is what keeps the derby stats out of the
    // Overall and per-Game views. See lib/bangerRacing.js.
    // Strictly the scope being VIEWED: a labelled class, season or series and
    // nothing else. Never inferred from what a scope contains, so a racing
    // series with a derby class inside it shows no derby columns anywhere
    // except on that class. Forced false above series level.
    isBangerRacing: !!seriesId && isBangerScope({
      series: seriesList.find(s => s.id === seriesId) || null,
      season,
      cls: raceClass,
    }),
    // Is the current scope a Bracket Style Racing one? Set on a series or on a
    // single class, resolved through the same "at or under a flagged level"
    // rule, and forced false above series level. Unlike the derby flag this
    // gates no stats columns — bracket finishes are ordinary racing stats — it
    // is here so a scope can LABEL itself as bracket racing. See
    // lib/bracketRacing.js.
    isBracketRacing: !!seriesId && isBracketScope({
      series: seriesList.find(s => s.id === seriesId) || null,
      season,
      cls: raceClass,
    }),
    loading,
    refresh,
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  return useContext(LeagueContext);
}
