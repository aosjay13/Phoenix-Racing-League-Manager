"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { clientAuth } from "@/lib/firebaseClient";
import { api } from "@/lib/api";

const AuthContext = createContext({ user: null, profile: null, isAdmin: false, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await api("/api/users/me"));
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(clientAuth(), async (u) => {
      setUser(u);
      if (u) await refreshProfile();
      else setProfile(null);
      setLoading(false);
    });
  }, [refreshProfile]);

  const signOut = useCallback(() => fbSignOut(clientAuth()), []);

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin: !!profile?.is_admin, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
