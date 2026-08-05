"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { ShareGraphicModal } from "@/components/ShareGraphicModal";
import { leagueLogos, toGraphicTable } from "@/lib/shareGraphic";
import { api } from "@/lib/api";
import { compareByTieBreakers, formatStat } from "@/lib/standings";
import { BANGER_STAT_COLUMNS } from "@/lib/bangerRacing";

// The exporter offers EVERY column this screen shows; these are just the ones
// ticked when it opens — a readable subset, since fifteen columns at once makes
// an unusable image. Position (#) comes from the current on-screen sort order.
const SHARE_DRIVER_DEFAULTS = ["rank", "driver_name", "starts", "wins", "podiums", "top5", "poles", "avg_finish"];
const SHARE_TEAM_DEFAULTS = ["rank", "team_name", "points", "wins", "podiums", "poles"];

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
  ["dnfs", "DNFs", false, "Did Not Finish — retirements and disqualifications"],
  ["provisionals", "Prov", false, "Provisionals"],
  ["titles", "Titles", false, "Championships — season titles won, class titles included"],
];

// Team columns mirror the driver set (summed across a team's drivers), with a
// driver-count column and points instead of a car number.
const TEAM_COLUMNS = [
  ["points", "Points"],
  ["drivers", "Drivers"],
  ["starts", "Starts"],
  ["wins", "Wins"],
  ["podiums", "Podiums"],
  ["top5", "Top 5s"],
  ["top10", "Top 10s"],
  ["avg_finish", "Avg Fin", true, "Average Finish"],
  ["laps_led", "Led"],
  ["most_laps_led", "MLL", false, "Most Laps Led (races)"],
  ["best_laps", "Best", false, "Best Laps (fastest laps)"],
  ["poles", "Poles"],
  ["avg_start", "Avg St", true, "Average Start"],
  ["dnfs", "DNFs", false, "Did Not Finish — retirements and disqualifications"],
  ["titles", "Titles", false, "Championships — season titles won by this team's drivers, class titles included"],
];

const teamHref = name => `/teams/${encodeURIComponent(name)}`;

