"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { copyCurrentLink } from "@/lib/scopeLink";
import { useUserAccountsAlerts, alertsTitle } from "@/lib/userAccountsAlerts";
import {
  APPROVALS_MIN_LEVEL, pendingSignupsTitle, usePendingSignupCount,
} from "@/lib/pendingSignupAlerts";

// Re-exported for callers that used to import these from the shell; the alert
// plumbing itself now lives in lib/userAccountsAlerts so the Drivers page can
// badge its User Accounts tab from the same source.
export { USERS_SEEN_KEY, USERS_SEEN_EVENT } from "@/lib/userAccountsAlerts";

const publicNav = [
  { href: "/",          label: "Dashboard", icon: "◈" },
  { href: "/standings", label: "Standings", icon: "🏆" },
  { href: "/stats",     label: "Stats",     icon: "📊" },
  { href: "/records",   label: "Records",   icon: "🏅" },
  { href: "/skill-ratings", label: "Skill Ratings", icon: "📈" },
  { href: "/schedule",  label: "Schedule",  icon: "📅" },
  { href: "/calendar",  label: "Calendar",  icon: "🗓️" },
  { href: "/history",   label: "History",   icon: "📜" },
  { href: "/drivers",   label: "Drivers",   icon: "🏎" },
  { href: "/teams",     label: "Teams",     icon: "🛡" },
  { href: "/tracks",    label: "Tracks",    icon: "🏁" },
];

// Everything else an admin used to reach from here now lives as a tab on the
// page it belongs to: races are edited from the Schedule, and the roster, teams
// and user accounts are tabs on Drivers. Only the league hierarchy itself is
// admin-only enough to keep its own entry.
//
// Approvals is the exception that earned one: a player's sign-up sits waiting
// until somebody looks at it, so it needs a place that can carry a badge and be
// seen from every page. `minLevel` keeps it to the staff who actually work the
// queue — Moderator and up (see lib/pendingSignupAlerts.js).
const adminNav = [
  { href: "/admin",       label: "League Setup",   icon: "⚙", exact: true },
  { href: "/approvals",   label: "Approvals",      icon: "✅", minLevel: APPROVALS_MIN_LEVEL },
];

function NavLinks({ items, pathname, badges }) {
  return items.map((item) => {
    const isActive = item.href === "/" || item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href);
    const entry = badges?.[item.href];
    const badge = typeof entry === "number" ? entry : (entry?.count || 0);
    const badgeTitle = typeof entry === "number"
      ? `${badge} item${badge === 1 ? "" : "s"} need${badge === 1 ? "s" : ""} your attention`
      : entry?.title;
    return (
      <Link className={`nav-link${isActive ? " active" : ""}`} key={item.href} href={item.href}>
        <span className="nav-icon">{item.icon}</span>
        {item.label}
        {badge > 0 && (
          <span className="nav-badge" title={badgeTitle}>{badge > 99 ? "99+" : badge}</span>
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
  const {
    games, seriesList, seasons, classes,
    gameId, seriesId, seasonId, classId,
    setGameId, setSeriesId, setSeasonId, setClassId,
  } = league;

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
      {/* Class — the fourth tier. Always present beside Season, so the scope
          controls never shift around: "All Classes" is the combined,
          whole-field view and is always the first option, followed by the
          classes defined in the selected season. A season with no classes (or
          no season picked yet) simply sits on "All Classes" with nothing else
          to choose. A class that races its own car names it here ("Pro · GT3"),
          so which car goes with which class is readable straight from the menu. */}
      <div className="context-select">
        <label>Class</label>
        <select value={classId} onChange={e => setClassId(e.target.value)} disabled={!classes.length}>
          <option value="">All Classes</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.car ? `${c.name} · ${c.car}` : c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Copies the address of whatever is on screen. Because the scope selectors now
// write themselves into the URL (see lib/scopeLink.js), that address opens the
// exact page the sender was on — this season's standings, this class's stats,
// this race's results — instead of dropping the reader on the front page to
// hunt through the menus for it.
function CopyLinkButton() {
  const [state, setState] = useState("idle"); // idle | copied | failed

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    setState(await copyCurrentLink() ? "copied" : "failed");
  }

  return (
    <button
      className="btn btn-ghost copy-link-btn"
      onClick={copy}
      title="Copy a direct link to this page — it opens on the same league, game, series, season and class you're viewing"
    >
      {state === "copied" ? "✓ Link copied" : state === "failed" ? "Copy failed" : "🔗 Copy link"}
    </button>
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
  const { isAdmin, roleLevel } = useAuth();
  const league = useLeague();
  const userAccountsAlerts = useUserAccountsAlerts(isAdmin);
  // Sign-ups waiting on an approval. The hook makes no API call at all below
  // Moderator, so a player's browser never asks for a count it isn't allowed.
  const pendingSignups = usePendingSignupCount(roleLevel);
  // New signups / pending claims are handled on the Drivers page's User
  // Accounts tab, so the badge rides along with that nav item.
  const navBadges = {
    "/drivers": { count: userAccountsAlerts.total, title: alertsTitle(userAccountsAlerts) },
    "/approvals": { count: pendingSignups, title: pendingSignupsTitle(pendingSignups) },
  };
  // Admin entries the signed-in staff account is high enough to see.
  const adminItems = adminNav.filter(
    item => item.minLevel == null || roleLevel >= item.minLevel);

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
        <nav><NavLinks items={publicNav} pathname={pathname} badges={navBadges} /></nav>

        {isAdmin && (
          <>
            <span className="nav-section-label" style={{ marginTop: 16 }}>Admin</span>
            <nav><NavLinks items={adminItems} pathname={pathname} badges={navBadges} /></nav>
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
            <CopyLinkButton />
          </div>
          <UserChip />
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
