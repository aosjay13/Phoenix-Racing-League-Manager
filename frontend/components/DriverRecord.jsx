"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSortable } from "@/components/useSortable";
import { formatStat } from "@/lib/standings";
import { formatRaceDate, raceDateSortKey } from "@/lib/raceDate";

// The three tables behind a driver's profile — the race-by-race history, the
// same career split by venue, and split by game. Every column of all three
// sorts, through the shared useSortable hook the Stats and Skill Ratings
// leaderboards use, so a record can be read by whatever a visitor came for:
// their best finishes, the tracks they win at, the game they play most.
//
// They live here rather than inside the page for the reason every mountable
// piece of this app does: a page returns early while its data loads, and a
// sort hook has to run on every render.

// Per-track table columns — the venue-specific slice of a driver's career.
// [key, header, lowerIsBetter] — the same shape the Stats screen's columns use.
const TRACK_COLUMNS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["poles", "Poles"], ["best_laps", "Fastest Laps"], ["avg_start", "Avg Start", true],
  ["avg_finish", "Avg Finish", true], ["laps_led", "Laps Led"],
];

// The by-game breakdown, same shape again.
const GAME_COLUMNS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["poles", "Poles"], ["titles", "Championships", false, "Season championships won — class titles included"],
  ["points", "Points"], ["avg_finish", "Avg Finish", true],
];

// The columns a table sorts LOW-first, because a smaller number is the better
// result: an average start or finish, a grid slot, a finishing position. Every
// other column opens on its biggest value. (Flag one with `true` in the third
// slot of its column tuple above.)
const lowFirst = columns => columns.filter(c => c[2]).map(c => c[0]);
const TRACK_LOW_IS_BETTER = lowFirst(TRACK_COLUMNS);
const GAME_LOW_IS_BETTER = lowFirst(GAME_COLUMNS);
const RACE_LOW_IS_BETTER = ["start_pos", "finish_pos"];

// A date the sort can order. Undated races keep the place they have always
// had — the top of a newest-first list, since an undated race is usually the
// one just added — via a sentinel that sorts after any real date. (A finite
// one: `Infinity - Infinity` is NaN, and a NaN comparator scrambles a sort.)
const UNDATED = 99999999;

// Whatever a table is sorted by, rows that tie read newest first — the order
// the history is in to begin with. Ties inside one day fall to the round
// number, then the session name, exactly as the server orders them.
function byRecency(a, b) {
  return b.date_key - a.date_key
    || (Number(b.round_number ?? 0) - Number(a.round_number ?? 0))
    || String(a.session).localeCompare(String(b.session));
}

// The sortable shape of a race row: every column the table shows resolved to
// one comparable field on the row itself, since that's what useSortable reads.
// (`season_label` and `date_key` are drawn from parts the row already carries.)
function sortableRace(r, i) {
  return {
    ...r,
    // A driver can hold more than one entry in a season (the old
    // one-entry-per-class workaround), so race+session isn't unique on its
    // own — the index off the unsorted list keeps React's keys distinct and
    // stable however the table is then sorted.
    row_key: `${r.race_id}-${r.session}-${i}`,
    date_key: raceDateSortKey(r.date, UNDATED),
    season_label: [r.series_name, r.season_name].filter(Boolean).join(" · "),
  };
}

