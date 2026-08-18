"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MIN_RECOVERY_LENGTH, recoveryPassphraseError } from "@/lib/authFlows";

const BLANK = { passphrase: "", confirm: "" };

// My Account ▸ Recovery Passphrase — the thing that makes an email-free password
// reset possible for this account.
//
// Set one here, and "Forgot your password?" on the sign-in screen can prove it
// is you and set a new password on the spot, with nothing sent anywhere. Don't
// set one, and the only route back in is asking a league Owner — which works,
// but needs somebody else to be awake.
//
// It is a second password, and the card says so rather than dressing it up as a
// security question. Security questions ask for facts about a person, and facts
// about a person are exactly what a league like this one publishes: names,
// numbers, the teams they drive for. A passphrase is the only version of this
// that is actually a secret.
export function RecoveryPassphraseCard() {
  const [state, setState] = useState(null);      // null = still loading
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await api("/api/users/me/recovery"));
    } catch {
      setState({ configured: false, unavailable: true });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  function flash(type, msg) {
    setToast({ type, msg });
    if (type === "success") setTimeout(() => setToast(null), 6000);
  }

  async function save(e) {
    e.preventDefault();
    const invalid = recoveryPassphraseError(form);
    if (invalid) { flash("error", invalid); return; }
    setBusy(true);
    setToast(null);
    try {
      await api("/api/users/me/recovery", { method: "PUT", body: { passphrase: form.passphrase } });
      setForm(BLANK);
      setEditing(false);
      await load();
      flash("success", "Recovery passphrase saved. You can now reset your own password from the sign-in screen without any email.");
    } catch (err) {
      flash("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setToast(null);
    try {
      await api("/api/users/me/recovery", { method: "DELETE" });
      await load();
      flash("success", "Recovery passphrase removed. Resetting your own password now needs a league Owner.");
    } catch (err) {
      flash("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  const invalid = recoveryPassphraseError(form);
  const configured = !!state?.configured;

  return (
    <div className="form-card" style={{ maxWidth: "100%" }}>
      <h3 style={{ marginTop: 0 }}>Recovery Passphrase</h3>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 560, lineHeight: 1.5 }}>
        A second secret, used for one thing: proving it&apos;s you on the sign-in screen so you can
        set a new password yourself. <strong>No email involved</strong> — which matters, because an
        emailed reset link is only as reliable as the mail getting through.
      </p>

      {state === null ? (
        <div className="skeleton" style={{ height: 44 }} />
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: "0.88rem" }}>
            {configured ? (
              <>
                ✅ <strong>Set.</strong>{" "}
                {state.updated_at && (
                  <span style={{ color: "var(--ink-2)" }}>
                    Last changed {new Date(state.updated_at).toLocaleDateString()}.
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "var(--accent-amber, #ffb224)" }}>
                ⚠ Not set. If you forget your password you&apos;ll need a league Owner to set a new
                one for you.
              </span>
            )}
          </p>

          {editing ? (
            <form onSubmit={save}>
              <div className="field">
                <label>{configured ? "New Recovery Passphrase" : "Recovery Passphrase"}</label>
                <input type="password" autoComplete="off" required value={form.passphrase}
                  onChange={set("passphrase")}
                  placeholder={`At least ${MIN_RECOVERY_LENGTH} characters`} />
                <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  A short phrase you&apos;ll remember works well — three or four unrelated words.
                  Don&apos;t reuse your password, and don&apos;t use anything the league already
                  knows about you.
                </span>
              </div>
              <div className="field">
                <label>Confirm Passphrase</label>
                <input type="password" autoComplete="off" required value={form.confirm}
                  onChange={set("confirm")} placeholder="Type it again" />
              </div>

              {toast && <div className={`toast toast-${toast.type}`} style={{ whiteSpace: "normal" }}>{toast.msg}</div>}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" type="submit" disabled={busy || !!invalid}>
                  {busy ? "Saving…" : configured ? "Replace Passphrase" : "Save Passphrase"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy}
                  onClick={() => { setEditing(false); setForm(BLANK); setToast(null); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {toast && <div className={`toast toast-${toast.type}`} style={{ whiteSpace: "normal" }}>{toast.msg}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" style={{ marginTop: 0 }}
                  disabled={busy} onClick={() => { setEditing(true); setToast(null); }}>
                  {configured ? "Change Passphrase" : "Set a Recovery Passphrase"}
                </button>
                {configured && (
                  <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }}
                    disabled={busy} onClick={remove}>
                    {busy ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
