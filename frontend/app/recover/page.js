"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// Owner recovery — the way back in when email itself is what's broken.
//
// Every other door into this app needs a working inbox: signing up needs a
// verification link, a forgotten password needs a reset link, and being let in
// by an Owner needs an Owner who is already in. This screen needs none of them.
// It takes the recovery code the operator set in their hosting environment
// (OWNER_RECOVERY_CODE) and, in one step, marks the named account verified and
// makes it an Owner.
//
// It is deliberately unlisted — no nav entry — and does nothing at all unless a
// code has been configured. See app/api/auth/recover/route.js.
export default function RecoverPage() {
  const [form, setForm] = useState({ email: "", code: "" });
  const [availability, setAvailability] = useState(null);  // null = still asking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/recover", { cache: "no-store" });
      setAvailability(await res.json());
    } catch {
      setAvailability({ available: false, configured: false, unreachable: true });
    }
  }, []);
  useEffect(() => { check(); }, [check]);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim(), code: form.code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Recovery failed (${res.status}).`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(`Couldn't reach the server: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto", maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>🛟 Owner Recovery</h3>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--ink-1)", lineHeight: 1.5 }}>
          For when email is down and nobody can get in. Enter the account&rsquo;s email address and
          the <strong>owner recovery code</strong> from your hosting environment. That account is
          marked verified and made an Owner — no inbox involved.
        </p>

        {availability && !availability.available && (
          <div className="toast toast-error" style={{ marginTop: 14, whiteSpace: "normal" }}>
            {availability.unreachable ? (
              <>Couldn&rsquo;t reach the server to check whether recovery is set up.</>
            ) : availability.configured ? (
              <>
                <strong>Recovery is disabled.</strong> <code>OWNER_RECOVERY_CODE</code> is set but is
                shorter than {availability.min_length} characters. Set a longer one and redeploy.
              </>
            ) : (
              <>
                <strong>Recovery isn&rsquo;t set up on this installation.</strong> Add{" "}
                <code>OWNER_RECOVERY_CODE</code> to your hosting environment (a long random string —
                at least {availability.min_length || 16} characters) and redeploy, then come back
                here. It is inlined nowhere and never leaves the server.
              </>
            )}
          </div>
        )}

        {result ? (
          <div style={{ marginTop: 16 }}>
            <div className="toast toast-success" style={{ whiteSpace: "normal", padding: "14px 16px", lineHeight: 1.5 }}>
              <strong>✅ {result.email} recovered.</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {(result.steps || []).map(step => <li key={step}>{step}</li>)}
              </ul>
            </div>
            <p style={{ marginTop: 14, fontSize: "0.85rem", color: "var(--ink-1)" }}>
              <Link href="/login" className="btn btn-primary" style={{ marginTop: 0 }}>Sign in now</Link>
            </p>
            <p style={{ marginTop: 14, fontSize: "0.82rem", color: "var(--accent-amber, #ffb224)", lineHeight: 1.5 }}>
              ⚠ {result.reminder}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Account Email</label>
              <input type="email" required autoComplete="username" value={form.email}
                onChange={set("email")} placeholder="you@example.com" />
            </div>
            <div className="field">
              <label>Owner Recovery Code</label>
              <input type="password" required autoComplete="off" value={form.code}
                onChange={set("code")} placeholder="The value of OWNER_RECOVERY_CODE" />
            </div>

            {error && <div className="toast toast-error" style={{ whiteSpace: "normal" }}>{error}</div>}

            <button className="btn btn-primary" type="submit"
              disabled={busy || (availability && !availability.available)}>
              {busy ? "Recovering…" : "Recover this account"}
            </button>
          </form>
        )}

        <p style={{ marginTop: 18, fontSize: "0.82rem", color: "var(--ink-2)", lineHeight: 1.6 }}>
          The account has to exist first — if you&rsquo;ve never signed up,{" "}
          <Link href="/login" className="link-button">create it</Link> and come back. Recovery works
          on an unverified account, so you don&rsquo;t need the email to arrive.
        </p>
      </div>
    </section>
  );
}
