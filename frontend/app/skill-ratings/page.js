"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { api } from "@/lib/api";
import { SR_BASELINE } from "@/lib/skillRating";

// Small coloured +/- chip for a driver's most recent SR change.
function Trend({ delta }) {
  if (delta == null) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  if (delta === 0) return <span style={{ color: "var(--ink-2)" }}>±0</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "var(--positive, #34d399)" : "var(--negative, #f87171)", fontWeight: 600 }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{delta}
    </span>
  );
}

export default function SkillRatingsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, season, loading } = league ?? {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Scope mirrors the Stats / Records pages: the deepest concrete selection in
  // the top dropdowns wins. SR is gated per game, so a Game must be selected —
  // "All Games" has no single comparable rating. Narrower series/season scopes
  // still resolve to their game's ratings.
  const active = seasonId
    ? { params: `scope=season&season_id=${seasonId}`, title: `${series?.name ?? ""} ${season?.name ?? "Season"} Skill Ratings`.trim() }
    : seriesId
      ? { params: `scope=series&series_id=${seriesId}`, title: `${series?.name ?? "Series"} Skill Ratings` }
      : gameId
        ? { params: `scope=game&game_id=${gameId}`, title: `${game?.name ?? "Game"} Skill Ratings` }
        : null; // no game selected → show the "pick a game" prompt below

  const params = active?.params;
  useEffect(() => {
    if (loading) return;
    setData(null);
    setError(null);
    if (!params) return; // wait for a game to be chosen
    api(`/api/skill-ratings?${params}`).then(setData).catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading]);

  const lowIsBetter = useMemo(() => [], []);
  const { sorted: rows, clickSort, arrow } = useSortable(data?.rows, "skill_rating", lowIsBetter);

  const count = data?.count ?? 0;

  return (
    <section>
      <div className="page-title">
        <h2>{active?.title ?? "Skill Ratings"}</h2>
        {active && data && (
          <span className="page-badge">{count} Driver{count === 1 ? "" : "s"}</span>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Each driver&apos;s Elo-style Skill Rating, earned and lost against the Strength of Field they
        race. Everyone starts at {SR_BASELINE}. Ratings are <strong>per game</strong> — skill in one game
        doesn&apos;t carry to another — so pick a <strong>Game</strong> above (narrow further by Series / Season);
        click a column to sort.
      </p>

      {!active ? (
        <div className="empty-state">
          <span className="empty-state-icon">🎮</span>
          <p>Select a game above to see its Skill Ratings.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Skill Ratings are tracked separately for each game.
          </p>
        </div>
      ) : error ? (
        <div className="empty-state"><span className="empty-state-icon">📈</span><p>{error}</p></div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📈</span>
          <p>No rated drivers in this scope yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Skill Ratings build automatically as admins save main-race results.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th className="sortable sticky-col" onClick={() => clickSort("driver_name", true)}>
                  Driver{arrow("driver_name")}
                </th>
                <th className="sortable" onClick={() => clickSort("skill_rating")}>SR{arrow("skill_rating")}</th>
                <th className="sortable" title="Change from most recent race" onClick={() => clickSort("last_delta")}>
                  Trend{arrow("last_delta")}
                </th>
                <th className="sortable" title="SR races started" onClick={() => clickSort("total_races")}>
                  Races{arrow("total_races")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.driver_id}>
                  <td>
                    <span className={`rank-badge ${i === 0 ? "rank-p1" : i === 1 ? "rank-p2" : i === 2 ? "rank-p3" : "rank-default"}`}>
                      {r.rank}
                    </span>
                  </td>
                  <td className="driver-name-cell sticky-col">
                    {(r.driver_id || r.user_id)
                      ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
                      : r.driver_name}
                  </td>
                  <td className="points-cell" style={{ fontWeight: 600 }}>{r.skill_rating}</td>
                  <td><Trend delta={r.last_delta} /></td>
                  <td>{r.total_races}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
