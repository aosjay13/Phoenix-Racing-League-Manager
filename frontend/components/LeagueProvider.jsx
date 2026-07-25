"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { getActiveLeagueId, setActiveLeagueId } from "@/lib/leagueClient";

const LeagueContext = createContext(null);
const STORAGE_KEY = "prlm-selection";

// Selection values: null = not initialized yet, "" = "All …" chosen by the
// user, otherwise a document id. Pages that need one concrete season treat
// "" the same as nothing selected.
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

export function LeagueProvider({ children }) {
  // Multi-league layer: the list of leagues and which one is active. leagueId
  // is null until the list has loaded and an active league is resolved; only
  // then do the (league-scoped) game/series/season fetches run.
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(null);

  const [games, setGames] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [seasons, setSeasons] = useState([]);
  // The fourth tier: the selected season's classes ("Pro"/"Amateur", GT3/LMP2…).
  // Empty for a season that doesn't run classes, in which case the Class
  // dropdown hides itself entirely.
  const [classes, setClasses] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [seriesId, setSeriesId] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [classId, setClassId] = useState(null);
  // Remembers the NAME of the selected class so a scope change can re-find the
  // same class among the new scope's class docs (see the class-loading effect).
  const classNameRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  // Load the league list and resolve the active league. Runs before anything
  // scoped so the X-League-Id header is set (via localStorage) by the time
  // /api/games is fetched. Re-runs on refresh() so a freshly created/renamed
  // league shows up immediately.
  const reloadLeagues = useCallback(async () => {
    try {
      const list = await api("/api/leagues");
      setLeagues(list);
      setLeagueId(prev => {
        const wanted = prev ?? getActiveLeagueId();
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
    setLeagueId(id);
    setGames([]); setSeriesList([]); setSeasons([]); setClasses([]);
    setGameId(null); setSeriesId(null); setSeasonId(null); setClassId(null);
    setLoading(true);
    setVersion(v => v + 1);
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
    if (!gameId) { setSeriesList([]); setSeriesId(""); return; }
    const saved = loadSaved();
    api(`/api/series?game_id=${gameId}`)
      .then(s => {
        setSeriesList(s);
        setSeriesId(prev => {
          const current = prev === null ? saved.seriesId : prev;
          if (current === "" && prev !== null) return "";
          if (s.find(x => x.id === current)) return current;
          return prev === null && saved.seriesId === "" ? "" : (s[0]?.id ?? "");
        });
      })
      .catch(() => setSeriesList([]));
  }, [gameId, version]);

  useEffect(() => {
    if (seriesId === null) return;
    if (!seriesId) { setSeasons([]); setSeasonId(""); return; }
    const saved = loadSaved();
    api(`/api/seasons?series_id=${seriesId}`)
      .then(s => {
        setSeasons(s);
        setSeasonId(prev => {
          const current = prev === null ? saved.seasonId : prev;
          if (current === "" && prev !== null) return "";
          if (s.find(x => x.id === current)) return current;
          return prev === null && saved.seasonId === "" ? "" : (s[s.length - 1]?.id ?? "");
        });
      })
      .catch(() => setSeasons([]));
  }, [seriesId, version]);

  // Classes hang off the SELECTED SCOPE, not just the selected season: a class
  // doc belongs to one season, but "GT3" is the same class in every season that
  // runs it, so widening the scope to a series/game/the league still offers each
  // distinct class name once (the API collapses them — see /api/classes, and
  // resolveClassScope in lib/classServer.js, which widens the chosen id back out
  // over the scope when stats are aggregated). That's what makes an all-time
  // "GT3 records" view reachable rather than season-only.
  //
  // The selection always starts on "All Classes" ("") — the combined,
  // whole-field view — and only holds a specific class while that class exists
  // in the current scope, so narrowing to a season (or a league) that doesn't
  // define it falls back to All Classes rather than filtering against an id that
  // means nothing here.
  const season = seasons.find(s => s.id === seasonId) || null;
  const classScope = seasonId ? `season_id=${seasonId}` : seriesId ? `series_id=${seriesId}` : gameId ? `game_id=${gameId}` : "";
  useEffect(() => {
    if (gameId === null || seriesId === null || seasonId === null) return;
    const saved = loadSaved();
    // Changing a game re-resolves its series and season a beat later, so this
    // effect can fire twice in quick succession; ignore a superseded response so
    // a slow first request can't overwrite the current scope's classes.
    let cancelled = false;
    api(`/api/classes${classScope ? `?${classScope}` : ""}`)
      .then(list => {
        if (cancelled) return;
        setClasses(list);
        setClassId(prev => {
          const current = prev === null ? saved.classId : prev;
          if (list.find(c => c.id === current)) return current;
          // The scope changed under the selection: each scope hands back its own
          // class docs, so the previously selected id belongs to a season that
          // isn't in this scope. Re-select the same class BY NAME when this
          // scope also runs it, so drilling from a series into one of its
          // seasons keeps you on GT3 instead of snapping back to All Classes.
          const wantedName = classNameRef.current;
          const sameName = wantedName && list.find(c => String(c.name).trim().toLowerCase() === wantedName);
          return sameName ? sameName.id : "";
        });
      })
      .catch(() => { if (!cancelled) { setClasses([]); setClassId(""); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classScope, version]);

  useEffect(() => {
    if (gameId === null) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId, seriesId, seasonId, classId }));
  }, [gameId, seriesId, seasonId, classId]);

  const raceClass = classes.find(c => c.id === classId) || null;
  useEffect(() => {
    if (raceClass) classNameRef.current = String(raceClass.name).trim().toLowerCase();
    else if (classId === "") classNameRef.current = null;
  }, [raceClass, classId]);

  const value = {
    leagues, leagueId: leagueId ?? "",
    league: leagues.find(l => l.id === leagueId) || null,
    switchLeague, reloadLeagues,
    games, seriesList, seasons, classes,
    gameId: gameId ?? "", seriesId: seriesId ?? "", seasonId: seasonId ?? "", classId: classId ?? "",
    setGameId, setSeriesId, setSeasonId, setClassId,
    game: games.find(g => g.id === gameId) || null,
    series: seriesList.find(s => s.id === seriesId) || null,
    season,
    raceClass,
    // Every class id the current selection stands for. A class doc belongs to
    // one season, so at series/game/league scope the dropdown's row carries the
    // ids of every same-named class it collapsed — the server widens the id it
    // is sent the same way, this is just what the client already knows.
    classIds: raceClass?.class_ids ?? (classId ? [classId] : []),
    // A season only crowns one overall champion across its classes when the
    // admin left the combined championship on (the default).
    combinedChampionship: season?.combined_championship !== false,
    loading,
    refresh,
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  return useContext(LeagueContext);
}
