"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { useSortable } from "@/components/useSortable";
import { ShareGraphicModal } from "@/components/ShareGraphicModal";
import { leagueLogos, toGraphicTable } from "@/lib/shareGraphic";
import { api } from "@/lib/api";
import { readParam, setParam } from "@/lib/scopeLink";
import { compareByTieBreakers, formatStat, TIE_BREAKER_SUMMARY } from "@/lib/standings";

// The exporter offers every column the standings table shows; these are the
// ones ticked when it opens — a feed-friendly set, since the full table has too
// many columns to read cleanly at social-media sizes.
const SHARE_DRIVER_DEFAULTS = ["rank", "driver_name", "adjusted_points", "wins", "podiums", "poles"];
const SHARE_TEAM_DEFAULTS = ["rank", "team", "points", "wins", "podiums", "poles"];

// [key, label, lowIsBetter?, isText?]
const DRIVER_COLS = [
  ["adjusted_points", "Points"],
  ["behind_leader", "BL", true],
  ["behind_next", "BN", true],
  ["team", "Team", false, true],
  ["starts", "Starts"],
  ["wins", "Wins"],
  ["podiums", "Podiums"],
  ["top5", "Top 5s"],
  ["top10", "Top 10s"],
  ["poles", "Poles"],
  ["best_laps", "Best Laps"],
  ["laps_led", "Laps Led"],
  ["avg_start", "Avg Start", true],
  ["avg_finish", "Avg Finish", true],
  ["dnfs", "DNFs"],
];

// Mirrors the driver columns through the whole tie-breaker chain, so a team tie
// can be read off the table rather than taken on trust.
const TEAM_COLS = [
  ["points", "Points"],
  ["wins", "Wins"],
  ["podiums", "Podiums"],
  ["top5", "Top 5s"],
  ["top10", "Top 10s"],
  ["poles", "Poles"],
  ["best_laps", "Best Laps"],
  ["laps_led", "Laps Led"],
  ["avg_start", "Avg Start", true],
  ["avg_finish", "Avg Finish", true],
  ["drivers", "Drivers"],
];

// Who this season crowned, once it's marked completed: one champion per class,
// plus the outright one when the season runs an overall championship. Shown
// here so the titles credited in career and team stats are visible at the
// source — a three-class season with the overall on lists four champions.
// Empty (and hidden) for a season still running.
function SeasonChampions({ champions }) {
  if (!champions.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
      <span style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>
        {champions.length === 1 ? "Champion:" : `Champions (${champions.length}):`}
      </span>
      {champions.map(c => (
        <span key={`${c.kind}:${c.class_id ?? ""}:${c.entry_id}`} className="page-badge">
          🏆 {c.kind === "overall" ? "Overall" : (c.class_name || "Class")} —{" "}
          {(c.driver_id || c.user_id)
            ? <Link href={`/drivers/${c.driver_id || c.user_id}`} style={{ color: "inherit" }}>{c.driver_name}</Link>
            : c.driver_name}
        </span>
      ))}
    </div>
  );
}

function RankBadge({ rank }) {
  const cls = rank === 1 ? "rank-p1" : rank === 2 ? "rank-p2" : rank === 3 ? "rank-p3" : "rank-default";
  return <span className={`rank-badge ${cls}`}>{rank}</span>;
}

