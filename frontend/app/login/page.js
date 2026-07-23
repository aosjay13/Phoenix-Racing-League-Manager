"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { clientAuth } from "@/lib/firebaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(clientAuth(), form.email, form.password);
        if (form.name) await updateProfile(cred.user, { displayName: form.name });
      } else {
        await signInWithEmailAndPassword(clientAuth(), form.email, form.password);
      }
      router.push("/");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-wrap">
      <div className="form-card" style={{ margin: "0 auto" }}>
        <h3>{mode === "signup" ? "Create your driver account" : "Welcome back, driver"}</h3>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-1)" }}>
          {mode === "signup"
            ? "Join the league — your stats follow you across every game."
            : "Sign in to view your profile and league tools."}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div className="field">
              <label>Display Name</label>
              <input value={form.name} onChange={set("name")} placeholder="e.g. J. May" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" required minLength={6} value={form.password} onChange={set("password")} placeholder="••••••••" />
          </div>

          {error && <div className="toast toast-error">{error}</div>}

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "One moment…" : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
        </form>

        <p style={{ marginTop: 18, fontSize: "0.85rem", color: "var(--ink-1)" }}>
          {mode === "signup" ? "Already have an account?" : "New to the league?"}{" "}
          <button
            type="button"
            onClick={() => { setMode(m => (m === "signup" ? "signin" : "signup")); setError(null); }}
            style={{ background: "none", border: "none", color: "var(--accent-cyan)", cursor: "pointer", fontWeight: 600, padding: 0 }}
          >
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </section>
  );
}

function friendly(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email or password is incorrect.";
  if (code.includes("email-already-in-use")) return "An account with that email already exists.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  return err?.message || "Something went wrong. Try again.";
}
