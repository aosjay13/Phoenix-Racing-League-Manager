"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const LeagueContext = createContext(null);
const STORAGE_KEY = "prlm-selection";

// Selection values: null = not initialized yet, "" = "All …" chosen by the
// user, otherwise a document id. Pages that need one concrete season treat
// "" the same as nothing selected.
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

export function LeagueProvider({ children }) {
  const [games, setGames] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [seriesId, setSeriesId] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    const saved = loadSaved();
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
  }, [version]);

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

  useEffect(() => {
    if (gameId === null) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId, seriesId, seasonId }));
  }, [gameId, seriesId, seasonId]);

  const value = {
    games, seriesList, seasons,
    gameId: gameId ?? "", seriesId: seriesId ?? "", seasonId: seasonId ?? "",
    setGameId, setSeriesId, setSeasonId,
    game: games.find(g => g.id === gameId) || null,
    series: seriesList.find(s => s.id === seriesId) || null,
    season: seasons.find(s => s.id === seasonId) || null,
    loading,
    refresh,
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  return useContext(LeagueContext);
}
