"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { SeriesInfoPanel } from "@/components/SeriesInfoPanel";
import { MessageBoard } from "@/components/MessageBoard";
import { api } from "@/lib/api";
import { formatRaceDate, isPastRaceDate, raceDateSortKey, toDateOnly } from "@/lib/raceDate";

export default function DashboardPage() {
  const { gameId, seriesId, seasonId, season, series, game, games, loading } = useLeague();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);

  // The dashboard follows whichever level of the game → series → season
  // drop-downs is currently narrowed to. An "All …" choice ("") widens the
  // scope: no season → the whole series, no series → the whole game, no game
  // → the entire league.
  const scope = seasonId ? "season" : seriesId ? "series" : gameId ? "game" : "league";

  useEffect(() => {
    let live = true;
    setData(null);

    if (scope === "season") {
      Promise.all([
        api(`/api/standings?season_id=${seasonId}`),
        api(`/api/races?season_id=${seasonId}`),
      ]).then(([standings, races]) => {
        if (!live) return;
        // Calendar-date comparisons only — a race dated today is still upcoming,
        // and no timezone offset can shift it into yesterday.
        const dated = races.filter(r => toDateOnly(r.date));
        setData({
          leader: standings.drivers[0] ?? null,
          driverCount: new Set(standings.drivers.map(d => d.entry_id)).size,
          totalRaces: races.length,
          completed: dated.filter(r => isPastRaceDate(r.date)).length,
          nextRace: dated.filter(r => !isPastRaceDate(r.date))
            .sort((a, b) => raceDateSortKey(a.date) - raceDateSortKey(b.date))[0] ?? null,
        });
      }).catch(() => setData(null));
    } else {
      const qs = scope === "game" ? `scope=game&game_id=${gameId}`
        : scope === "series" ? `scope=series&series_id=${seriesId}`
        : "scope=league";
      api(`/api/stats?${qs}`).then(stats => {
        if (!live) return;
        setData({
          leader: stats.rows[0] ?? null,
          driverCount: stats.rows.length,
          teamCount: stats.team_rows.length,
          seasonsCounted: stats.seasons_counted,
          totalRaces: stats.race_summary.total,
          completed: stats.race_summary.completed,
          nextRace: stats.race_summary.next_race,
        });
      }).catch(() => setData(null));
    }

    return () => { live = false; };
  }, [scope, gameId, seriesId, seasonId]);

  if (loading) return <div className="skeleton" style={{ height: 200 }} />;

  // Only truly empty when nothing has been set up yet.
  if (scope === "league" && games.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🏁</span>
        <p>No games set up yet.</p>
        {isAdmin
          ? <Link href="/admin" className="btn btn-primary">Set up your first game, series & season</Link>
          : <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>Ask a league admin to create a season.</p>}
      </div>
    );
  }

  const title = scope === "season" ? `${series?.name ?? "Series"} · ${season?.name ?? "Season"}`
    : scope === "series" ? `${series?.name ?? "Series"} · All Seasons`
    : scope === "game" ? `${game?.name ?? "Game"} · All Series`
    : "All Games · League Overview";

  const titleLogo = scope === "game" ? game?.logo_url : series?.logo_url;

  const leaderPoints = data?.leader ? (data.leader.adjusted_points ?? data.leader.points) : null;

  const metrics = data ? (scope === "season" ? [
    { icon: "🏎️", num: data.driverCount, label: "Drivers Scored" },
    { icon: "📅", num: data.totalRaces, label: "Scheduled Races" },
    { icon: "✅", num: data.completed, label: "Completed Events" },
    { icon: "⏩", num: Math.max(0, data.totalRaces - data.completed), label: "Races Remaining" },
  ] : [
    { icon: "🏎️", num: data.driverCount, label: "Drivers Scored" },
    { icon: "🏁", num: data.completed, label: "Races Run" },
    { icon: "📅", num: data.seasonsCounted, label: data.seasonsCounted === 1 ? "Season" : "Seasons" },
    { icon: "👥", num: data.teamCount, label: "Teams" },
  ]) : [];

  const contextLine = scope === "season"
    ? (game?.name ? `Racing on ${game.name}. ` : "")
    : scope === "series" ? `Every season in ${series?.name ?? "this series"}. `
    : scope === "game" ? `Every series on ${game?.name ?? "this game"}. `
    : "Combined totals across every game, series and season. ";

  const quickLinks = [
    { href: "/standings", icon: "🏆", label: "Standings", sub: "Driver & team points" },
    { href: "/stats", icon: "📊", label: "Stats", sub: "Career totals & records" },
    { href: "/schedule", icon: "📅", label: "Schedule", sub: "Season calendar" },
    { href: "/drivers", icon: "🏎", label: "Drivers", sub: "Player profiles" },
    // Results are entered from the event itself now — the Schedule's ⏱ button
    // opens the event's results grid.
    ...(isAdmin ? [{ href: "/schedule", icon: "⏱", label: "Enter Results", sub: "Pick an event on the Schedule" }] : []),
  ];

  return (
    <section>
      {/* Above everything, including the hero: the league talking to this
          player. Every admin decision about them lands here — approved into a
          series (with the welcome and where to go next), turned down and why,
          a number granted, taken off a roster, a season of theirs finished —
          and every card can be replied to, which puts the answer in the admins'
          Approvals queue. Renders nothing at all until there's something to
          say. See components/MessageBoard.jsx. */}
      <MessageBoard />

      <div className="hero">
        <div className="page-title">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {titleLogo && <img src={titleLogo} alt="" className="avatar" style={{ borderRadius: 10 }} />}
            <h2>{title}</h2>
          </div>
          {data?.leader && leaderPoints != null && (
            <span className="page-badge">
              🏆 Leader: {data.leader.driver_name} · {leaderPoints} pts
            </span>
          )}
        </div>
        <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 620 }}>
          {contextLine}
          {data?.nextRace
            ? `Next up: ${data.nextRace.name} (${data.nextRace.track || "TBA"}) on ${formatRaceDate(data.nextRace.date, "numeric")}.`
            : "Live overview of your racing league."}
        </p>
        <div className="metrics">
          {metrics.map((m, i) => (
            <article className="metric-card" key={m.label} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="metric-icon">{m.icon}</span>
              <div className="metric-num">{m.num}</div>
              <div className="metric-label">{m.label}</div>
            </article>
          ))}
        </div>
      </div>

      {/* Series Information — car lock-ins and series sign-ups for the signed-in
          player. Deliberately here rather than in the sidebar: it renders
          nothing at all unless this player has a car to choose or a season to
          join (see components/SeriesInfoPanel.jsx). */}
      <SeriesInfoPanel />

      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Quick Access</h3>
      </div>
      <div className="quick-links">
        {quickLinks.map(card => (
          <Link href={card.href} key={card.label}>
            <div className="quick-card">
              <span className="quick-card-icon">{card.icon}</span>
              <strong>{card.label}</strong>
              <span>{card.sub}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
