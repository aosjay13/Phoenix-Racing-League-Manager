"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

// Column key, header label, and whether lower is better (for sort + leader highlight).
const COLUMNS = [
  ["starts", "Starts"],
  ["wins", "Wins"],
  ["podiums", "Podiums"],
  ["top5", "Top 5s"],
  ["top10", "Top 10s"],
  ["avg_finish", "Avg Finish", true],
  ["laps_run", "Laps Run"],
  ["laps_led", "Laps Led"],
  ["most_laps_led", "Most Laps Led"],
  ["best_laps", "Best Laps"],
  ["poles", "Poles"],
  ["avg_start", "Avg Start", true],
  ["dnfs", "DNFs"],
  ["provisionals", "Provisionals"],
  ["titles", "Titles"],
  ["points", "Points"],
];

export default function StatsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, season } = league ?? {};
  const [scope, setScope] = useState("league");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: "points", dir: "desc" });

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

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const lowerIsBetter = COLUMNS.find(c => c[0] === sort.key)?.[2];
    const sorted = [...data.rows].sort((a, b) => {
      if (sort.key === "driver_name") {
        return a.driver_name.localeCompare(b.driver_name);
      }
      const av = a[sort.key], bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
    const asc = sort.key === "driver_name" ? sort.dir === "asc" : (lowerIsBetter ? sort.dir === "desc" : sort.dir === "asc");
    if (!asc) sorted.reverse();
    return sorted;
  }, [data, sort]);

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

  function clickSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  const arrow = key => (sort.key === key ? (sort.dir === "desc" ? " ▾" : " ▴") : "");

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
                <th className="sortable sticky-col" onClick={() => clickSort("driver_name")}>Driver{arrow("driver_name")}</th>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className="sortable" onClick={() => clickSort(key)}>{label}{arrow(key)}</th>
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
