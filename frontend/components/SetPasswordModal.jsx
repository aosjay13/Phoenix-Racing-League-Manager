"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { MIN_PASSWORD_LENGTH, adminSetPasswordError, suggestPassword } from "@/lib/authFlows";

// Admin ▸ User Accounts ▸ Set Password — an Owner setting a player's password
// directly, with no email anywhere.
//
// The Admin SDK writes the credential itself (see the route), so this takes
// effect the moment it returns. That is the whole point: "I can't get in" is the
// most common thing a league Owner is asked, and on an installation where the
// emailed reset never arrives it was previously unanswerable from inside the
// app.
//
// Two pieces of care in the UI rather than the route:
//
//   • The password is SHOWN, deliberately. An Owner has to read it out or paste
//     it into a Discord message, and a masked field they can't check is how a
//     typo becomes a second support request. There is a generator so the
//     obvious shortcut ("password123") isn't the easy one.
//   • Nothing is dismissed automatically after success. The Owner still has to
//     copy the password somewhere; closing the dialog out from under them would
//     lose the one thing they came for.
export function SetPasswordModal({ user, onClose, onDone }) {
  const [form, setForm] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  function generate() {
    const value = suggestPassword();
    setForm({ next: value, confirm: value });
    setError(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(form.next);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    const invalid = adminSetPasswordError(form);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/users/${user.uid}/password`, {
        method: "POST", body: { password: form.next },
      });
      setDone(true);
      onDone?.(user, form.next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const who = user.display_name || user.email || "this account";
  const invalid = adminSetPasswordError(form);

  return (
    <Modal title={`Set password for ${who}`} onClose={busy ? () => {} : onClose}>
      {done ? (
        <div>
          <div className="toast toast-success" style={{ whiteSpace: "normal", lineHeight: 1.5 }}>
            <strong>✅ Password changed.</strong> {who} can sign in with it right now — nothing was
            emailed and there is no link to wait for. Their role, driver profile and race history
            are untouched.
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Give them this password</label>
            <input readOnly value={form.next} onFocus={e => e.target.select()}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
          </div>
          <p style={{ margin: "0 0 14px", fontSize: "0.82rem", color: "var(--ink-2)" }}>
            Send it over a private channel, and tell them to change it from{" "}
            <strong>My Account</strong> once they&apos;re in.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} onClick={copy}>
              {copied ? "✓ Copied" : "Copy password"}
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p style={{ margin: "10px 0 14px", color: "var(--ink-1)", fontSize: "0.88rem", lineHeight: 1.5 }}>
            Sets {who}&apos;s password immediately. Nothing is emailed. Their league role, linked
            driver profile and results are not touched — only the sign-in credential.
          </p>
          <div className="field">
            <label>New Password</label>
            <input type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off"
              value={form.next} onChange={set("next")}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              Shown rather than masked — you have to be able to read it back to them.
            </span>
          </div>
          <div className="field">
            <label>Confirm Password</label>
            <input type="text" required minLength={MIN_PASSWORD_LENGTH} autoComplete="off"
              value={form.confirm} onChange={set("confirm")} placeholder="Type it again"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
          </div>

          {error && <div className="toast toast-error" style={{ whiteSpace: "normal" }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" style={{ marginTop: 0 }}
              disabled={busy || !!invalid}>
              {busy ? "Setting…" : "Set Password"}
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }}
              disabled={busy} onClick={generate}>
              🎲 Generate one
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }}
              disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
