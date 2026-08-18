"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { adminGateVerdict } from "@/lib/leagueRoles";

// The gate is LEAGUE-AWARE, and that is the whole of its job now.
//
// Staff roles are held per league (see lib/leagueRoles.js), so "is this user an
// Admin?" is a question that can't be asked without naming a league. The role in
// useAuth() is already the ACTIVE league's — /api/users/me resolves it against
// the X-League-Id header and says which league it answered for — so the check
// below is contextual by construction: an Admin of League A standing on League
// B's setup page is refused, because in League B they are a player.
//
// The one thing that needs care is the GAP. Switching leagues re-asks the API,
// and until that answer lands the role on hand describes the league just left.
// Rendering an admin page from it, even for a moment, would be the exact leak
// this exists to stop — so a stale answer renders the loading state instead of a
// decision. That case has a verdict of its own ("stale") rather than being
// folded into "loading", so it can never be mistaken for a pass.
//
// `minLevel` narrows the gate past "any staff role" for the pages only the
// senior roles run — the approvals queue is Moderator and up, so a Statistician
// clears the baseline check but not this one. Omitted (the default) keeps the
// original behaviour: any staff role passes. The API routes behind these pages
// enforce the same floor against the same league themselves; this only decides
// what's worth rendering.
export function AdminGate({ children, minLevel = null }) {
  const { user, isAdmin, role, roleLevel, roleStale, leagueId: roleLeagueId, loading } = useAuth();
  const league = useLeague();

  const verdict = adminGateVerdict({
    loading,
    // `leagueReady` is false only while the provider is still resolving which
    // league is active; a page rendered outside the provider (there are none
    // today) reads as ready so the gate can't hang.
    leagueSettling: league ? !league.leagueReady : false,
    signedIn: !!user,
    isAdmin,
    roleLevel,
    roleStale,
    roleLeagueId,
    activeLeagueId: league?.leagueId ?? "",
    minLevel,
  });

  if (verdict === "loading" || verdict === "stale") {
    return <div className="skeleton" style={{ height: 160 }} />;
  }
  if (verdict === "signed-out") {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>Sign in with a league staff account to access this page.</p>
        <Link href="/login" className="btn btn-primary">Sign In</Link>
      </div>
    );
  }
  if (verdict === "below-min") {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>This page is for {leagueLabel(league)} Moderators and above.</p>
        <StandingNote league={league} role={role} />
      </div>
    );
  }
  if (verdict === "not-staff") {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>This page is for {leagueLabel(league)} staff only.</p>
        <StandingNote league={league} role={role} />
      </div>
    );
  }
  return children;
}

function leagueLabel(league) {
  const name = league?.league?.name;
  return name ? `${name}'s` : "this league's";
}

// Somebody who is staff in another league and not in this one has almost
// certainly used the switcher without meaning to, and "you're not staff" alone
// reads as a bug. Say which league they're actually looking at, so the fix is
// obvious.
function StandingNote({ league, role }) {
  const name = league?.league?.name;
  if (!name) return null;
  return (
    <p style={{ color: "var(--ink-2)", fontSize: "0.85rem", maxWidth: 460 }}>
      Roles are per league. You&apos;re currently viewing <strong>{name}</strong>
      {role === "player" ? " as a player" : ""} — switch leagues in the top bar if you meant
      a different one.
    </p>
  );
}
