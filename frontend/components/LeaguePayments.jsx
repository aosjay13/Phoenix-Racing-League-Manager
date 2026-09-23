"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PAY_PAID, PAY_USED, PROVIDER_COMP, canRevoke, formatPrice, methodLabel, statusLabel,
} from "@/lib/billing";

// League Payments: the application Owner's view of who has paid to start a
// league, in League Setup beside Backup & Restore (both are about the whole
// app rather than one league). See lib/billing.js for how paying works.
//
// Two tools besides the list:
//   • Give a free league. For somebody who paid by Cash App or Venmo directly,
//     a free first league, or a friend. It writes the same kind of credit a
//     payment does, so it is spent the same way.
//   • Revoke. Takes back a credit nobody has spent, after a refund. Refunds
//     themselves are done in Stripe or PayPal.
export function LeaguePayments() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api("/api/admin/league-payments")
    .then(d => { setData(d); setError(null); })
    .catch(err => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  function flash(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }

  async function grant(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const row = await api("/api/admin/league-payments", {
        method: "POST", body: { email: email.trim(), note: note.trim() },
      });
      setEmail(""); setNote("");
      await load();
      flash("success", `${row.email} can now start one league for free.`);
    } catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  async function revoke(row) {
    if (!window.confirm(`Take back the unspent league credit for ${row.email || "this account"}? `
      + "They won't be able to start a league with it. If they paid, refund them in Stripe or PayPal as well.")) return;
    try {
      await api(`/api/admin/league-payments/${row.id}`, { method: "PATCH", body: { action: "revoke" } });
      await load();
      flash("success", "Credit revoked.");
    } catch (err) { flash("error", err.message); }
  }

  const config = data?.config;
  const rows = (data?.payments || []).filter(r => r.status !== "pending" && r.status !== "expired");
  const earnedCents = rows
    .filter(r => r.provider !== PROVIDER_COMP && (r.status === PAY_PAID || r.status === PAY_USED))
    .reduce((sum, r) => sum + (Number(r.amount_cents) || 0), 0);

  return (
    <div style={{ marginBottom: 8 }}>
      <h3 className="setup-section-title">
        League Payments
        <span className="setup-section-hint">Who paid to start a league, and free leagues you&apos;ve given</span>
      </h3>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      {error && <div className="toast toast-error">{error}</div>}

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>How it&apos;s set up</h3>
          {!config ? <div className="skeleton" style={{ height: 120 }} /> : (
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-1)", fontSize: "0.88rem", lineHeight: 1.7 }}>
              <li>
                Price: <strong>{config.price_label || "not set"}</strong>
                {!config.price_label && " (set LEAGUE_PRICE_USD, or nobody else can start a league)"}
              </li>
              <li>
                Stripe (card, Apple Pay, Google Pay, Cash App Pay):{" "}
                <strong>{config.stripe ? "on" : "off"}</strong>
                {config.stripe && !config.stripe_webhook && " (webhook secret not set; payments still confirm when the buyer returns)"}
              </li>
              <li>
                PayPal (PayPal, Venmo): <strong>{config.paypal ? `on, ${config.paypal_env}` : "off"}</strong>
                {config.paypal_env === "sandbox" && " (test mode: no real money moves)"}
              </li>
              <li>You never pay. Leagues you start are always free.</li>
            </ul>
          )}
          {rows.length > 0 && (
            <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginBottom: 0 }}>
              {formatPrice(earnedCents)} taken through the app so far, before Stripe and PayPal fees.
            </p>
          )}
        </div>

        <div className="form-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>Give someone a free league</h3>
          <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: -4 }}>
            For someone who paid you directly by Cash App, Venmo or PayPal.me, or a league you want
            to give away. They need an account already; they&apos;ll see the league ready to create
            on the Start a League page.
          </p>
          <form onSubmit={grant}>
            <div className="field"><label htmlFor="comp-email">Their Account Email</label>
              <input id="comp-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="driver@example.com" />
            </div>
            <div className="field"><label htmlFor="comp-note">Note (optional)</label>
              <input id="comp-note" value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. Paid by Cash App on 9/23" maxLength={300} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Giving…" : "Give a Free League"}
            </button>
          </form>
        </div>
      </div>

      <div className="form-card" style={{ maxWidth: "100%", marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Payments</h3>
        {!data ? <div className="skeleton" style={{ height: 120 }} /> : rows.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: "0.88rem", margin: 0 }}>Nobody has paid for a league yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="stats-table" style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: "left" }}>Account</th>
                  <th>Amount</th><th>Paid With</th><th>Status</th>
                  <th style={{ textAlign: "left" }}>League</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.paid_at || r.created_at ? new Date(r.paid_at || r.created_at).toLocaleDateString() : ""}</td>
                    <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                      {r.email || r.uid}
                      {r.note && <div style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.note}</div>}
                    </td>
                    <td>{r.provider === PROVIDER_COMP ? "Free" : formatPrice(Number(r.amount_cents) || 0)}</td>
                    <td>{methodLabel(r)}</td>
                    <td>{statusLabel(r.status)}</td>
                    <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                      {r.league_id ? (r.league_name || "(deleted league)") : ""}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {canRevoke(r) && (
                        <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }}
                          title="Take back this unspent credit (after a refund)" onClick={() => revoke(r)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
