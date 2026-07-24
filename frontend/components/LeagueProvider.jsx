"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
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

  // Classes hang off the selected season. A season with no classes clears the
  // selection so every page falls back to its whole-field view. When the season
  // has classes but its admin turned OFF the combined (overall) championship,
  // there IS no legitimate "All Classes" championship, so the selection lands on
  // the first class instead of the combined view.
  const season = seasons.find(s => s.id === seasonId) || null;
  useEffect(() => {
    if (seasonId === null) return;
    if (!seasonId) { setClasses([]); setClassId(""); return; }
    const saved = loadSaved();
    api(`/api/classes?season_id=${seasonId}`)
      .then(list => {
        setClasses(list);
        setClassId(prev => {
          const current = prev === null ? saved.classId : prev;
          if (list.find(c => c.id === current)) return current;
          if (!list.length) return "";
          const combined = season?.combined_championship !== false;
          return combined ? "" : list[0].id;
        });
      })
      .catch(() => { setClasses([]); setClassId(""); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, season?.combined_championship, version]);

  useEffect(() => {
    if (gameId === null) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId, seriesId, seasonId, classId }));
  }, [gameId, seriesId, seasonId, classId]);

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
    raceClass: classes.find(c => c.id === classId) || null,
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
