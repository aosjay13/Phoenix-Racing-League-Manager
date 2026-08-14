"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { formatStat, isMainEvent } from "@/lib/standings";
import { formatRaceDate } from "@/lib/raceDate";

// The full name of a championship: the game it was played on, the series and
// season it was won in, and — for a class title — the class it was won in.
// "Season 3" on its own names a title nobody can place; this reads as one.
function titlePath({ game_name, series_name, season_name }, className = null) {
  return [game_name, series_name, season_name, className].filter(Boolean).join(" › ");
}

// One row per CROWN rather than per season, because that's how they're counted:
// a driver taking their class and the overall in the same season won two
// championships, and each is its own line with its own full path.
function crownRows(titles) {
  const rows = [];
  for (const t of titles) {
    const classNames = t.class_names || [];
    if (t.overall) rows.push({ key: `${t.season_id}-overall`, path: titlePath(t), crown: "Overall", double: classNames.length > 0 });
    // The class name is already the last step of the path, so the badge only
    // has to say which KIND of crown this was.
    for (const c of classNames) {
      rows.push({ key: `${t.season_id}-class-${c}`, path: titlePath(t, c), crown: "Class", double: t.overall });
    }
  }
  return rows;
}

const STAT_LABELS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["top10", "Top 10s"], ["avg_finish", "Avg Finish"], ["laps_run", "Laps Run"],
  ["laps_led", "Laps Led"], ["most_laps_led", "Most Laps Led"], ["best_laps", "Best Laps"],
  ["poles", "Poles"], ["avg_start", "Avg Start"], ["dnfs", "DNFs"],
  ["provisionals", "Provisionals"], ["titles", "Championships"], ["points", "Points"],
];

// Small coloured +/- chip for a driver's most recent SR change in a game.
// Mirrors the Skill Ratings leaderboard's Trend indicator.
function SrTrend({ delta }) {
  if (delta == null) return null;
  if (delta === 0) return <span style={{ fontSize: "0.72rem", color: "var(--ink-2)", fontWeight: 600 }}>±0</span>;
  const up = delta > 0;
  return (
    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: up ? "var(--positive, #34d399)" : "var(--negative, #f87171)" }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{delta}
    </span>
  );
}

// Per-track table columns — the venue-specific slice of a driver's career.
const TRACK_COLUMNS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["poles", "Poles"], ["best_laps", "Fastest Laps"], ["avg_start", "Avg Start"],
  ["avg_finish", "Avg Finish"], ["laps_led", "Laps Led"],
];

