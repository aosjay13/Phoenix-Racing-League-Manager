"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, sendEmailVerification, signOut as fbSignOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebaseClient";
import { api } from "@/lib/api";
import { roleLevel as levelOf } from "@/lib/roles";

const AuthContext = createContext({ user: null, profile: null, isAdmin: false, role: "player", roleLevel: 0, emailVerified: false, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await api("/api/users/me"));
    } catch {
      // Unverified accounts are rejected by the API (403) — profile stays null
      // and the VerifyGate takes over.
      setProfile(null);
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
  return (
    <AuthContext.Provider value={{
      user, profile,
      isAdmin: !!profile?.is_admin,   // true for any staff role (owner→statistician)
      role, roleLevel: profile?.role_level ?? levelOf(role),
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
