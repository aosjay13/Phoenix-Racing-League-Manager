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
import { clientAuth } from "@/lib/firebaseClient";
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
      // Never says whether the address has an account — see resetOutcome.
      try {
        await sendPasswordResetEmail(clientAuth(), form.email.trim());
        setNotice(resetOutcome(null).message);
      } catch (err) {
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

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto" }}>
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

          {error && <div className="toast toast-error">{error}</div>}
          {notice && <div className="toast toast-success">{notice}</div>}

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
