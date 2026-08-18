"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, sendEmailVerification, signOut as fbSignOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebaseClient";
import { api } from "@/lib/api";
import { LEAGUE_CHANGE_EVENT, getActiveLeagueId } from "@/lib/leagueClient";
import { roleLevel as levelOf } from "@/lib/roles";

const AuthContext = createContext({
  user: null, profile: null, isAdmin: false, role: "player", roleLevel: 0,
  leagueId: "", leagueRoles: {}, roleStale: false, isGlobalOwner: false,
  emailVerified: false, loading: true,
});

// ── Roles are answered PER LEAGUE ───────────────────────────────────────────
//
// `role`, `roleLevel` and `isAdmin` here describe the signed-in account IN THE
// ACTIVE LEAGUE. /api/users/me resolves them against the X-League-Id header
// api() stamps on every request and tells us which league it answered for
// (`profile.league_id`), so switching leagues genuinely changes what this
// context says — an Admin of League A reads as a plain player the moment the
// switcher moves to League B.
//
// AuthProvider sits ABOVE LeagueProvider in the tree (the league list is fetched
// with the user's token), so it can't learn about a switch through context. It
// listens for the event lib/leagueClient.js fires instead, and re-asks. In the
// gap between the switch and the answer, `roleStale` is true: the role on hand
// belongs to the league just left, and anything gating on it (AdminGate) must
// wait rather than act on it.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  // The league the profile on hand was resolved for, tracked separately so a
  // switch can invalidate it before the new answer lands.
  const [wantedLeagueId, setWantedLeagueId] = useState(() => getActiveLeagueId());

  const refreshProfile = useCallback(async () => {
    // What api() is about to send as X-League-Id. Recorded BEFORE the request so
    // the answer can be matched against the question that was actually asked —
    // see roleStale below.
    const asked = getActiveLeagueId();
    try {
      const next = await api("/api/users/me");
      setProfile(next);
      // Settle the wanted league on whatever the server answered FOR. Without
      // this the two could disagree forever — a browser that refuses
      // localStorage (Safari private mode) sends no header at all, so the
      // answer's league_id is "" while the switcher says otherwise, and
      // anything waiting for them to converge would wait for good.
      setWantedLeagueId(next?.league_id || asked || "");
    } catch (err) {
      // A REJECTION is an answer: an unverified account gets a 403, and the
      // VerifyGate takes over from a null profile. Anything else — a dropped
      // connection, a cold serverless start, a 500 — is not, and throwing away
      // a good profile for it is how an Owner ends up staring at "this page is
      // for league staff only" on their own league until they reload.
      if (err?.status === 401 || err?.status === 403) setProfile(null);
      else console.error("[auth] couldn't refresh the profile; keeping the last one", err);
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(clientAuth(), async (u) => {
      let current = u;
      // The cached user (and its ID token, good for an hour) still says
      // "unverified" after the emailed link is clicked — Firebase doesn't push
      // that change back to an open session. Re-pull the account and mint a
      // fresh token so a page load is enough to notice, which also lets the
      // /api/users/me call below create the user doc the admin roster reads.
      if (u && !u.emailVerified) {
        try {
          await u.reload();
          await u.getIdToken(true);
          current = clientAuth().currentUser || u;
        } catch { /* offline / token revoked — fall back to what we have */ }
      }
      setUser(current);
      setEmailVerified(!!current?.emailVerified);
      if (current) await refreshProfile();
      else setProfile(null);
      setLoading(false);
    });
  }, [refreshProfile]);

  // A league switch changes what this account IS. Re-ask, and mark the role on
  // hand stale until the answer arrives.
  useEffect(() => {
    function onLeagueChange(e) {
      const next = e?.detail?.leagueId ?? getActiveLeagueId();
      setWantedLeagueId(next);
      if (clientAuth().currentUser) refreshProfile();
    }
    window.addEventListener(LEAGUE_CHANGE_EVENT, onLeagueChange);
    return () => window.removeEventListener(LEAGUE_CHANGE_EVENT, onLeagueChange);
  }, [refreshProfile]);

  // Re-check verification after the user clicks the emailed link. onAuthStateChanged
  // doesn't fire for that, so we reload the user and force a token refresh so the
  // server also sees the updated email_verified claim.
  const refreshVerification = useCallback(async () => {
    const cur = clientAuth().currentUser;
    if (!cur) return false;
    await cur.reload();
    await cur.getIdToken(true);
    const verified = clientAuth().currentUser.emailVerified;
    setEmailVerified(verified);
    setUser(clientAuth().currentUser);
    if (verified) await refreshProfile();
    return verified;
  }, [refreshProfile]);

  const resendVerification = useCallback(async () => {
    const cur = clientAuth().currentUser;
    if (!cur) throw new Error("You're not signed in.");
    await sendEmailVerification(cur);
    try { sessionStorage.setItem("pr_verif_sent", "1"); } catch {}
  }, []);

  const signOut = useCallback(() => fbSignOut(clientAuth()), []);

  const role = profile?.role || "player";
  // The answer describes a different league than the one now active — a switch
  // is in flight. Only ever true for a signed-in account with a profile: a
  // signed-out visitor has no role to be stale.
  const roleStale = !!profile && (profile.league_id || "") !== (wantedLeagueId || "");
  return (
    <AuthContext.Provider value={{
      user, profile,
      isAdmin: !!profile?.is_admin,   // true for any staff role (owner→statistician) IN THIS LEAGUE
      role, roleLevel: profile?.role_level ?? levelOf(role),
      // Which league the three above are about, and every league this account
      // holds standing in ({ leagueId: role }).
      leagueId: profile?.league_id || "",
      leagueRoles: profile?.league_roles || {},
      // Owner of the APPLICATION rather than of the league on screen — the only
      // thing that may back up or restore every league's data at once.
      isGlobalOwner: !!profile?.global_owner,
      roleStale,
      emailVerified, loading,
      signOut, refreshProfile, refreshVerification, resendVerification,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
