"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { useMySignups } from "@/components/MySignupsProvider";
import { useMessages } from "@/components/MessagesProvider";
import { useAdminMessages } from "@/lib/messageAlerts";
import {
  adminInboxTitle, adminThreadsNeedingReply, playerInboxTitle, unreadPlayerMessages,
} from "@/lib/messages";
import { additionsTitle } from "@/lib/rosterAdditions";
import { useRosterAdditions } from "@/lib/rosterAlerts";
import { copyCurrentLink } from "@/lib/scopeLink";
import { signupBadgeCount, signupBadgeTitle } from "@/lib/signupFlow";
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
  // Joining a series — the one thing a brand-new player comes here to do, so it
  // sits second, above every table they might read. It's a top-level menu of
  // its own rather than a section of a page because somebody who has never used
  // the app before shouldn't have to know that "sign-ups" live under anything.
  // Its badge counts what is waiting on THEM (see lib/signupFlow.js).
  { href: "/signups",   label: "Sign-ups",  title: "Join a series", icon: "📝" },
  { href: "/standings", label: "Standings", icon: "🏆" },
  { href: "/stats",     label: "Stats",     icon: "📊" },
  { href: "/records",   label: "Records",   icon: "🏅" },
  { href: "/skill-ratings", label: "Skill Ratings", icon: "📈" },
  // Hot-lapping, time attack and division placements. It sits with the racing
  // pages rather than under Admin because the sheets themselves are public —
  // only creating and entering one is an admin job. See app/time-trials.
  //
  // Shortened here on purpose: the sidebar is a narrow column of one-word
  // labels, and "Time Trials & Placements" was long enough to wrap and unsettle
  // the column. The screen it opens still carries the full name, and `title`
  // keeps it a hover away from the link itself.
  { href: "/time-trials", label: "Time Trials", title: "Time Trials & Placements", icon: "⏱" },
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
  // Who's on which roster, and everything done to it. It was a tab on Drivers
  // ("Roster & Teams") that you had to know was there; it's a menu of its own
  // because it's a job rather than a view, and because it carries a badge —
  // approving a sign-up puts a driver on a roster the admin may not be looking
  // at, which used to happen entirely silently (see lib/rosterAdditions.js).
  { href: "/roster",      label: "Driver Roster",  title: "Season rosters, car numbers, teams & sign-ups", icon: "⊞" },
  // Who can get in, and as what. It was a tab on the Drivers page, which put
  // the screen an admin reaches for when somebody CAN'T GET IN two clicks deep
  // behind a page about the public driver directory. Roles, driver links,
  // pending claims, password resets and marking an account verified all live
  // here — that is a job, not a view, and it carries the new-signup badge.
  { href: "/accounts",    label: "User Accounts",  title: "Roles, driver links, verification & password resets", icon: "👥" },
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
      <Link className={`nav-link${isActive ? " active" : ""}`} key={item.href} href={item.href}
        title={item.title}>
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
      {/* Account settings — how you sign in, your password, the leagues you
          belong to. Separate from the profile link beside it, which is about
          how the league sees you. */}
      <Link href="/account" className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 10px" }}
        title="Account settings and password">
        Account
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
  // The player's own side of the same queue: series they could join, and cars
  // they still have to choose. Nothing is fetched for a signed-out visitor.
  const { data: mySignups } = useMySignups();
  // Drivers approved onto a roster since this admin last read the panel. Unlike
  // Approvals — an outstanding job that falls when somebody does it — this is
  // news, so it clears by being read. See lib/rosterAlerts.js.
  const rosterAdditions = useRosterAdditions(isAdmin);
  // The two halves of the message board. Players read theirs on the Dashboard,
  // so that's where their badge goes; a player's reply is a job for the staff
  // who work the queue, so it joins the Approvals count.
  const { rows: myMessages } = useMessages();
  const unreadMessages = unreadPlayerMessages(myMessages);
  const { rows: leagueMessages } = useAdminMessages(roleLevel);
  const messageReplies = adminThreadsNeedingReply(leagueMessages);
  // New signups / pending claims are handled on the Drivers page's User
  // Accounts tab, so the badge rides along with that nav item.
  const navBadges = {
    "/": { count: unreadMessages.length, title: playerInboxTitle(unreadMessages) },
    // The new-signups / pending-claims badge belongs on the screen that
    // actions them, which is now its own Admin entry rather than a Drivers tab.
    "/accounts": { count: userAccountsAlerts.total, title: alertsTitle(userAccountsAlerts) },
    // One badge, two kinds of waiting: undecided requests and unanswered
    // replies. Both are people waiting on an admin, and splitting them across
    // two numbers on one link would only make the link harder to read.
    "/approvals": {
      count: pendingSignups + messageReplies.length,
      title: [pendingSignupsTitle(pendingSignups), adminInboxTitle(messageReplies)].join(" · "),
    },
    "/signups": { count: signupBadgeCount(mySignups), title: signupBadgeTitle(mySignups) },
    "/roster": { count: rosterAdditions.length, title: additionsTitle(rosterAdditions) },
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
