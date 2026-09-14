"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { landingRedirect } from "@/lib/leagueJoin";

// Where an account that belongs to NO league lands.
//
// Membership is no longer automatic — opening a league used to make you a player
// of it, which is exactly the bleed-over this app's isolation rules exist to
// stop (see lib/leagueJoin.js). The consequence is that a brand-new account
// genuinely belongs nowhere: every roster, standing and season in the app is
// some league's private business, and dropping somebody on the Dashboard shows
// them a league they can read and cannot take part in, with nothing on screen
// saying why or what to do about it.
//
// So they go to /leagues instead, which is the one page that is theirs to act
// on. It is a redirect rather than a wall: they can still navigate to a
// league's public pages and read them, and the pages an unaffiliated account
// legitimately needs (their own account and profile, sign-in, recovery) are
// exempt. The decision itself is pure and lives in landingRedirect, so its
// conditions are testable without a router.
//
// Nothing is rendered. This is a behaviour, mounted in the shell so it sees
// every navigation.
export function LeagueLandingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, loading } = useAuth();
  const league = useLeague();

  const target = landingRedirect({
    pathname,
    // Both answers have to have settled. Acting on a half-resolved profile
    // would bounce an ordinary member to the join page for a moment, which
    // reads as the app losing their league.
    loading: loading || !profile,
    signedIn: !!user,
    unaffiliated: !!profile?.unaffiliated,
    leagueReady: league ? !!league.leagueReady : true,
    leagueCount: league?.leagues?.length || 0,
  });

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return null;
}
