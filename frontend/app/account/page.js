"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { PasswordChangeCard } from "@/components/PasswordChangeCard";
import { RecoveryPassphraseCard } from "@/components/RecoveryPassphraseCard";
import { ROLE_LABELS } from "@/lib/roles";

// My Account — the security and membership half of a player's own record, kept
// apart from My Profile (the half the league sees).
//
// The split is deliberate. /profile is about how you appear: your name, your
// picture, the number you race under. This is about the account itself: how you
// sign in, and which leagues you actually belong to. Mixing the two would put a
// password field on the page people open to change their bio.
export default function MyAccountPage() {
  const { user, profile, loading, emailVerified, leagueRoles, signOut } = useAuth();
  const league = useLeague();

  // Every league this account holds standing in, with the role it holds there.
  // Roles are per league (see lib/leagueRoles.js) and this is the one screen
  // that shows all of them at once — everywhere else answers for the league
  // you are currently looking at.
  const memberships = useMemo(() => {
    const names = Object.fromEntries((league?.leagues || []).map(l => [l.id, l.name]));
    return Object.entries(leagueRoles || {})
      .map(([id, role]) => ({ id, role, name: names[id] || null }))
      // A league whose document has since been deleted leaves its key behind
      // (deleting a league never rewrites everybody's account). Those are shown
      // last and labelled, rather than hidden — the standing is real data.
      .sort((a, b) => String(a.name || "￿").localeCompare(String(b.name || "￿")));
  }, [leagueRoles, league?.leagues]);

  if (loading) return <div className="skeleton" style={{ height: 240 }} />;
  if (!user) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔐</span>
        <p>Sign in to manage your account.</p>
        <Link href="/login" className="btn btn-primary">Sign In</Link>
      </div>
    );
  }

  return (
    <section>
      <div className="page-title">
        <h2>My Account</h2>
        <Link href="/profile" className="page-badge">Edit your profile →</Link>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 640 }}>
        How you sign in, and which leagues this account belongs to. Your public driver
        details — name, picture, car number — live on <Link href="/profile">My Profile</Link>.
      </p>

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>Sign-in</h3>
          <div className="field">
            <label>Email</label>
            <input value={user.email || ""} disabled readOnly />
          </div>
          <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {emailVerified || profile?.env_admin
              ? <>✅ Verified.</>
              : <>⚠️ Not verified yet — check your inbox for the link.</>}
            {profile?.env_admin && " This account is a permanent Owner (set via ADMIN_EMAILS)."}
          </p>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--ink-2)" }}>
            Signed in on this device.{" "}
            <button type="button" onClick={signOut} className="link-button">Sign out</button>
          </p>
        </div>

        <PasswordChangeCard />
      </div>

      {/* The email-free way back in. Set here, used on the sign-in screen's
          "Forgot your password?" — see components/RecoveryPassphraseCard.jsx. */}
      <div style={{ marginTop: 16 }}>
        <RecoveryPassphraseCard />
      </div>

      <div className="form-card" style={{ marginTop: 16, maxWidth: "100%" }}>
        <h3 style={{ marginTop: 0 }}>Your Leagues</h3>
        <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 640 }}>
          One account, one standing per league. You can be an Admin in one and a Player in
          another, and you race under a separate driver profile in each. Switch between them
          with the League menu in the top bar.
        </p>
        {memberships.length === 0 ? (
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.88rem" }}>
            You aren&apos;t recorded in any league yet. Opening one signs you up as a player of it.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {memberships.map(m => (
              <li key={m.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "10px 12px", borderRadius: 10, background: "var(--card-hover)",
              }}>
                <span style={{ fontWeight: 600 }}>
                  {m.name || <span style={{ color: "var(--ink-2)", fontWeight: 400 }}>A league that no longer exists</span>}
                  {m.id === league?.leagueId && (
                    <span className="page-badge" style={{ marginLeft: 8 }}>Viewing</span>
                  )}
                </span>
                <span style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>
                  {ROLE_LABELS[m.role] || "Player"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
