"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";

const publicNav = [
  { href: "/",          label: "Dashboard", icon: "◈" },
  { href: "/standings", label: "Standings", icon: "🏆" },
  { href: "/stats",     label: "Stats",     icon: "📊" },
  { href: "/schedule",  label: "Schedule",  icon: "🗓" },
  { href: "/drivers",   label: "Drivers",   icon: "🏎" },
  { href: "/teams",     label: "Teams",     icon: "🛡" },
  { href: "/tracks",    label: "Tracks",    icon: "🏁" },
];

const adminNav = [
  { href: "/race-entry", label: "Race Entry",     icon: "⏱" },
  { href: "/roster",     label: "Roster & Teams", icon: "⊞" },
  { href: "/admin",      label: "League Setup",   icon: "⚙" },
];

function NavLinks({ items, pathname }) {
  return items.map((item) => {
    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link className={`nav-link${isActive ? " active" : ""}`} key={item.href} href={item.href}>
        <span className="nav-icon">{item.icon}</span>
        {item.label}
      </Link>
    );
  });
}

function ContextSelectors() {
  const league = useLeague();
  if (!league || league.loading) return null;
  const { games, seriesList, seasons, gameId, seriesId, seasonId, setGameId, setSeriesId, setSeasonId } = league;

  return (
    <div className="context-bar">
      <div className="context-select">
        <label>Game</label>
        <select value={gameId} onChange={e => setGameId(e.target.value)}>
          <option value="">{games.length ? "All Games" : "No games yet"}</option>
          {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="context-select">
        <label>Series</label>
        <select value={seriesId} onChange={e => setSeriesId(e.target.value)} disabled={!gameId}>
          <option value="">{gameId ? "All Series" : "—"}</option>
          {seriesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="context-select">
        <label>Season</label>
        <select value={seasonId} onChange={e => setSeasonId(e.target.value)} disabled={!seriesId}>
          <option value="">{seriesId ? "All Seasons" : "—"}</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function UserChip() {
  const { user, profile, loading, signOut } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link href="/login" className="btn btn-primary" style={{ marginTop: 0, padding: "8px 14px" }}>
        Sign In
      </Link>
    );
  }
  const name = profile?.display_name || user.email;
  return (
    <div className="user-chip">
      <Link href="/profile" className="user-chip-main" title="Your profile">
        {profile?.photo_url
          ? <img src={profile.photo_url} alt="" className="avatar avatar-sm" />
          : <span className="avatar avatar-sm avatar-fallback">{String(name)[0]?.toUpperCase()}</span>}
        <span className="user-chip-name">{name}</span>
      </Link>
      <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 10px" }} onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const league = useLeague();

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-logo">
          <img src="/logo-mark.png" alt="Phoenix's Racing League Manager" className="sidebar-logo-img" />
          <div>
            <h1>{league?.series?.name || "Phoenix's Racing"}</h1>
            <p className="sidebar-tagline">{league?.season?.name || "League Manager"}</p>
          </div>
        </Link>

        <span className="nav-section-label">Navigation</span>
        <nav><NavLinks items={publicNav} pathname={pathname} /></nav>

        {isAdmin && (
          <>
            <span className="nav-section-label" style={{ marginTop: 16 }}>Admin</span>
            <nav><NavLinks items={adminNav} pathname={pathname} /></nav>
          </>
        )}

        <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--ink-2)", paddingLeft: 12 }}>
            {league?.game?.name || "Phoenix Racing League Manager"}
          </p>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <ContextSelectors />
          <UserChip />
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
