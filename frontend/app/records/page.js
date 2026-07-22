"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { formatStat } from "@/lib/standings";

// Each record category: [key, label, lowerIsBetter, description].
// These read the same aggregated driver rows the /stats page uses, so a record
// is just the best value in a column across the current Game / Series / Season
// scope. "Lower is better" categories (average finish/start) find the minimum.
const CATEGORIES = [
  ["wins", "Most Wins", false],
  ["poles", "Most Poles", false],
  ["podiums", "Most Podiums", false],
  ["top5", "Most Top 5s", false],
  ["top10", "Most Top 10s", false],
  ["best_laps", "Most Fastest Laps", false],
  ["laps_led", "Most Laps Led", false],
  ["most_laps_led", "Most 'Most Laps Led'", false],
  ["starts", "Most Starts", false],
  ["points", "Most Points", false],
  ["titles", "Most Titles", false],
  ["avg_finish", "Lowest Avg Finish", true],
  ["avg_start", "Lowest Avg Start", true],
];

const DriverLink = ({ r }) =>
  (r.driver_id || r.user_id)
    ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
    : <span>{r.driver_name}</span>;

// Find the record holder(s) for one category. Ties surface every holder.
// Lower-is-better categories ignore rows with no value or no starts (a driver
// who only ever qualified has no average finish to compare).
function holdersFor(rows, key, lowerIsBetter) {
  const eligible = rows.filter(r => r[key] != null && (lowerIsBetter ? r.starts > 0 : true));
  if (!eligible.length) return { value: null, holders: [] };
  const best = eligible.reduce(
    (acc, r) => (lowerIsBetter ? Math.min(acc, r[key]) : Math.max(acc, r[key])),
    lowerIsBetter ? Infinity : -Infinity
  );
  // A category where the best is 0 (nobody has any) isn't worth crowning.
  if (!lowerIsBetter && best <= 0) return { value: null, holders: [] };
  return { value: best, holders: eligible.filter(r => r[key] === best) };
}

export default function RecordsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, season, loading } = league ?? {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Scope + title mirror the /stats page exactly, driven by the shared
  // Game / Series / Season dropdowns in the top bar.
  const active = seasonId
    ? { params: `scope=season&season_id=${seasonId}`, title: `${series?.name ?? ""} ${season?.name ?? "Season"} Records`.trim() }
    : seriesId
      ? { params: `scope=series&series_id=${seriesId}`, title: `${series?.name ?? "Series"} Records` }
      : gameId
        ? { params: `scope=game&game_id=${gameId}`, title: `${game?.name ?? "Game"} Records` }
        : { params: "scope=league", title: "League All-Time Records" };

  useEffect(() => {
    if (loading) return;
    setData(null);
    setError(null);
    api(`/api/stats?${active.params}`).then(setData).catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.params, loading]);

  const records = useMemo(() => {
    const rows = data?.rows ?? [];
    return CATEGORIES.map(([key, label, lower]) => ({ key, label, lower, ...holdersFor(rows, key, lower) }));
  }, [data]);

  const hasAny = records.some(r => r.holders.length);

  return (
    <section>
      <div className="page-title">
        <h2>{active.title}</h2>
        {data && (
          <span className="page-badge">
            {data.rows.length} Driver{data.rows.length === 1 ? "" : "s"}
            {" · "}{data.seasons_counted} Season{data.seasons_counted === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        The record holder in each category for the current scope. Use the Game / Series / Season menus
        above to change scope (pick &quot;All&quot; to widen it).
      </p>

      {error ? (
        <div className="empty-state"><span className="empty-state-icon">🏅</span><p>{error}</p></div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      ) : !hasAny ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏅</span>
          <p>No records in this scope yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Records build automatically as admins enter race results.
          </p>
        </div>
      ) : (
        <div className="metrics" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", marginTop: 18 }}>
          {records.map(rec => (
            <article className="metric-card" key={rec.key} style={{ alignItems: "flex-start", textAlign: "left", padding: "16px 18px" }}>
              <div className="metric-label" style={{ marginBottom: 6 }}>{rec.label}</div>
              {rec.holders.length === 0 ? (
                <div style={{ color: "var(--ink-2)" }}>—</div>
              ) : (
                <>
                  <div className="metric-num" style={{ fontSize: "1.5rem" }}>{formatStat(rec.key, rec.value)}</div>
                  <div style={{ marginTop: 4, fontSize: "0.9rem", lineHeight: 1.4 }}>
                    {rec.holders.map((h, i) => (
                      <span key={(h.driver_id ?? h.user_id ?? "") + h.driver_name}>
                        {i > 0 && ", "}
                        <DriverLink r={h} />
                      </span>
                    ))}
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