// Their race history, one row per race. The race name links through to the
// event itself, so a profile is a way INTO every race the driver ran rather
// than a dead end of totals.
//
// `rows` arrives already narrowed to the main events (see isMainEvent) — the
// undercard an event runs on the way to its Feature is not what somebody
// scrolling a driver's record is looking for.
export function RaceHistory({ rows }) {
  const [gameFilter, setGameFilter] = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");

  const races = useMemo(() => rows.map(sortableRace), [rows]);

  // The games and seasons this driver actually raced, in the order the history
  // is already in (newest first), so the menus only ever offer real answers.
  const games = useMemo(() => {
    const seen = new Map();
    for (const r of rows) if (r.game_id && !seen.has(r.game_id)) seen.set(r.game_id, r.game_name || "Unknown Game");
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const seasons = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      if (gameFilter !== "all" && r.game_id !== gameFilter) continue;
      if (r.season_id && !seen.has(r.season_id)) {
        seen.set(r.season_id, [r.series_name, r.season_name].filter(Boolean).join(" · "));
      }
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows, gameFilter]);

  // A season picked under one game can't survive switching to another.
  useEffect(() => {
    if (seasonFilter !== "all" && !seasons.some(s => s.id === seasonFilter)) setSeasonFilter("all");
  }, [seasons, seasonFilter]);

  const shown = useMemo(() => races.filter(r =>
    (gameFilter === "all" || r.game_id === gameFilter) &&
    (seasonFilter === "all" || r.season_id === seasonFilter)),
    [races, gameFilter, seasonFilter]);

  // Sorted by date to begin with, newest first — the order a race history is
  // read in — and by any column from there.
  const { sorted, clickSort, arrow } = useSortable(shown, "date_key", RACE_LOW_IS_BETTER, byRecency);

  return (
    <>
      <div className="section-header">
        <h3>Race History</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="context-select">
            <select value={gameFilter} onChange={e => setGameFilter(e.target.value)}>
              <option value="all">All Games</option>
              {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {seasons.length > 1 && (
            <div className="context-select">
              <select value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
                <option value="all">All Seasons</option>
                {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
      <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Every main event this driver has started, newest first — click 🏁 any race to open its full
        results, or any column heading to sort by it. Qualifying, heats and consolations are left
        off; open the event itself to see those.
      </p>

      {shown.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏁</span><p>No races recorded yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sortable sticky-col" style={{ textAlign: "left" }} onClick={() => clickSort("race_name", true)}>
                  Race{arrow("race_name")}
                </th>
                <th className="sortable" style={{ textAlign: "left" }} onClick={() => clickSort("date_key")}>
                  Date{arrow("date_key")}
                </th>
                <th className="sortable" style={{ textAlign: "left" }} onClick={() => clickSort("season_label", true)}>
                  Season{arrow("season_label")}
                </th>
                <th className="sortable" style={{ textAlign: "left" }} onClick={() => clickSort("track_name", true)}>
                  Track{arrow("track_name")}
                </th>
                <th className="sortable" title="Grid position" onClick={() => clickSort("start_pos")}>Start{arrow("start_pos")}</th>
                <th className="sortable" title="Finishing position" onClick={() => clickSort("finish_pos")}>Finish{arrow("finish_pos")}</th>
                <th className="sortable" onClick={() => clickSort("laps")}>Laps{arrow("laps")}</th>
                <th className="sortable" title="Laps led" onClick={() => clickSort("laps_led")}>Led{arrow("laps_led")}</th>
                <th className="sortable" onClick={() => clickSort("points")}>Points{arrow("points")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                // Whatever else is true of the row — the class it ran in, a
                // status that isn't a clean finish — reads under the name.
                const note = [r.class_name, r.status && r.status !== "finished" ? String(r.status).toUpperCase() : null]
                  .filter(Boolean).join(" · ");
                return (
                <tr key={r.row_key}>
                  <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                    {/* The checkered flag marks the way through to the event's
                        own results — the one thing a row is clicked for. */}
                    <Link href={`/races/${r.race_id}`} title="Open this race's full results" style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                      🏁 {r.race_name}
                    </Link>
                    {r.session && <span style={{ color: "var(--ink-2)" }}> · {r.session}</span>}
                    {note && (
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{note}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>
                    {formatRaceDate(r.date, "short", "Date TBA")}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>
                    {r.season_label || "—"}
                    {r.game_name && (
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{r.game_name}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "left" }}>
                    {r.track_id
                      ? <Link href={`/tracks/${r.track_id}`} style={{ color: "var(--accent-cyan)" }}>{r.track_name}</Link>
                      : (r.track_name || "—")}
                  </td>
                  <td>{r.start_pos ?? "—"}</td>
                  <td style={{ fontWeight: 700, color: r.finish_pos === 1 ? "var(--accent-gold)" : undefined }}>
                    {r.finish_pos ?? "—"}
                    {r.fastest_lap && <span title="Fastest lap" style={{ marginLeft: 4 }}>⚡</span>}
                  </td>
                  <td>{r.laps || "—"}</td>
                  <td>{r.laps_led || "—"}</td>
                  <td className="points-cell">{r.points}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Every venue this driver has raced at. The career figures live under `stats`
// on each row; they are lifted onto the row itself so a column can be sorted
// by the same key it is drawn from.
export function PerTrackStats({ rows }) {
  const tracks = useMemo(() => rows.map(t => ({ ...t.stats, ...t })), [rows]);
  const { sorted, clickSort, arrow } = useSortable(tracks, "wins", TRACK_LOW_IS_BETTER);

  return (
    <>
      <div className="section-header"><h3>Per Track Stats</h3></div>
      <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Every venue this driver has raced at, with their accumulated results there. Click any column
        heading to sort by it.
      </p>
      {rows.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏁</span><p>No track results recorded yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sortable sticky-col" style={{ textAlign: "left" }} onClick={() => clickSort("track_name", true)}>
                  Track{arrow("track_name")}
                </th>
                {TRACK_COLUMNS.map(([key, label, , fullName]) => (
                  <th key={key} className="sortable" title={fullName} onClick={() => clickSort(key)}>{label}{arrow(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(t => (
                <tr key={t.track_id || t.track_name}>
                  <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                    {t.track_id
                      ? <Link href={`/tracks/${t.track_id}`} style={{ color: "var(--accent-cyan)" }}>{t.track_name}</Link>
                      : t.track_name}
                    {t.track_location && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{t.track_location}</span>}
                  </td>
                  {TRACK_COLUMNS.map(([key]) => <td key={key}>{formatStat(key, t[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// The same career split by game — flattened and sorted the same way.
export function ByGame({ rows }) {
  const games = useMemo(() => rows.map(g => ({ ...g.stats, ...g })), [rows]);
  const { sorted, clickSort, arrow } = useSortable(games, "starts", GAME_LOW_IS_BETTER);

  return (
    <>
      <div className="section-header"><h3>By Game</h3></div>
      <div className="table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="sortable" style={{ textAlign: "left" }} onClick={() => clickSort("game_name", true)}>
                Game{arrow("game_name")}
              </th>
              {GAME_COLUMNS.map(([key, label, , fullName]) => (
                <th key={key} className="sortable" title={fullName} onClick={() => clickSort(key)}>{label}{arrow(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(g => (
              <tr key={g.game_id}>
                <td className="driver-name-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {g.game_logo_url && <img src={g.game_logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                  {g.game_name}
                </td>
                {GAME_COLUMNS.map(([key]) => (
                  <td key={key} className={key === "points" ? "points-cell" : undefined}>{formatStat(key, g[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