// Their race history, one row per race. The race name links through to the
// event itself, so a profile is a way INTO every race the driver ran rather
// than a dead end of totals.
//
// `rows` arrives already narrowed to the main events (see isMainEvent) — the
// undercard an event runs on the way to its Feature is not what somebody
// scrolling a driver's record is looking for.
function RaceHistory({ rows }) {
  const [gameFilter, setGameFilter] = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");

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

  const shown = rows.filter(r =>
    (gameFilter === "all" || r.game_id === gameFilter) &&
    (seasonFilter === "all" || r.season_id === seasonFilter));

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
        results. Qualifying, heats and consolations are left off; open the event itself to see those.
      </p>

      {shown.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏁</span><p>No races recorded yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="sticky-col" style={{ textAlign: "left" }}>Race</th>
                <th style={{ textAlign: "left" }}>Season</th>
                <th style={{ textAlign: "left" }}>Track</th>
                <th title="Grid position">Start</th>
                <th title="Finishing position">Finish</th>
                <th>Laps</th>
                <th title="Laps led">Led</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                // A driver can hold more than one entry in a season (the old
                // one-entry-per-class workaround), so race+session isn't unique
                // on its own — the index keeps the keys distinct.
                <tr key={`${r.race_id}-${r.session}-${i}`}>
                  <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                    {/* The checkered flag marks the way through to the event's
                        own results — the one thing a row is clicked for. */}
                    <Link href={`/races/${r.race_id}`} title="Open this race's full results" style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                      🏁 {r.race_name}
                    </Link>
                    {r.session && <span style={{ color: "var(--ink-2)" }}> · {r.session}</span>}
                    <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>
                      {formatRaceDate(r.date, "short", "Date TBA")}
                      {r.class_name ? ` · ${r.class_name}` : ""}
                      {r.status && r.status !== "finished" ? ` · ${String(r.status).toUpperCase()}` : ""}
                    </span>
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>
                    {[r.series_name, r.season_name].filter(Boolean).join(" · ") || "—"}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function DriverProfilePage() {
  const { uid } = useParams();
  const { user, profile: myProfile } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gameFilter, setGameFilter] = useState("all");
  const [view, setView] = useState("career"); // "career" | "races" | "tracks"
  // Claim flow: "idle" (button), "pending" (already requested), "done" (just sent)
  const [claimState, setClaimState] = useState("idle");
  const [otherPending, setOtherPending] = useState(false); // pending request for a different driver
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState(null);

  useEffect(() => {
    api(`/api/drivers/${uid}`).then(setData).catch(err => setError(err.message));
  }, [uid]);

  // Each account may hold only one driver profile. Detect a pending request for
  // THIS driver (→ "pending"), or a pending request for a different one (→ block).
  const driverId = data?.driver_id;
  const claimedBy = data?.uid;
  // A driver already linked to this account (from /api/users/me).
  const hasOwnDriver = !!myProfile?.driver_id;
  useEffect(() => {
    if (!user || !driverId || claimedBy) return;
    api("/api/claim-requests")
      .then(rows => {
        const pending = rows.filter(r => r.status === "pending");
        if (pending.some(r => r.driver_id === driverId)) setClaimState("pending");
        else if (pending.length > 0) setOtherPending(true);
      })
      .catch(() => {});
  }, [user, driverId, claimedBy]);

  async function requestClaim() {
    setClaimBusy(true);
    setClaimError(null);
    try {
      await api("/api/claim-requests", { method: "POST", body: { driver_id: driverId } });
      setClaimState("done");
    } catch (err) {
      if (/pending request/i.test(err.message)) setClaimState("pending");
      else setClaimError(err.message);
    } finally {
      setClaimBusy(false);
    }
  }

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏎</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { profile, all_games, by_game, by_track = [], race_history = [], titles_detail = [], linked, skill_ratings_by_game = [], aliases = [], former_names = [] } = data;
  const selectedGame = gameFilter === "all" ? null : by_game.find(g => g.game_id === gameFilter);
  const stats = gameFilter === "all" ? all_games : selectedGame?.stats ?? all_games;
  // Race History lists the races, not everything that ran on the way to them:
  // Qualifying, the heats and the consolation/B-Main are dropped here, once, so
  // the count on the tab, the game/season menus and the table all agree. Every
  // session is still on the event's own page, and career totals are untouched —
  // this is a view filter, nothing more.
  const mainEvents = race_history.filter(isMainEvent);
  const crowns = crownRows(titles_detail);
  // Games where this driver is shown under a different name than their profile
  // one — the names that appear on those games' standings, results and stats.
  const gameNames = by_game.filter(g => g.driver_game_name && g.driver_game_name !== profile.display_name);

  return (
    <section>
      <div className="hero" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        {profile.photo_url
          ? <img src={profile.photo_url} alt="" className="avatar avatar-xl" />
          : <span className="avatar avatar-xl avatar-fallback">{String(profile.display_name || "?")[0]?.toUpperCase()}</span>}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="page-title" style={{ marginBottom: 2 }}>
            <h2>
              {profile.display_name}
              {profile.number != null && <span style={{ color: "var(--accent-gold)", marginLeft: 10 }}>#{profile.number}</span>}
            </h2>
          </div>
          {profile.country && <span className="page-badge">{profile.country}</span>}
          {!linked && (
            <span className="page-badge" style={{ background: "transparent", border: "1px solid var(--ink-2)", color: "var(--ink-2)", marginLeft: profile.country ? 8 : 0 }}>
              ⛓️‍💥 Not linked to an account
            </span>
          )}
          {profile.bio && <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 560 }}>{profile.bio}</p>}
          {former_names.length > 0 && (
            <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: "0.82rem" }}>
              Also known as: {former_names.join(", ")}
            </p>
          )}
          {/* The name this driver appears under inside each game — what that
              game's standings, results, stats and records show. */}
          {gameNames.length > 0 && (
            <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: "0.82rem" }}>
              Races as: {gameNames.map(g => `${g.driver_game_name} (${g.game_name})`).join(", ")}
            </p>
          )}
          {!linked && (
            <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: "0.85rem", maxWidth: 560 }}>
              These stats are tracked from race results. No player account has claimed this driver yet, so there's no profile photo, bio, or country.
            </p>
          )}

          {/* Claim flow: a signed-in user can request that admins link this
              unclaimed driver profile to their account. Admin approval required. */}
          {user && driverId && !claimedBy && (
            <div style={{ marginTop: 14 }}>
              {claimState === "pending" ? (
                <span className="page-badge" style={{ background: "rgba(255,178,36,0.14)", color: "var(--accent-amber, #ffb224)", border: "1px solid rgba(255,178,36,0.3)" }}>
                  ⏳ Claim request pending admin approval
                </span>
              ) : claimState === "done" ? (
                <div className="toast toast-success" style={{ margin: 0 }}>
                  Request sent! An admin will review it before this profile is linked to your account.
                </div>
              ) : hasOwnDriver ? (
                <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.85rem", maxWidth: 560 }}>
                  You've already claimed{" "}
                  <Link href={`/drivers/${myProfile.driver_id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                    {myProfile.driver_name || "a driver profile"}
                  </Link>. Each account can hold only one — unclaim it from the{" "}
                  <Link href="/drivers" style={{ color: "var(--accent-cyan)" }}>Drivers</Link> list before claiming a different one.
                </p>
              ) : otherPending ? (
                <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.85rem", maxWidth: 560 }}>
                  You already have a pending claim request for another profile. You can only request one driver profile at a time.
                </p>
              ) : (
                <>
                  <button className="btn btn-primary" style={{ marginTop: 0 }} disabled={claimBusy} onClick={requestClaim}>
                    {claimBusy ? "Sending…" : "🙋 This is me — request to claim this profile"}
                  </button>
                  <p style={{ marginTop: 8, color: "var(--ink-2)", fontSize: "0.8rem", maxWidth: 560 }}>
                    An admin must approve your request before this driver is linked to your account.
                  </p>
                  {claimError && <div className="toast toast-error" style={{ marginTop: 8 }}>{claimError}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {skill_ratings_by_game.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="section-header">
            <h3 title="Skill Ratings are tracked separately for each game">📈 Skill Ratings</h3>
            <Link href="/skill-ratings" className="page-badge" style={{ textDecoration: "none" }}>Leaderboard →</Link>
          </div>
          <div className="metrics" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
            {skill_ratings_by_game.map(g => (
              <article className="metric-card" key={g.game_id}>
                <div className="metric-num" style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "center" }}>
                  {g.rating}
                  <SrTrend delta={g.last_delta} />
                </div>
                <div className="metric-label">
                  {g.game_name}
                  {!g.ranked && <span style={{ color: "var(--ink-2)" }}> · Unranked</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {aliases.length > 0 && (() => {
        // For each game with 2+ mapped aliases, work out which one is the
        // on-track display name (the one flagged is_display, else the first) so
        // we can mark it — matching gameAlias() on the server.
        const byGame = {};
        for (const a of aliases) if (a.game_id) (byGame[a.game_id] ??= []).push(a);
        const displayFor = {};
        for (const [gid, list] of Object.entries(byGame)) {
          displayFor[gid] = (list.find(a => a.is_display) || list[0]);
        }
        return (
        <div style={{ marginTop: 22 }}>
          <div className="section-header">
            <h3 title="Platform usernames this driver races under">🎮 Aliases</h3>
          </div>
          <div className="form-card" style={{ marginTop: 0 }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {aliases.map((a, i) => {
                const isDisplay = a.game_id && byGame[a.game_id].length > 1 && displayFor[a.game_id] === a;
                return (
                <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--ink-2)", fontSize: "0.82rem", minWidth: 120 }}>{a.label}</span>
                  <span style={{ color: "var(--ink-0, var(--ink-1))", fontWeight: 600 }}>{a.value}</span>
                  {a.game_name && (
                    <span className="page-badge" style={{ fontSize: "0.72rem" }}>{a.game_name}</span>
                  )}
                  {isDisplay && (
                    <span title={`Shown on ${a.game_name || "this game"}'s tables`} style={{ fontSize: "0.72rem", color: "var(--accent-gold)" }}>★ display</span>
                  )}
                </li>
                );
              })}
            </ul>
          </div>
        </div>
        );
      })()}

      <div className="tab-row" style={{ marginTop: 24 }}>
        <button className={`tab${view === "career" ? " active" : ""}`} onClick={() => setView("career")}>Career Stats</button>
        <button className={`tab${view === "races" ? " active" : ""}`} onClick={() => setView("races")}>
          Race History
          {mainEvents.length > 0 && (
            <span style={{ marginLeft: 6, color: "var(--ink-2)", fontWeight: 400 }}>{mainEvents.length}</span>
          )}
        </button>
        <button className={`tab${view === "tracks" ? " active" : ""}`} onClick={() => setView("tracks")}>Per Track Stats</button>
      </div>

      {view === "races" ? (
        <RaceHistory rows={mainEvents} />
      ) : view === "career" ? (
        <>
          <div className="section-header">
            <h3>Career Stats</h3>
            <div className="context-select">
              <select value={gameFilter} onChange={e => setGameFilter(e.target.value)}>
                <option value="all">All Games</option>
                {by_game.map(g => <option key={g.game_id} value={g.game_id}>{g.game_name}</option>)}
              </select>
            </div>
          </div>

          {selectedGame?.driver_game_name && selectedGame.driver_game_name !== profile.display_name && (
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ink-2)", fontSize: "0.85rem" }}>
              Shown as <strong>{selectedGame.driver_game_name}</strong> in {selectedGame.game_name}.
            </p>
          )}

          {stats.starts === 0 ? (
            <div className="empty-state"><span className="empty-state-icon">📊</span><p>No race results recorded yet.</p></div>
          ) : (
            <div className="metrics" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
              {STAT_LABELS.map(([key, label]) => (
                <article className="metric-card" key={key}>
                  <div className="metric-num">{formatStat(key, stats[key])}</div>
                  <div className="metric-label">{label}</div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="section-header"><h3>Per Track Stats</h3></div>
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--ink-1)", fontSize: "0.88rem" }}>
            Every venue this driver has raced at, with their accumulated results there.
          </p>
          {by_track.length === 0 ? (
            <div className="empty-state"><span className="empty-state-icon">🏁</span><p>No track results recorded yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="sticky-col" style={{ textAlign: "left" }}>Track</th>
                    {TRACK_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {by_track.map(t => (
                    <tr key={t.track_id || t.track_name}>
                      <td className="driver-name-cell sticky-col" style={{ textAlign: "left" }}>
                        {t.track_id
                          ? <Link href={`/tracks/${t.track_id}`} style={{ color: "var(--accent-cyan)" }}>{t.track_name}</Link>
                          : t.track_name}
                        {t.track_location && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.76rem" }}>{t.track_location}</span>}
                      </td>
                      {TRACK_COLUMNS.map(([key]) => <td key={key}>{formatStat(key, t.stats[key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === "career" && crowns.length > 0 && (
        <>
          <div className="section-header"><h3>Championships</h3></div>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
            Every title won, named in full — game › series › season › class — so it's clear exactly
            what was won. A class championship counts the same as any other, and taking both a class
            and the overall in one season is two championships: both crowns were won, so both are listed.
          </p>
          <div className="table-wrap">
            <table className="stats-table">
              <thead><tr><th style={{ textAlign: "left" }}>Title</th><th style={{ textAlign: "left" }}>Crown</th></tr></thead>
              <tbody>
                {crowns.map(c => (
                  <tr key={c.key}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>🏆 {c.path}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className="badge" style={{ marginRight: 6 }}>{c.crown}</span>
                      {c.double && (
                        <span style={{ color: "var(--ink-2)", fontSize: "0.76rem" }}>double crown — counts twice</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "career" && by_game.length > 0 && (
        <>
          <div className="section-header"><h3>By Game</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Game</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Top 5s</th><th>Poles</th><th title="Season championships won — class titles included">Championships</th><th>Points</th><th>Avg Finish</th></tr></thead>
              <tbody>
                {by_game.map(g => (
                  <tr key={g.game_id}>
                    <td className="driver-name-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {g.game_logo_url && <img src={g.game_logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                      {g.game_name}
                    </td>
                    <td>{g.stats.starts}</td>
                    <td>{g.stats.wins}</td>
                    <td>{g.stats.podiums}</td>
                    <td>{g.stats.top5}</td>
                    <td>{g.stats.poles}</td>
                    <td>{g.stats.titles}</td>
                    <td className="points-cell">{g.stats.points}</td>
                    <td>{formatStat("avg_finish", g.stats.avg_finish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