function SortableTable({ cols, rows, defaultKey, rankKey = "rank", renderName, nameLabel, nameKey, extraCol }) {
  // rank counts as low-is-better so the default view (and clicks on "Pos")
  // put the championship leader at the top.
  const lowIsBetter = [rankKey, ...cols.filter(c => c[2]).map(c => c[0])];
  // Equal values in any column fall back to the championship order, so a click
  // on Points shows tied drivers exactly as the standings rank them.
  const { sorted, clickSort, arrow } = useSortable(rows, defaultKey, lowIsBetter, compareByTieBreakers);

  return (
    <div className="table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th className="sortable" onClick={() => clickSort(rankKey)}>Pos{arrow(rankKey)}</th>
            <th className="sortable sticky-col" onClick={() => clickSort(nameKey, true)} style={{ textAlign: "left" }}>
              {nameLabel}{arrow(nameKey)}
            </th>
            {cols.map(([key, label, , isText]) => (
              <th key={key} className="sortable" onClick={() => clickSort(key, isText)}>{label}{arrow(key)}</th>
            ))}
            {extraCol && <th>{extraCol.header}</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.entry_id ?? r.team_id}>
              <td><RankBadge rank={r[rankKey]} /></td>
              <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>{renderName(r)}</td>
              {cols.map(([key, , , isText]) => (
                <td key={key} className={key === "adjusted_points" || key === "points" ? "points-cell" : undefined}
                  style={isText ? { textAlign: "left" } : undefined}>
                  {formatCell(r, key)}
                </td>
              ))}
              {extraCol && <td>{extraCol.render(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(r, key) {
  const v = r[key];
  if (v == null) return "—";
  if (key === "behind_leader" || key === "behind_next") return v === 0 ? "—" : v;
  return formatStat(key, v);
}

export default function StandingsPage() {
  const { seasonId, season, game, series, league, classId, className, raceClass, classes, combinedChampionship } = useLeague();
  const { isAdmin } = useAuth();
  // Which championship is showing rides in the URL too, so a link can point at
  // the team standings rather than always opening on drivers.
  const [tab, setTab] = useState("drivers");
  useEffect(() => {
    if (readParam("tab") === "teams") setTab("teams");
  }, []);
  const chooseTab = t => {
    setTab(t);
    setParam("tab", t === "teams" ? "teams" : null);
  };
  const [data, setData] = useState(null);
  const [adjusting, setAdjusting] = useState(null); // row being edited
  const [adjForm, setAdjForm] = useState({ points_adjustment: "0", adjustment_note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);

  // The Class dropdown in the top bar scopes the whole table: a class shows that
  // class's own isolated championship (its own points, ranks, and gaps), while
  // "All Classes" is the combined whole-field championship.
  const load = useCallback(() => {
    if (!seasonId) { setData(null); return; }
    const qs = `season_id=${seasonId}${classId ? `&class_id=${classId}&class_name=${encodeURIComponent(className)}` : ""}`;
    api(`/api/standings?${qs}`).then(setData).catch(() => setData(null));
  }, [seasonId, classId]);

  useEffect(load, [load]);

  function openAdjust(row) {
    setAdjusting(row);
    setAdjForm({
      points_adjustment: String(row.points_adjustment ?? 0),
      adjustment_note: row.adjustment_note ?? "",
    });
    setError(null);
  }

  async function saveAdjust(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/entries/${adjusting.entry_id}`, {
        method: "PATCH",
        body: {
          points_adjustment: Number(adjForm.points_adjustment || 0),
          adjustment_note: adjForm.adjustment_note,
        },
      });
      setAdjusting(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">🏆</span><p>Select a game, series and season above.</p></div>;
  }

  const rows = data?.[tab] ?? [];
  const heading = `Standings · ${season?.name ?? ""}${className ? ` · ${className}` : ""}`;
  // In the combined view, surface which class each driver runs in; inside a
  // single class the column would be the same value on every row.
  const driverCols = classes.length > 0 && !classId
    ? [...DRIVER_COLS.slice(0, 4), ["class_name", "Class", false, true], ...DRIVER_COLS.slice(4)]
    : DRIVER_COLS;

  const shareNameKey = tab === "teams" ? "team" : "driver_name";
  // Every column on screen is offered in the exporter's stat picker.
  const shareCols = [
    ["rank", "Pos"],
    [shareNameKey, tab === "teams" ? "Team" : "Driver"],
    ...(tab === "teams" ? TEAM_COLS : driverCols).filter(([key]) => key !== shareNameKey),
  ];
  const shareTable = toGraphicTable(shareCols, rows, {
    nameKey: shareNameKey,
    defaultKeys: tab === "teams" ? SHARE_TEAM_DEFAULTS : SHARE_DRIVER_DEFAULTS,
  });

  return (
    <section>
      <div className="page-title">
        <h2>{heading}</h2>
        {className && <span className="page-badge">{className} Championship</span>}
        {!className && classes.length > 0 && (
          <span className="page-badge">{combinedChampionship ? "Overall · All Classes" : "All Classes · Unofficial"}</span>
        )}
        {data?.drop_weeks > 0 && <span className="page-badge">{data.drop_weeks} Drop Week{data.drop_weeks > 1 ? "s" : ""} Applied</span>}
        {rows.length > 0 && (
          <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }} onClick={() => setSharing(true)}>
            🖼 Share Graphic
          </button>
        )}
      </div>
      <ShareGraphicModal
        open={sharing}
        onClose={() => setSharing(false)}
        kind="Standings"
        defaultTitle={`${season?.name ?? "Championship"}${className ? ` ${className}` : ""} Standings`}
        subtitle={[game?.name, series?.name, className, tab === "teams" ? "Team Championship" : "Driver Championship"].filter(Boolean).join(" · ")}
        columns={shareTable.columns}
        rows={shareTable.rows}
        logos={leagueLogos({ league, game, series, season })}
        leagueName={league?.name ?? ""}
        leagueLogoUrl={league?.logo_url ?? ""}
      />
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        BL = points behind leader, BN = points behind next position (championship order). Click any column to sort.
        {classes.length > 0 && (className
          ? ` Showing the ${className} class championship only — switch classes with the Class menu above.`
          : " Showing every class combined — pick a Class above for that class's own championship.")}
      </p>
      {classes.length > 0 && !className && !combinedChampionship && (
        <p style={{ marginTop: 4, color: "var(--ink-2)", fontSize: "0.82rem" }}>
          This season doesn&rsquo;t run an overall championship — the combined table below is for reference only.
        </p>
      )}
      <p style={{ marginTop: 4, color: "var(--ink-2)", fontSize: "0.8rem" }} title={`Ties are broken by ${TIE_BREAKER_SUMMARY}`}>
        Level on points? Ties break on {TIE_BREAKER_SUMMARY.toLowerCase()} — in that order.
      </p>

      <SeasonChampions champions={data?.champions ?? []} />

      <div className="tab-row">
        <button className={`tab${tab === "drivers" ? " active" : ""}`} onClick={() => chooseTab("drivers")}>Drivers</button>
        <button className={`tab${tab === "teams" ? " active" : ""}`} onClick={() => chooseTab("teams")}>Teams</button>
      </div>

      {!data ? (
        <div className="skeleton" style={{ height: 240, marginTop: 18 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏆</span>
          <p>No results yet for this season.</p>
        </div>
      ) : tab === "drivers" ? (
        <SortableTable
          cols={driverCols}
          rows={rows}
          defaultKey="rank"
          nameKey="driver_name"
          nameLabel="Driver"
          renderName={r => {
            // On a game-specific standings, show the driver's mapped alias (their
            // on-track name) as the primary label with the profile name muted
            // beneath; fall back to the profile name when no alias is mapped.
            const alias = r.game_alias && r.game_alias !== r.driver_name ? r.game_alias : null;
            const primary = alias || r.driver_name;
            return (
            <>
              {(r.driver_id || r.user_id)
                ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{primary}</Link>
                : primary}
              {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
              {alias && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.driver_name}</span>}
              {r.points_adjustment !== 0 && (
                <span
                  className="badge"
                  title={`Manual adjustment: ${r.points_adjustment > 0 ? "+" : ""}${r.points_adjustment}${r.adjustment_note ? ` — ${r.adjustment_note}` : ""}`}
                  style={{ marginLeft: 6 }}
                >
                  {r.points_adjustment > 0 ? "+" : ""}{r.points_adjustment}
                </span>
              )}
            </>
            );
          }}
          extraCol={isAdmin ? {
            header: "Adjust",
            render: r => (
              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => openAdjust(r)}>✎</button>
            ),
          } : null}
        />
      ) : (
        <SortableTable
          cols={TEAM_COLS}
          rows={rows}
          defaultKey="rank"
          nameKey="team"
          nameLabel="Team"
          renderName={r => (
            <Link href={`/teams/${encodeURIComponent(r.team)}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent-cyan)" }}>
              {r.logo_url && <img src={r.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
              {r.team}
            </Link>
          )}
        />
      )}

      {adjusting && (
        <div className="modal-overlay" onClick={() => !busy && setAdjusting(null)}>
          <div className="form-card modal-card" onClick={e => e.stopPropagation()}>
            <h3>Adjust Points — {adjusting.driver_name}</h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-1)" }}>
              Earned this season: <strong>{adjusting.points - adjusting.dropped_points}</strong> pts.
              The adjustment below is added on top (use a negative number for a penalty).
            </p>
            <form onSubmit={saveAdjust}>
              <div className="field">
                <label>Points Adjustment (+/−)</label>
                <input type="number" value={adjForm.points_adjustment}
                  onChange={e => setAdjForm(f => ({ ...f, points_adjustment: e.target.value }))} />
              </div>
              <div className="field">
                <label>Reason (shown on hover)</label>
                <input value={adjForm.adjustment_note} placeholder="e.g. Post-race penalty, scoring correction"
                  onChange={e => setAdjForm(f => ({ ...f, adjustment_note: e.target.value }))} />
              </div>
              {error && <div className="toast toast-error">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Adjustment"}</button>
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={() => setAdjusting(null)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
