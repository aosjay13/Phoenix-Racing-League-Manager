"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
} from "firebase/auth";
import { clientAuth, missingFirebaseConfig, usingAuthEmulator } from "@/lib/firebaseClient";
import { useLeague } from "@/components/LeagueProvider";
import { getActiveLeagueId } from "@/lib/leagueClient";
import { readScopeParams } from "@/lib/scopeLink";
import { api } from "@/lib/api";
import { friendlyAuthError, resetOutcome, signupLeagueId } from "@/lib/authFlows";

// Three states, one screen: sign in, create an account, and "I've forgotten my
// password". The third is a mode rather than a page of its own so the email
// already typed carries into it and back out again — forgetting a password is
// something you discover halfway through signing in, not a journey you set out
// on.
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
  const [form, setForm] = useState({ name: "", email: "", password: "" });
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
      const address = form.email.trim();
      // Logged on purpose, and kept. "Nothing happens" is a report that can mean
      // the handler never ran, the SDK never dispatched, or the email was sent
      // and went to spam — and from the outside those look identical. These two
      // lines tell them apart from the browser console, which is the only place
      // the answer exists for a deployed build.
      console.info("[reset] sending password reset email", {
        to: address,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "(missing)",
        missingConfig: missingFirebaseConfig(),
        emulator: usingAuthEmulator(),
      });
      try {
        await sendPasswordResetEmail(clientAuth(), address);
        console.info("[reset] Firebase accepted the request for", address);
        setNotice(resetOutcome(null).message);
      } catch (err) {
        // The exact code and message, both to the console and to the screen —
        // see resetOutcome. A mapped-to-prose failure is what made this
        // impossible to diagnose.
        console.error("[reset] sendPasswordResetEmail failed", err?.code, err);
        const outcome = resetOutcome(err);
        if (outcome.ok) setNotice(outcome.message);
        else setError(outcome.message);
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
              ? "Enter the email you sign in with and we'll send you a link to set a new password."
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
              <input type="password" required minLength={6} value={form.password} onChange={set("password")} placeholder="••••••••" />
            </div>
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
              : mode === RESET ? "Send Reset Link"
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
