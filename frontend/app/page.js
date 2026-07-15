"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const { seasonId, season, series, game, loading } = useLeague();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!seasonId) { setData(null); return; }
    let live = true;
    Promise.all([
      api(`/api/standings?season_id=${seasonId}`),
      api(`/api/races?season_id=${seasonId}`),
    ]).then(([standings, races]) => {
      if (!live) return;
      const today = new Date();
      const completed = races.filter(r => r.date && new Date(r.date) < today).length;
      setData({
        leader: standings.drivers[0] ?? null,
        teamLeader: standings.teams[0] ?? null,
        driverCount: new Set(standings.drivers.map(d => d.entry_id)).size,
        totalRaces: races.length,
        completed,
        nextRace: races.filter(r => r.date && new Date(r.date) >= today)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0] ?? null,
      });
    }).catch(() => setData(null));
    return () => { live = false; };
  }, [seasonId]);

  if (loading) return <div className="skeleton" style={{ height: 200 }} />;

  if (!seasonId) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🏁</span>
        <p>No season selected yet.</p>
        {isAdmin
          ? <Link href="/admin" className="btn btn-primary">Set up your first game, series & season</Link>
          : <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>Ask a league admin to create a season.</p>}
      </div>
    );
  }

  const metrics = data ? [
    { icon: "🏎️", num: data.driverCount, label: "Drivers Scored" },
    { icon: "🗓️", num: data.totalRaces, label: "Scheduled Races" },
    { icon: "✅", num: data.completed, label: "Completed Events" },
    { icon: "⏩", num: Math.max(0, data.totalRaces - data.completed), label: "Races Remaining" },
  ] : [];

  const quickLinks = [
    { href: "/standings", icon: "🏆", label: "Standings", sub: "Driver & team points" },
    { href: "/schedule", icon: "🗓", label: "Schedule", sub: "Season calendar" },
    { href: "/drivers", icon: "🏎", label: "Drivers", sub: "Player profiles" },
    ...(isAdmin ? [{ href: "/race-entry", icon: "⏱", label: "Enter Results", sub: "Submit finish positions" }] : []),
  ];

  return (
    <section>
      <div className="hero">
        <div className="page-title">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {series?.logo_url && <img src={series.logo_url} alt="" className="avatar" style={{ borderRadius: 10 }} />}
            <h2>{series?.name ?? "Series"} · {season?.name ?? "Season"}</h2>
          </div>
          {data?.leader && (
            <span className="page-badge">
              🏆 Leader: {data.leader.driver_name} · {data.leader.adjusted_points} pts
            </span>
          )}
        </div>
        <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 620 }}>
          {game?.name ? `Racing on ${game.name}. ` : ""}
          {data?.nextRace
            ? `Next up: ${data.nextRace.name} (${data.nextRace.track || "TBA"}) on ${new Date(data.nextRace.date).toLocaleDateString()}.`
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

      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Quick Access</h3>
      </div>
      <div className="quick-links">
        {quickLinks.map(card => (
          <Link href={card.href} key={card.href}>
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
