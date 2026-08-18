"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { friendlyAuthError } from "@/lib/authFlows";

// Hard wall for signed-in accounts that haven't verified their email. It replaces
// the entire app UI, so an unverified account genuinely can't do anything until
// they click the emailed link. Permanent env-var admins (profile.env_admin) are
// exempt so the league owner can never be locked out.
export function VerifyGate({ children }) {
  const { user, profile, emailVerified, loading, signOut, resendVerification, refreshVerification } = useAuth();
  const [status, setStatus] = useState(null); // { type, msg }
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const autoSent = useRef(false);

  const blocked = !!user && !emailVerified && !profile?.env_admin;

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
        .catch(() => { /* rate-limited etc. — the Resend button is available */ });
    }
  }, [blocked, resendVerification]);

  // The link is very often opened somewhere else — a phone, another browser —
  // so this session is never told. Re-check whenever the tab comes back to the
  // foreground, and on a slow poll while it's visible, so the wall lifts on its
  // own instead of waiting for someone to press the button below.
  useEffect(() => {
    if (!blocked) return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== "visible") return;
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
  }, [blocked, refreshVerification]);

  if (loading || !blocked) return children;

  async function resend() {
    setBusy(true);
    setStatus(null);
    try {
      await resendVerification();
      setStatus({ type: "success", msg: `Verification email sent to ${user.email}. Check your inbox (and spam).` });
    } catch (err) {
      setStatus({ type: "error", msg: friendlyAuthError(err, "verify") });
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

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.4rem", lineHeight: 1 }}>📬</div>
        <h3 style={{ marginBottom: 4 }}>Verify your email to continue</h3>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--ink-1)" }}>
          We sent a verification link to <strong style={{ color: "var(--ink-0)" }}>{user.email}</strong>.
          Click it to activate your account — you won't be able to use the league until you do.
        </p>

        {status && <div className={`toast toast-${status.type}`} style={{ marginTop: 14 }}>{status.msg}</div>}

        <button className="btn btn-primary" style={{ marginTop: 18 }} disabled={checking} onClick={iVerified}>
          {checking ? "Checking…" : "I've verified — continue"}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={resend}>
          {busy ? "Sending…" : "Resend verification email"}
        </button>

        <p style={{ marginTop: 18, fontSize: "0.82rem", color: "var(--ink-2)" }}>
          Wrong account?{" "}
          <button
            type="button"
            onClick={signOut}
            style={{ background: "none", border: "none", color: "var(--accent-cyan)", cursor: "pointer", fontWeight: 600, padding: 0 }}
          >
            Sign out
          </button>
        </p>
      </div>
    </section>
  );
}
