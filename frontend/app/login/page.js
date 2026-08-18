"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import { clientAuth, missingFirebaseConfig, usingAuthEmulator } from "@/lib/firebaseClient";
import { useLeague } from "@/components/LeagueProvider";
import { getActiveLeagueId } from "@/lib/leagueClient";
import { readScopeParams } from "@/lib/scopeLink";
import { api } from "@/lib/api";
import {
  MIN_PASSWORD_LENGTH, MIN_RECOVERY_LENGTH, directResetError, friendlyAuthError,
  signupLeagueId,
} from "@/lib/authFlows";

// Three states, one screen: sign in, create an account, and "I've forgotten my
// password". The third is a mode rather than a page of its own so the email
// already typed carries into it and back out again — forgetting a password is
// something you discover halfway through signing in, not a journey you set out
// on.
//
// ── The reset flow does not send anything ──────────────────────────────────
//
// It used to ask Firebase to email a link. That link never arrived on this
// installation, which made the most common support request in the league
// unanswerable from inside the app. So RESET now proves identity IN THE FORM —
// email plus the account's own recovery passphrase — and sets the new password
// on the spot (POST /api/auth/reset-password). Nothing is dispatched, nothing
// is clicked, nothing depends on an inbox.
//
// The passphrase is set beforehand on My Account. An account that never set one
// has no self-service route and must ask an Owner, which the form says plainly
// rather than leaving them guessing.
const SIGN_IN = "signin";
const SIGN_UP = "signup";
const RESET = "reset";

