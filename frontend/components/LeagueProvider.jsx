"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const LeagueContext = createContext(null);
const STORAGE_KEY = "prlm-selection";

export function LeagueProvider({ children }) {
  const [games, setGames] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [gameId, setGameId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  // Load games once (and on refresh), restoring the last selection.
  useEffect(() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
    api("/api/games")
      .then(g => {
        setGames(g);
        const restored = g.find(x => x.id === saved.gameId)?.id || g[0]?.id || "";
        setGameId(prev => (g.find(x => x.id === prev) ? prev : restored));
      })
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, [version]);

  useEffect(() => {
    if (!gameId) { setSeriesList([]); setSeriesId(""); return; }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
    api(`/api/series?game_id=${gameId}`)
      .then(s => {
        setSeriesList(s);
        setSeriesId(prev => {
          if (s.find(x => x.id === prev)) return prev;
          return s.find(x => x.id === saved.seriesId)?.id || s[0]?.id || "";
        });
      })
      .catch(() => setSeriesList([]));
  }, [gameId, version]);

  useEffect(() => {
    if (!seriesId) { setSeasons([]); setSeasonId(""); return; }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
    api(`/api/seasons?series_id=${seriesId}`)
      .then(s => {
        setSeasons(s);
        setSeasonId(prev => {
          if (s.find(x => x.id === prev)) return prev;
          return s.find(x => x.id === saved.seasonId)?.id || s[s.length - 1]?.id || "";
        });
      })
      .catch(() => setSeasons([]));
  }, [seriesId, version]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId, seriesId, seasonId }));
  }, [gameId, seriesId, seasonId]);

  const value = {
    games, seriesList, seasons,
    gameId, seriesId, seasonId,
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
