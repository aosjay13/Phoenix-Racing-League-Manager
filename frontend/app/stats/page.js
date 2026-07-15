"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { api } from "@/lib/api";

// [key, header, lowerIsBetter, fullName] — fullName becomes a hover tooltip.
const COLUMNS = [
  ["starts", "Starts"],
  ["wins", "Wins"],
  ["podiums", "Podiums"],
  ["top5", "Top 5s"],
  ["top10", "Top 10s"],
  ["avg_finish", "Avg Fin", true, "Average Finish"],
  ["laps_run", "Laps"],
  ["laps_led", "Led"],
  ["most_laps_led", "MLL", false, "Most Laps Led (races)"],
  ["best_laps", "Best", false, "Best Laps (fastest laps)"],
  ["poles", "Poles"],
  ["avg_start", "Avg St", true, "Average Start"],
  ["dnfs", "DNFs"],
  ["provisionals", "Prov", false, "Provisionals"],
  ["titles", "Titles"],
  ["points", "Points"],
];

export default function StatsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, season } = league ?? {};
  const [scope, setScope] = useState("league");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const lowIsBetter = useMemo(() => COLUMNS.filter(c => c[2]).map(c => c[0]), []);
  const { sorted: rows, clickSort, arrow } = useSortable(data?.rows, "points", lowIsBetter);

  const scopes = [
    { id: "league", label: "All Games", ready: true, title: "League Overall Stats" },
    { id: "game", label: game?.name ?? "Game", ready: !!gameId, title: `${game?.name ?? "Game"} Overall Stats` },
    { id: "series", label: series?.name ?? "Series", ready: !!seriesId, title: `${series?.name ?? "Series"} Stats` },
    { id: "season", label: season?.name ?? "Season", ready: !!seasonId, title: `${series?.name ?? ""} ${season?.name ?? "Season"} Stats`.trim() },
  ];
  const active = scopes.find(s => s.id === scope) ?? scopes[0];

  useEffect(() => {
    setData(null);
    setError(null);
    const params =
      scope === "game" ? `scope=game&game_id=${gameId}` :
      scope === "series" ? `scope=series&series_id=${seriesId}` :
      scope === "season" ? `scope=season&season_id=${seasonId}` :
      "scope=league";
    if (scope !== "league" && !params.split("=").pop()) return;
    api(`/api/stats?${params}`).then(setData).catch(err => setError(err.message));
  }, [scope, gameId, seriesId, seasonId]);

  // Best value per column, for leader highlighting.
  const best = useMemo(() => {
    const out = {};
    if (!rows.length) return out;
    for (const [key, , lowerIsBetter] of COLUMNS) {
      const vals = rows.map(r => r[key]).filter(v => v != null);
      if (!vals.length) continue;
      out[key] = lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
      if (!lowerIsBetter && out[key] === 0) delete out[key]; // don't highlight a column of zeros
    }
    return out;
  }, [rows]);

  return (
    <section>
      <div className="page-title">
        <h2>{active.title}</h2>
        {data && <span className="page-badge">{data.rows.length} Drivers · {data.seasons_counted} Season{data.seasons_counted === 1 ? "" : "s"}</span>}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Career totals at every level of the league — click any column to sort. Gold cells mark the category leader.
      </p>

      <div className="tab-row">
        {scopes.map(s => (
          <button
            key={s.id}
            className={`tab${scope === s.id ? " active" : ""}`}
            disabled={!s.ready}
            style={!s.ready ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            onClick={() => s.ready && setScope(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="empty-state"><span className="empty-state-icon">📊</span><p>{error}</p></div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📊</span>
          <p>No race results in this scope yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Stats build automatically as admins enter race results.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sortable sticky-col" onClick={() => clickSort("driver_name", true)}>Driver{arrow("driver_name")}</th>
                {COLUMNS.map(([key, label, , fullName]) => (
                  <th key={key} className="sortable" title={fullName || label} onClick={() => clickSort(key)}>{label}{arrow(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={(r.user_id ?? "") + r.driver_name}>
                  <td className="driver-name-cell sticky-col">
                    {r.user_id
                      ? <Link href={`/drivers/${r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
                      : r.driver_name}
                    {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
                  </td>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className={best[key] != null && r[key] === best[key] ? "stat-leader" : undefined}>
                      {r[key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
