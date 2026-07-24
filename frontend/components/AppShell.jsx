"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";

// localStorage key + custom event shared with the User Accounts page: it stamps
// "everything up to now has been seen" when the admin opens the dashboard, which
// clears the red new-signup badge in the sidebar.
export const USERS_SEEN_KEY = "pr_users_last_seen";
export const USERS_SEEN_EVENT = "pr-users-seen";

// Count of User Accounts items needing admin attention: accounts created since
// the admin last opened the dashboard PLUS pending driver-claim requests. Drives
// the red badge next to the nav item. The new-signup baseline is stamped to "now"
// on first ever load so an admin isn't greeted by their whole existing roster.
function useUserAccountsAlerts(isAdmin, pathname) {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!isAdmin) { setCount(0); return; }
    try {
      const [users, requests] = await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/claim-requests"),
      ]);
      if (Array.isArray(users) && !localStorage.getItem(USERS_SEEN_KEY)) {
        localStorage.setItem(USERS_SEEN_KEY, new Date().toISOString());
      }
      const seen = localStorage.getItem(USERS_SEEN_KEY) || "";
      const newAccounts = (Array.isArray(users) ? users : []).filter(u => (u.created_at || "") > seen).length;
      const pending = Array.isArray(requests) ? requests.length : 0;
      setCount(newAccounts + pending);
    } catch { /* leave count unchanged on transient errors */ }
  }, [isAdmin]);

  useEffect(() => {
    load();
    function onSeen() { load(); }
    window.addEventListener(USERS_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(USERS_SEEN_EVENT, onSeen);
  }, [load, pathname]);

  return count;
}

const publicNav = [
  { href: "/",          label: "Dashboard", icon: "◈" },
  { href: "/standings", label: "Standings", icon: "🏆" },
  { href: "/stats",     label: "Stats",     icon: "📊" },
  { href: "/records",   label: "Records",   icon: "🏅" },
  { href: "/skill-ratings", label: "Skill Ratings", icon: "📈" },
  { href: "/schedule",  label: "Schedule",  icon: "🗓" },
  { href: "/drivers",   label: "Drivers",   icon: "🏎" },
  { href: "/teams",     label: "Teams",     icon: "🛡" },
  { href: "/tracks",    label: "Tracks",    icon: "🏁" },
];

const adminNav = [
  { href: "/race-entry",  label: "Race Entry",     icon: "⏱" },
  { href: "/roster",      label: "Roster & Teams", icon: "⊞" },
  { href: "/admin/users", label: "User Accounts",  icon: "👥" },
  { href: "/admin",       label: "League Setup",   icon: "⚙", exact: true },
];

function NavLinks({ items, pathname, badges }) {
  return items.map((item) => {
    const isActive = item.href === "/" || item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href);
    const badge = badges?.[item.href] || 0;
    return (
      <Link className={`nav-link${isActive ? " active" : ""}`} key={item.href} href={item.href}>
        <span className="nav-icon">{item.icon}</span>
        {item.label}
        {badge > 0 && (
          <span className="nav-badge" title={`${badge} item${badge === 1 ? "" : "s"} need${badge === 1 ? "s" : ""} your attention`}>{badge}</span>
        )}
      </Link>
    );
  });
}

// Global League Switcher: swaps the active league, which re-renders the whole
// app for that league's games/series/seasons/drivers/stats. Hidden until at
// least one league exists (i.e. after the containment migration has run).
function LeagueSwitcher() {
  const league = useLeague();
  if (!league || !league.leagues?.length) return null;
  const { leagues, leagueId, switchLeague } = league;
  return (
    <div className="context-select league-switcher" title="Active league">
      <label>League</label>
      <select value={leagueId} onChange={e => switchLeague(e.target.value)}>
        {leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </div>
  );
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
  const userAccountsAlerts = useUserAccountsAlerts(isAdmin, pathname);
  const adminBadges = { "/admin/users": userAccountsAlerts };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-logo">
          <img src="/logo-mark.png" alt="Phoenix's Racing League Manager" className="sidebar-logo-img" />
          <div>
            <h1>{league?.league?.name || league?.series?.name || "Phoenix's Racing"}</h1>
            <p className="sidebar-tagline">{league?.series?.name || league?.season?.name || "League Manager"}</p>
          </div>
        </Link>

        <span className="nav-section-label">Navigation</span>
        <nav><NavLinks items={publicNav} pathname={pathname} /></nav>

        {isAdmin && (
          <>
            <span className="nav-section-label" style={{ marginTop: 16 }}>Admin</span>
            <nav><NavLinks items={adminNav} pathname={pathname} badges={adminBadges} /></nav>
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
          <div className="topbar-scope">
            <LeagueSwitcher />
            <ContextSelectors />
          </div>
          <UserChip />
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