export default function LoginPage() {
  const router = useRouter();
  // Which league this browser is looking at. An account is global but standing
  // in a league is not (see lib/leagueRoles.js), so signing up has to say which
  // league the new account is joining — and the honest answer is the one on
  // screen. Read through the provider here and re-read at submit time, because
  // the league list resolves asynchronously and somebody can be quick.
  const league = useLeague();
  const [mode, setMode] = useState(SIGN_IN);
  const [form, setForm] = useState({
    name: "", email: "", password: "",
    // The reset flow's own three fields: the secret that proves who they are,
    // and the password they want instead.
    passphrase: "", newPassword: "", confirmPassword: "",
  });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  // The league to join, resolved at the moment of submission: an explicit
  // ?league= in the URL first (somebody followed a league's own sign-up link),
  // then the switcher's current answer, then the value api() is already sending
  // as X-League-Id. See signupLeagueId in lib/authFlows.js.
  function currentLeagueId() {
    return signupLeagueId({
      urlLeague: readScopeParams().league,
      activeLeague: league?.leagueId,
      storedLeague: getActiveLeagueId(),
    });
  }

  // Record the new account as a Player of the league it signed up in.
  //
  // This runs BEFORE email verification, which is the whole point: /api/users/me
  // refuses an unverified account, so without it a new player would be invisible
  // to the league whose page they joined from until they had been to their inbox
  // and come back. See app/api/users/join/route.js.
  //
  // It never fails the sign-up. The account exists either way, and the first
  // verified visit registers them anyway — this only makes it happen sooner.
  async function joinActiveLeague(leagueId) {
    try {
      await api("/api/users/join", { method: "POST", body: { league_id: leagueId || "" } });
    } catch (err) {
      console.error("Couldn't record the league this account signed up in", err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === RESET) {
      // Checked here as well as on the button's disabled state, from the same
      // function, so the two can never disagree about whether this is ready.
      const invalid = directResetError({
        email: form.email, passphrase: form.passphrase,
        next: form.newPassword, confirm: form.confirmPassword,
      });
      if (invalid) { setError(invalid); setBusy(false); return; }

      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email.trim(),
            passphrase: form.passphrase,
            new_password: form.newPassword,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || `Couldn't reset the password (${res.status}).`);
          return;
        }
        // Set on the Firebase account already — so rather than telling them to
        // go and sign in, sign them in. The whole point of this flow is that
        // there is no second step waiting in an inbox.
        try {
          await signInWithEmailAndPassword(clientAuth(), form.email.trim(), form.newPassword);
          await joinActiveLeague(currentLeagueId());
          router.push("/");
          return;
        } catch (err) {
          // The password IS changed even if signing in here didn't work, and
          // saying so matters — otherwise they try the whole flow again.
          console.error("[reset] signed-in-after-reset failed", err?.code, err);
          setNotice("Password changed. Sign in with your new password.");
          setMode(SIGN_IN);
          setForm(f => ({ ...f, password: "", passphrase: "", newPassword: "", confirmPassword: "" }));
          return;
        }
      } catch (err) {
        setError(`Couldn't reach the server: ${err?.message || "unknown error"}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const leagueId = currentLeagueId();
      if (mode === SIGN_UP) {
        const cred = await createUserWithEmailAndPassword(clientAuth(), form.email, form.password);
        if (form.name) await updateProfile(cred.user, { displayName: form.name });
        // Require email verification before the account can be used. Firebase
        // delivers this email; the global VerifyGate blocks the app until then.
        await sendEmailVerification(cred.user);
        try { sessionStorage.setItem("pr_verif_sent", "1"); } catch {}
        await joinActiveLeague(leagueId);
      } else {
        await signInWithEmailAndPassword(clientAuth(), form.email, form.password);
        // Signing in while looking at a league they haven't joined makes them a
        // Player of it, so nobody lands in a league they can see but has no
        // standing in. /api/users/me does the same on every verified load; doing
        // it here as well means it has already happened by the time the app
        // renders, and it works for an account that hasn't verified yet.
        await joinActiveLeague(leagueId);
      }
      router.push("/");
    } catch (err) {
      setError(friendlyAuthError(err, mode === SIGN_UP ? "signup" : "signin"));
    } finally {
      setBusy(false);
    }
  }

  const leagueName = league?.league?.name || "";
  // A build that shipped without its Firebase variables cannot sign anybody in
  // or send any email, and every symptom of that shows up as a failure of
  // whatever the visitor was trying to do. Say it here, once, plainly.
  const missingConfig = missingFirebaseConfig();

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto" }}>
        {missingConfig.length > 0 && (
          <div className="toast toast-error" style={{ marginBottom: 14 }}>
            <strong>This deployment isn&apos;t connected to Firebase.</strong>{" "}
            {missingConfig.join(", ")} {missingConfig.length === 1 ? "is" : "are"} missing from the
            build, so sign-in, sign-up and password reset will all fail. These are inlined at build
            time — set them and <strong>redeploy</strong>; restarting isn&apos;t enough.
          </div>
        )}
        {usingAuthEmulator() && (
          <div className="toast toast-success" style={{ marginBottom: 14 }}>
            Using the local Firebase Auth emulator. Reset and verification emails are printed to the
            emulator log and never actually delivered.
          </div>
        )}
        <h3>
          {mode === SIGN_UP ? "Create your driver account"
            : mode === RESET ? "Reset your password"
            : "Welcome back, driver"}
        </h3>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-1)" }}>
          {mode === SIGN_UP
            ? <>Join{leagueName ? <> <strong style={{ color: "var(--ink-0)" }}>{leagueName}</strong></> : " the league"} — your stats follow you across every game.</>
            : mode === RESET
              ? "No email needed. Confirm who you are with your recovery passphrase and set a new password right here."
              : "Sign in to view your profile and league tools."}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === SIGN_UP && (
            <div className="field">
              <label>Display Name</label>
              <input value={form.name} onChange={set("name")} placeholder="e.g. J. May" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />
          </div>
          {mode !== RESET && (
            <div className="field">
              <label>Password</label>
              <input type="password" required minLength={MIN_PASSWORD_LENGTH}
                autoComplete={mode === SIGN_UP ? "new-password" : "current-password"}
                value={form.password} onChange={set("password")} placeholder="••••••••" />
            </div>
          )}

          {mode === RESET && (
            <>
              <div className="field">
                <label>Recovery Passphrase</label>
                <input type="password" required autoComplete="off" value={form.passphrase}
                  onChange={set("passphrase")} placeholder="The phrase you set on My Account" />
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  The secret you saved under <strong>My Account ▸ Recovery Passphrase</strong> —
                  at least {MIN_RECOVERY_LENGTH} characters. Not your password, and not your
                  driver name.
                </span>
              </div>
              <div className="field">
                <label>New Password</label>
                <input type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                  value={form.newPassword} onChange={set("newPassword")}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
              </div>
              <div className="field">
                <label>Confirm New Password</label>
                <input type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                  value={form.confirmPassword} onChange={set("confirmPassword")} placeholder="••••••••" />
              </div>
            </>
          )}

          {/* Errors carry the raw Firebase code, so they get room to wrap
              rather than being clipped to one line. */}
          {error && <div className="toast toast-error" style={{ whiteSpace: "normal" }}>{error}</div>}
          {/* A reset that worked is the one message on this screen somebody has
              to actually notice — the alternative is pressing the button again
              and again while the mail sits in a spam folder. So it is a callout
              rather than the usual thin toast. */}
          {notice && (
            <div className="toast toast-success" style={{
              whiteSpace: "normal", padding: "14px 16px", fontSize: "0.95rem", lineHeight: 1.45,
            }}>
              <span style={{ fontSize: "1.2rem", marginRight: 8 }} aria-hidden="true">📬</span>
              {notice}
            </div>
          )}

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "One moment…"
              : mode === SIGN_UP ? "Create Account"
              : mode === RESET ? "Set New Password"
              : "Sign In"}
          </button>
        </form>

        {mode === SIGN_IN && (
          <p style={{ marginTop: 14, fontSize: "0.85rem" }}>
            <button type="button" onClick={() => switchMode(RESET)} className="link-button">
              Forgot your password?
            </button>
          </p>
        )}

        <p style={{ marginTop: 18, fontSize: "0.85rem", color: "var(--ink-1)" }}>
          {mode === RESET ? (
            <>
              Never set a recovery passphrase? Ask a league <strong>Owner</strong> to set a new
              password for you from <em>Admin ▸ User Accounts</em> — it takes effect immediately.
              <br />
              Remembered it?{" "}
              <button type="button" onClick={() => switchMode(SIGN_IN)} className="link-button">
                Back to sign in
              </button>
            </>
          ) : (
            <>
              {mode === SIGN_UP ? "Already have an account?" : "New to the league?"}{" "}
              <button
                type="button"
                onClick={() => switchMode(mode === SIGN_UP ? SIGN_IN : SIGN_UP)}
                className="link-button"
              >
                {mode === SIGN_UP ? "Sign in" : "Create an account"}
              </button>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
