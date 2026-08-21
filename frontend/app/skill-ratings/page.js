"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { ShareGraphicButton, ShareGraphicModal } from "@/components/ShareGraphicModal";
import { leagueLogos, specToGraphicTable } from "@/lib/shareGraphic";
import { useRawBundle } from "@/components/useRawBundle";
import { buildSkillRatings } from "@/lib/skillRatingsCompute";
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

// The trend chip as plain text for the exporter: "+12" / "−8" / "±0".
function trendText(delta) {
  if (delta == null) return "—";
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : String(delta);
}

export default function SkillRatingsPage() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, season, loading } = league ?? {};
  const [sharing, setSharing] = useState(false);

  // Scope mirrors the Stats / Records pages: the deepest concrete selection in
  // the top dropdowns wins. SR is gated per game, so a Game must be selected —
  // "All Games" has no single comparable rating. Narrower series/season scopes
  // still resolve to their game's ratings.
  const active = seasonId
    ? { scope: "season", title: `${series?.name ?? ""} ${season?.name ?? "Season"} Skill Ratings`.trim() }
    : seriesId
      ? { scope: "series", title: `${series?.name ?? "Series"} Skill Ratings` }
      : gameId
        ? { scope: "game", title: `${game?.name ?? "Game"} Skill Ratings` }
        : null; // no game selected → show the "pick a game" prompt below

  // ALWAYS the whole game, whatever the dropdowns say. A rating is that game's
  // entire timeline replayed from the 1500 baseline, so a season-scoped bundle
  // would produce a rating that depended on which page you looked at it from; a
  // narrower scope only decides who is LISTED (see lib/skillRatingsCompute.js).
  const { index, error: bundleError } = useRawBundle({
    scope: "game", gameId, enabled: !loading && !!active && !!gameId,
  });

  // The Elo replay itself, in the browser. This was the app's other
  // full-history read: every SR race the game has ever run, ordered by date and
  // exchanged one session at a time.
  const computed = useMemo(
    () => (index && active ? buildSkillRatings(index, { scope: active.scope, gameId, seriesId, seasonId }) : null),
    [index, active?.scope, gameId, seriesId, seasonId],
  );
  const data = computed?.status === 200 ? computed.body : null;
  const error = bundleError || (computed && computed.status !== 200 ? computed.body?.error : null);

  const lowIsBetter = useMemo(() => [], []);
  const { sorted: rows, clickSort, arrow } = useSortable(data?.rows, "skill_rating", lowIsBetter);

  const count = data?.count ?? 0;

  // The exporter mirrors the table, in the order it's currently sorted — so a
  // re-sort on any column is what gets posted. The leaderboard has a ranking,
  // so the top three are medalled the way Standings' are.
  const shareSpec = [
    { key: "rank", label: "Rank", locked: true, get: (r, i) => r.rank ?? i + 1 },
    { key: "driver", label: "Driver", align: "left", locked: true, wrap: true, get: r => r.driver_name },
    { key: "sr", label: "SR", get: r => r.skill_rating },
    { key: "trend", label: "Trend", get: r => trendText(r.last_delta) },
    { key: "races", label: "Races", get: r => r.total_races ?? 0 },
  ];
  const shareTable = specToGraphicTable(shareSpec, rows, { rankOf: (r, i) => r.rank ?? i + 1 });

  return (
    <section>
      <div className="page-title">
        <h2>{active?.title ?? "Skill Ratings"}</h2>
        {active && data && (
          <span className="page-badge">{count} Driver{count === 1 ? "" : "s"}</span>
        )}
        {rows.length > 0 && <ShareGraphicButton onClick={() => setSharing(true)} />}
      </div>

      <ShareGraphicModal
        open={sharing}
        onClose={() => setSharing(false)}
        kind="Skill Ratings"
        defaultTitle={active?.title ?? "Skill Ratings"}
        subtitle={[game?.name, series?.name, season?.name].filter(Boolean).join(" · ")}
        columns={shareTable.columns}
        rows={shareTable.rows}
        meta={[
          { label: "Game", value: game?.name },
          { label: "Scope", value: season?.name || series?.name || game?.name },
          { label: "Rated Drivers", value: count },
          { label: "Baseline", value: SR_BASELINE },
        ]}
        logos={leagueLogos({ league: league?.league, game, series, season })}
        leagueName={league?.league?.name ?? ""}
        leagueLogoUrl={league?.league?.logo_url ?? ""}
      />
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
                    {/* This board is always one game, so it leads with that game's
                        name for the driver and keeps their profile name beneath. */}
                    {r.game_alias && r.profile_name && r.game_alias !== r.profile_name && (
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.profile_name}</span>
                    )}
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