export default function StatsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, classId, className, game, series, season, raceClass, classes, league: activeLeague, loading, isBangerRacing } = league ?? {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("drivers"); // "drivers" | "teams"
  const [sharing, setSharing] = useState(false);

  // Demo Derby / Banger Racing stats appear ONLY inside a banger series: with a
  // Series (or one of its Seasons) selected AND that series flagged as banger
  // racing. `isBangerRacing` is false at "All Series", which is precisely what
  // keeps these columns out of the Overall (league-wide) and per-Game views,
  // where a takedown count means nothing. See lib/bangerRacing.js.
  const showBanger = !!seriesId && !!isBangerRacing;
  const baseColumns = tab === "teams" ? TEAM_COLUMNS : COLUMNS;
  const columns = useMemo(
    () => (showBanger ? [...baseColumns, ...BANGER_STAT_COLUMNS] : baseColumns),
    [baseColumns, showBanger]
  );
  const activeRows = tab === "teams" ? data?.team_rows : data?.rows;
  const lowIsBetter = useMemo(() => columns.filter(c => c[2]).map(c => c[0]), [columns]);
  const { sorted: rows, clickSort, arrow } = useSortable(activeRows, tab === "teams" ? "points" : "wins", lowIsBetter, compareByTieBreakers);

  // Scope comes straight from the top dropdowns: the deepest concrete
  // selection wins; "All …" choices widen the aggregation. A selected Class
  // narrows the field further, so every stat below is that class's own.
  // Both id and name: the id pins an exact season's class, the name is what
  // resolves the same class across the seasons in a wider scope.
  const classParam = classId ? `&class_id=${classId}&class_name=${encodeURIComponent(className)}` : "";
  const active = seasonId
    ? { params: `scope=season&season_id=${seasonId}${classParam}`, title: `${series?.name ?? ""} ${season?.name ?? "Season"}${className ? ` ${className}` : ""} Stats`.trim() }
    : seriesId
      ? { params: `scope=series&series_id=${seriesId}${classParam}`, title: `${series?.name ?? "Series"} Overall Stats` }
      : gameId
        ? { params: `scope=game&game_id=${gameId}${classParam}`, title: `${game?.name ?? "Game"} Overall Stats` }
        : { params: `scope=league${classParam}`, title: "League Overall Stats" };

  useEffect(() => {
    if (loading) return;
    setData(null);
    setError(null);
    api(`/api/stats?${active.params}`).then(setData).catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.params, loading]);

  // Best value per column, for leader highlighting.
  const best = useMemo(() => {
    const out = {};
    if (!rows.length) return out;
    for (const [key, , lowerIsBetter] of columns) {
      const vals = rows.map(r => r[key]).filter(v => v != null);
      if (!vals.length) continue;
      out[key] = lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
      if (!lowerIsBetter && out[key] === 0) delete out[key]; // don't highlight a column of zeros
    }
    return out;
  }, [rows, columns]);

  return (
    <section>
      <div className="page-title">
        <h2>{active.title}</h2>
        {showBanger && <span className="page-badge">💥 Demo Derby / Banger Racing</span>}
        {data && (
          <span className="page-badge">
            {tab === "teams"
              ? `${data.team_rows?.length ?? 0} Team${(data.team_rows?.length ?? 0) === 1 ? "" : "s"}`
              : `${data.rows.length} Driver${data.rows.length === 1 ? "" : "s"}`}
            {" · "}{data.seasons_counted} Season{data.seasons_counted === 1 ? "" : "s"}
          </span>
        )}
        {rows.length > 0 && (
          <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }} onClick={() => setSharing(true)}>
            🖼 Share Graphic
          </button>
        )}
      </div>
      {(() => {
        // Full column set = the identity pair plus every stat column on screen.
        const nameKey = tab === "teams" ? "team_name" : "driver_name";
        const cols = [
          ["rank", "#"],
          [nameKey, tab === "teams" ? "Team" : "Driver"],
          ...columns.map(([key, label, , full]) => [key, full || label]),
        ];
        const st = toGraphicTable(cols, rows, {
          nameKey,
          defaultKeys: tab === "teams" ? SHARE_TEAM_DEFAULTS : SHARE_DRIVER_DEFAULTS,
        });
        return (
          <ShareGraphicModal
            open={sharing}
            onClose={() => setSharing(false)}
            kind="Stats"
            defaultTitle={active.title}
            subtitle={[game?.name, series?.name, className, tab === "teams" ? "Team Stats" : "Driver Stats"].filter(Boolean).join(" · ")}
            columns={st.columns}
            rows={st.rows}
            logos={leagueLogos({ league: activeLeague, game, series, season })}
            leagueName={activeLeague?.name ?? ""}
            leagueLogoUrl={activeLeague?.logo_url ?? ""}
          />
        );
      })()}
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Use the Game / Series / Season{classes?.length ? " / Class" : ""} menus above to change scope
        (pick &quot;All&quot; to widen it). Click any column to sort; gold cells mark the category leader.
        {className && ` Showing ${className} drivers only.`}
        {showBanger && " Takedowns, Survival and Most Lethal are this series' Demo Derby stats — they only show while a Banger Racing series is selected."}
      </p>

      <div className="tab-row">
        <button className={`tab${tab === "drivers" ? " active" : ""}`} onClick={() => setTab("drivers")}>Drivers</button>
        <button className={`tab${tab === "teams" ? " active" : ""}`} onClick={() => setTab("teams")}>Teams</button>
      </div>

      {error ? (
        <div className="empty-state"><span className="empty-state-icon">📊</span><p>{error}</p></div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📊</span>
          <p>{tab === "teams" ? "No team results in this scope yet." : "No race results in this scope yet."}</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            {tab === "teams"
              ? "Team stats build automatically as drivers assigned to a team score results."
              : "Stats build automatically as admins enter race results."}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sortable sticky-col" onClick={() => clickSort(tab === "teams" ? "team_name" : "driver_name", true)}>
                  {tab === "teams" ? "Team" : "Driver"}{arrow(tab === "teams" ? "team_name" : "driver_name")}
                </th>
                {columns.map(([key, label, , fullName]) => (
                  <th key={key} className="sortable" title={fullName || label} onClick={() => clickSort(key)}>{label}{arrow(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tab === "teams"
                ? rows.map(r => (
                    <tr key={r.team_name}>
                      <td className="driver-name-cell sticky-col">
                        <Link href={teamHref(r.team_name)} style={{ color: "var(--accent-cyan)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {r.logo_url && <img src={r.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                          {r.team_name}
                        </Link>
                      </td>
                      {columns.map(([key]) => (
                        <td key={key} className={best[key] != null && r[key] === best[key] ? "stat-leader" : undefined}>
                          {formatStat(key, r[key])}
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map(r => (
                    <tr key={(r.driver_id ?? r.user_id ?? "") + r.driver_name}>
                      <td className="driver-name-cell sticky-col">
                        {(r.driver_id || r.user_id)
                          ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
                          : r.driver_name}
                        {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
                        {/* Inside a game these tables lead with the name the driver
                            is shown under there, so their profile name goes under it. */}
                        {r.game_alias && r.profile_name && r.game_alias !== r.profile_name && (
                          <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.profile_name}</span>
                        )}
                      </td>
                      {columns.map(([key]) => (
                        <td key={key} className={best[key] != null && r[key] === best[key] ? "stat-leader" : undefined}>
                          {formatStat(key, r[key])}
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
