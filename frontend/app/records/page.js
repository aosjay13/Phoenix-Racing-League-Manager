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
  ["titles", "Most Championships", false, "Season titles won — a class championship counts the same as an overall one"],
  ["avg_finish", "Lowest Avg Finish", true],
  ["avg_start", "Lowest Avg Start", true],
];

const DriverLink = ({ r }) =>
  (r.driver_id || r.user_id)
    ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{r.driver_name}</Link>
    : <span>{r.driver_name}</span>;

const TeamLink = ({ r }) => (
  <Link href={`/teams/${encodeURIComponent(r.team_name)}`} style={{ color: "var(--accent-cyan)", display: "inline-flex", alignItems: "center", gap: 6 }}>
    {r.logo_url && <img src={r.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
    {r.team_name}
  </Link>
);

// Average-based categories require a minimum number of starts to hold the
// record — otherwise a "one-hit wonder" who ran a single race and won it would
// post a perfect 1.00 average and unfairly outrank series regulars who kept a
// strong average across dozens of races. Cumulative stats (wins, poles, laps
// led, …) are intentionally excluded: a driver with one start and one win
// should still tie for Most Wins. The Stats and Standings pages still show
// that driver's 1.00 average; they just can't be crowned the record holder.
const MIN_STARTS_FOR_AVG = 2;
const AVG_CATEGORIES = new Set(["avg_finish", "avg_start"]);

// Find the record holder(s) for one category. Ties surface every holder.
// Lower-is-better categories ignore rows with no value, and average categories
// additionally require at least MIN_STARTS_FOR_AVG starts to be eligible.
function holdersFor(rows, key, lowerIsBetter) {
  const minStarts = AVG_CATEGORIES.has(key) ? MIN_STARTS_FOR_AVG : (lowerIsBetter ? 1 : 0);
  const eligible = rows.filter(r => r[key] != null && (r.starts ?? 0) >= minStarts);
  if (!eligible.length) return { value: null, holders: [] };
  const best = eligible.reduce(
    (acc, r) => (lowerIsBetter ? Math.min(acc, r[key]) : Math.max(acc, r[key])),
    lowerIsBetter ? Infinity : -Infinity
  );
  // A category where the best is 0 (nobody has any) isn't worth crowning.
  if (!lowerIsBetter && best <= 0) return { value: null, holders: [] };
  return { value: best, holders: eligible.filter(r => r[key] === best) };
}

// Average Field Size for the current scope. Unlike every other category on this
// page this isn't a driver record — nobody "holds" it — so it renders as a
// single contextual figure ("Season 4 Average: 15.2") with the sample it was
// drawn from. Only races with finalized results feed it (see the field_size
// block in /api/stats), so upcoming and empty events never drag it down.
function FieldSizeCard({ fieldSize, scopeLabel, loading }) {
  if (loading) return <div className="skeleton" style={{ height: 96, marginTop: 18 }} />;
  const avg = fieldSize?.avg_drivers_per_race ?? null;
  const races = fieldSize?.races_counted ?? 0;
  return (
    <article className="metric-card" style={{ alignItems: "flex-start", textAlign: "left", padding: "16px 18px", marginTop: 18 }}>
      <div className="metric-label" style={{ marginBottom: 6 }}>Avg Drivers per Race</div>
      {avg == null ? (
        <>
          <div style={{ color: "var(--ink-2)" }}>—</div>
          <div style={{ marginTop: 4, fontSize: "0.85rem", color: "var(--ink-2)" }}>
            No completed races with results in this scope yet.
          </div>
        </>
      ) : (
        <>
          <div className="metric-num" style={{ fontSize: "1.9rem" }}>{avg.toFixed(2)}</div>
          <div style={{ marginTop: 4, fontSize: "0.9rem", lineHeight: 1.45 }}>
            <strong>{scopeLabel} Average: {avg.toFixed(1)}</strong>
            <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.82rem" }}>
              {fieldSize.total_drivers} entr{fieldSize.total_drivers === 1 ? "y" : "ies"} across {races} completed
              race{races === 1 ? "" : "s"}
              {fieldSize.smallest_field != null && ` · smallest ${fieldSize.smallest_field}, largest ${fieldSize.largest_field}`}
            </span>
          </div>
        </>
      )}
    </article>
  );
}

export default function RecordsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, classId, className, game, series, season, raceClass, loading } = league ?? {};
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("drivers"); // "drivers" | "teams"

  // Scope + title mirror the /stats page exactly, driven by the shared
  // Game / Series / Season / Class dropdowns in the top bar.
  // Both id and name: the id pins an exact season's class, the name is what
  // resolves the same class across the seasons in a wider scope.
  const classParam = classId ? `&class_id=${classId}&class_name=${encodeURIComponent(className)}` : "";
  const active = seasonId
    ? { params: `scope=season&season_id=${seasonId}${classParam}`, title: `${series?.name ?? ""} ${season?.name ?? "Season"}${className ? ` ${className}` : ""} Records`.trim() }
    : seriesId
      ? { params: `scope=series&series_id=${seriesId}${classParam}`, title: `${series?.name ?? "Series"} Records` }
      : gameId
        ? { params: `scope=game&game_id=${gameId}${classParam}`, title: `${game?.name ?? "Game"} Records` }
        : { params: `scope=league${classParam}`, title: "League All-Time Records" };

  // Label for the Average Field Size card — names the exact scope the number
  // was measured over, e.g. "Season 4 Average" / "iRacing Average".
  const scopeLabel = seasonId
    ? `${season?.name ?? "Season"}${className ? ` ${className}` : ""}`
    : seriesId ? (series?.name ?? "Series")
      : gameId ? (game?.name ?? "Game")
        : "League";

  useEffect(() => {
    if (loading) return;
    setData(null);
    setError(null);
    api(`/api/stats?${active.params}`).then(setData).catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.params, loading]);

  const isTeams = tab === "teams";
  const records = useMemo(() => {
    const rows = (isTeams ? data?.team_rows : data?.rows) ?? [];
    return CATEGORIES.map(([key, label, lower]) => ({ key, label, lower, ...holdersFor(rows, key, lower) }));
  }, [data, isTeams]);

  const hasAny = records.some(r => r.holders.length);
  const count = (isTeams ? data?.team_rows?.length : data?.rows?.length) ?? 0;

  return (
    <section>
      <div className="page-title">
        <h2>{active.title}</h2>
        {data && (
          <span className="page-badge">
            {count} {isTeams ? "Team" : "Driver"}{count === 1 ? "" : "s"}
            {" · "}{data.seasons_counted} Season{data.seasons_counted === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        The record holder in each category for the current scope. Use the Game / Series / Season / Class menus
        above to change scope (pick &quot;All&quot; to widen it).
      </p>

      {/* Average Field Size — an event stat, not a driver record, so it just
          reports the number for whatever the dropdowns currently select. */}
      <FieldSizeCard fieldSize={data?.field_size} scopeLabel={scopeLabel} loading={!data && !error} />

      <div className="tab-row">
        <button className={`tab${tab === "drivers" ? " active" : ""}`} onClick={() => setTab("drivers")}>Drivers</button>
        <button className={`tab${tab === "teams" ? " active" : ""}`} onClick={() => setTab("teams")}>Teams</button>
      </div>

      {error ? (
        <div className="empty-state"><span className="empty-state-icon">🏅</span><p>{error}</p></div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      ) : !hasAny ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏅</span>
          <p>No {isTeams ? "team " : ""}records in this scope yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            {isTeams
              ? "Team records build automatically as drivers assigned to a team score results."
              : "Records build automatically as admins enter race results."}
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
                      <span key={isTeams ? h.team_name : (h.driver_id ?? h.user_id ?? "") + h.driver_name}>
                        {i > 0 && ", "}
                        {isTeams ? <TeamLink r={h} /> : <DriverLink r={h} />}
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
