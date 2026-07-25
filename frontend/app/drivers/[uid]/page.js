"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { formatStat } from "@/lib/standings";

const STAT_LABELS = [
  ["starts", "Starts"], ["wins", "Wins"], ["podiums", "Podiums"], ["top5", "Top 5s"],
  ["top10", "Top 10s"], ["avg_finish", "Avg Finish"], ["laps_run", "Laps Run"],
  ["laps_led", "Laps Led"], ["most_laps_led", "Most Laps Led"], ["best_laps", "Best Laps"],
  ["poles", "Poles"], ["avg_start", "Avg Start"], ["dnfs", "DNFs"],
  ["provisionals", "Provisionals"], ["titles", "Titles"], ["points", "Points"],
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

export default function DriverProfilePage() {
  const { uid } = useParams();
  const { user, profile: myProfile } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gameFilter, setGameFilter] = useState("all");
  const [view, setView] = useState("career"); // "career" | "tracks"
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

  const { profile, all_games, by_game, by_track = [], by_class = [], linked, skill_ratings_by_game = [], aliases = [], former_names = [] } = data;
  const stats = gameFilter === "all"
    ? all_games
    : by_game.find(g => g.game_id === gameFilter)?.stats ?? all_games;

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
        <button className={`tab${view === "tracks" ? " active" : ""}`} onClick={() => setView("tracks")}>Per Track Stats</button>
      </div>

      {view === "career" ? (
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

      {view === "career" && by_game.length > 0 && (
        <>
          <div className="section-header"><h3>By Game</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Game</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Top 5s</th><th>Poles</th><th>Titles</th><th>Points</th><th>Avg Finish</th></tr></thead>
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

      {/* Per-class career line. A driver who has raced GT3 and LMP2 sees each
          separately here, on top of the combined totals above — the same result
          feeds both. Absent for drivers who've only raced seasons with no
          classes, which is every season that predates them. */}
      {view === "career" && by_class.length > 0 && (
        <>
          <div className="section-header">
            <h3 title="Each class this driver has raced in, scored on its own">By Class</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Class</th><th>Starts</th><th>Wins</th><th>Podiums</th><th>Top 5s</th><th>Poles</th><th>Titles</th><th>Points</th><th>Avg Finish</th></tr></thead>
              <tbody>
                {by_class.map(c => (
                  <tr key={c.class_id}>
                    <td className="driver-name-cell" style={{ color: c.color || undefined }}>{c.class_name}</td>
                    <td>{c.stats.starts}</td>
                    <td>{c.stats.wins}</td>
                    <td>{c.stats.podiums}</td>
                    <td>{c.stats.top5}</td>
                    <td>{c.stats.poles}</td>
                    <td>{c.stats.titles}</td>
                    <td className="points-cell">{c.stats.points}</td>
                    <td>{formatStat("avg_finish", c.stats.avg_finish)}</td>
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
