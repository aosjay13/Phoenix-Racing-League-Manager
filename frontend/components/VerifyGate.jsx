"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { friendlyAuthError, firebaseErrorDetail } from "@/lib/authFlows";
import { missingFirebaseConfig, usingAuthEmulator } from "@/lib/firebaseClient";

// Hard wall for signed-in accounts that haven't verified their email. It replaces
// the entire app UI, so an unverified account genuinely can't do anything until
// they click the emailed link.
//
// Two ways past it besides the link itself, and both exist because email is the
// one dependency this app cannot test for itself:
//
//   • Permanent env-var admins (profile.env_admin) are exempt, so the league
//     owner can never be locked out by their own mail provider.
//   • The whole requirement can be switched off for the installation
//     (lib/authSettings.js). This screen asks the server whether it still
//     applies before it blocks anybody — otherwise the switch would be
//     unreadable by exactly the accounts it exists to free.
//
// Until that answer arrives the wall is NOT shown. A blocked account seeing the
// app for a moment is a far smaller problem than every account being walled by a
// slow request, and the server refuses their API calls regardless.
export function VerifyGate({ children }) {
  const { user, profile, emailVerified, loading, signOut, resendVerification, refreshVerification } = useAuth();
  const [status, setStatus] = useState(null); // { type, msg }
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  // null = haven't asked yet. Treated as "don't block" while unknown.
  const [required, setRequired] = useState(null);
  const autoSent = useRef(false);

  // Asked once per mount, and re-asked when the tab comes back — an Owner who
  // flips the switch wants the people staring at this screen to be let in
  // without being told to hard-refresh.
  const loadSetting = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/settings", { cache: "no-store" });
      const data = await res.json();
      setRequired(data?.require_email_verification !== false);
    } catch {
      // Unreachable: assume the wall still stands rather than opening the app.
      setRequired(prev => (prev === null ? true : prev));
    }
  }, []);

  useEffect(() => { loadSetting(); }, [loadSetting]);

  const blocked = !!user && !emailVerified && !profile?.env_admin && required === true;

  // Send one verification email automatically when the wall first appears, unless
  // the signup flow already sent one this session (avoids double emails / rate limits).
  useEffect(() => {
    if (!blocked || autoSent.current) return;
    autoSent.current = true;
    let alreadySent = false;
    try { alreadySent = sessionStorage.getItem("pr_verif_sent") === "1"; } catch {}
    if (!alreadySent) {
      resendVerification()
        .then(() => setStatus({ type: "success", msg: "Verification email sent." }))
        .catch(err => {
          // Said out loud rather than swallowed. A silent failure here is what a
          // whole league being unable to get in looks like from the inside.
          console.error("[verify] sendEmailVerification failed", err?.code, err);
          setStatus({
            type: "error",
            msg: `Couldn't send the verification email: ${friendlyAuthError(err, "verify")} (${firebaseErrorDetail(err)})`,
          });
        });
    }
  }, [blocked, resendVerification]);

  // The link is very often opened somewhere else — a phone, another browser —
  // so this session is never told. Re-check whenever the tab comes back to the
  // foreground, and on a slow poll while it's visible, so the wall lifts on its
  // own instead of waiting for someone to press the button below. The setting is
  // re-read on the same beats, so an Owner switching it off frees this screen.
  useEffect(() => {
    if (!blocked) return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== "visible") return;
      loadSetting();
      try { await refreshVerification(); } catch { /* transient — the poll retries */ }
    }
    const timer = setInterval(check, 15000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [blocked, refreshVerification, loadSetting]);

  if (loading || !blocked) return children;

  async function resend() {
    setBusy(true);
    setStatus(null);
    try {
      await resendVerification();
      setStatus({ type: "success", msg: `Verification email sent to ${user.email}. Check your inbox and your spam/junk folder.` });
    } catch (err) {
      console.error("[verify] sendEmailVerification failed", err?.code, err);
      setStatus({
        type: "error",
        msg: `${friendlyAuthError(err, "verify")} (${firebaseErrorDetail(err)})`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function iVerified() {
    setChecking(true);
    setStatus(null);
    try {
      const ok = await refreshVerification();
      if (!ok) setStatus({ type: "error", msg: "Not verified yet — open the link in the email first, then click here again." });
    } catch {
      setStatus({ type: "error", msg: "Couldn't check right now. Try again in a moment." });
    } finally {
      setChecking(false);
    }
  }

  const missingConfig = missingFirebaseConfig();

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.4rem", lineHeight: 1 }}>📬</div>
        <h3 style={{ marginBottom: 4 }}>Verify your email to continue</h3>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-1)" }}>
          We sent a verification link to <strong style={{ color: "var(--ink-0)" }}>{user.email}</strong>.
          Click it to activate your account — check your <strong>spam/junk folder</strong> if it
          hasn&apos;t arrived.
        </p>

        {/* A build with no Firebase config cannot send anything, and every
            symptom of that shows up here as "the email never came". */}
        {missingConfig.length > 0 && (
          <div className="toast toast-error" style={{ marginTop: 14, whiteSpace: "normal" }}>
            <strong>This deployment isn&apos;t connected to Firebase.</strong>{" "}
            {missingConfig.join(", ")} missing from the build — no email can be sent until that is
            fixed and the app is <strong>redeployed</strong>.
          </div>
        )}
        {usingAuthEmulator() && (
          <div className="toast toast-error" style={{ marginTop: 14, whiteSpace: "normal" }}>
            Running against the Auth emulator — verification emails are printed to its log and never
            actually delivered. Open the emulator UI to find the link.
          </div>
        )}

        {status && <div className={`toast toast-${status.type}`} style={{ marginTop: 14, whiteSpace: "normal" }}>{status.msg}</div>}

        <button className="btn btn-primary" style={{ marginTop: 18 }} disabled={checking} onClick={iVerified}>
          {checking ? "Checking…" : "I've verified — continue"}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={resend}>
          {busy ? "Sending…" : "Resend verification email"}
        </button>

        {/* The way out when email itself is the thing that's broken. Both routes
            need somebody with access rather than an inbox, which is exactly the
            situation this paragraph is for. */}
        <p style={{ marginTop: 18, fontSize: "0.82rem", color: "var(--ink-2)", lineHeight: 1.6 }}>
          Email not arriving at all? A league <strong>Owner</strong> can mark your account verified
          from <em>Admin ▸ User Accounts</em> — ask them, and then press
          &ldquo;I&rsquo;ve verified&rdquo; above.
          <br />
          If <em>you</em> are the Owner and can&rsquo;t get in,{" "}
          <Link href="/recover" className="link-button">use the owner recovery code</Link>.
        </p>

        <p style={{ marginTop: 14, fontSize: "0.82rem", color: "var(--ink-2)" }}>
          Wrong account?{" "}
          <button type="button" onClick={signOut} className="link-button">Sign out</button>
        </p>
      </div>
    </section>
  );
}
