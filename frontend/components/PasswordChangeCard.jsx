"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { clientAuth } from "@/lib/firebaseClient";
import { useAuth } from "@/components/AuthProvider";
import {
  MIN_PASSWORD_LENGTH, friendlyAuthError, hasPasswordSignIn, isRecentLoginRequired,
  passwordChangeError,
} from "@/lib/authFlows";

const BLANK = { current: "", next: "", confirm: "" };

// Change your own password, while signed in.
//
// The current password is asked for UP FRONT rather than only when Firebase
// demands it, and that is the security decision here rather than an ergonomic
// one: an unattended session is the realistic threat, and a form that changes
// the password with nothing but the new one hands the account to whoever walks
// past the desk. Re-authenticating first also disposes of Firebase's
// `auth/requires-recent-login` before it can be hit — a session open longer than
// a few minutes trips it, which without this reads to the user as "the save
// failed for no reason".
//
// It is still caught below, because the two calls are not atomic: a session can
// go stale in the moment between them. If that happens the answer is the same
// thing the form already has — re-authenticate and try once more — so it says so
// rather than making them guess.
export function PasswordChangeCard() {
  const { user } = useAuth();
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const usesPassword = hasPasswordSignIn(user);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  function flash(type, msg) {
    setToast({ type, msg });
    if (type === "success") setTimeout(() => setToast(null), 6000);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // The same check the button's disabled state uses, so the two can never
    // disagree about whether this form is ready.
    const invalid = passwordChangeError(form);
    if (invalid) { flash("error", invalid); return; }

    const current = clientAuth().currentUser;
    if (!current?.email) { flash("error", "You're not signed in."); return; }

    setBusy(true);
    setToast(null);
    try {
      const credential = EmailAuthProvider.credential(current.email, form.current);
      await reauthenticateWithCredential(current, credential);
      await updatePassword(current, form.next);
      setForm(BLANK);
      flash("success", "Password changed. Use the new one next time you sign in.");
    } catch (err) {
      // Re-authentication went stale between the two calls. Nothing the person
      // did wrong, and the remedy is the form they are already looking at.
      flash("error", isRecentLoginRequired(err)
        ? "That took a little too long — re-enter your current password and try once more."
        : friendlyAuthError(err, "password"));
    } finally {
      setBusy(false);
    }
  }

  if (!usesPassword) {
    return (
      <div className="form-card">
        <h3 style={{ marginTop: 0 }}>Password</h3>
        <p style={{ margin: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
          This account signs in without a password, so there isn&apos;t one to change here.
        </p>
      </div>
    );
  }

  const invalid = passwordChangeError(form);

  return (
    <div className="form-card">
      <h3 style={{ marginTop: 0 }}>Change Password</h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 520 }}>
        Your current password is asked for first — so an account left signed in on a shared
        computer can&apos;t be taken over by somebody who simply walks up to it.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Current Password</label>
          <input type="password" autoComplete="current-password" required
            value={form.current} onChange={set("current")} placeholder="••••••••" />
        </div>
        <div className="field">
          <label>New Password</label>
          <input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
            value={form.next} onChange={set("next")} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
        </div>
        <div className="field">
          <label>Confirm New Password</label>
          <input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
            value={form.confirm} onChange={set("confirm")} placeholder="••••••••" />
        </div>

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy || !!invalid}>
          {busy ? "Changing…" : "Change Password"}
        </button>
      </form>
    </div>
  );
}
