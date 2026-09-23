"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { setActiveLeagueId } from "@/lib/leagueClient";
import { formatPrice, methodLabel, statusLabel } from "@/lib/billing";

// ── Start a League ─────────────────────────────────────────────────────────
//
// Two steps: pay, then name the league. They are separate on purpose (see
// lib/billing.js). A payment becomes a league credit on the server, and
// creating the league spends it, so somebody who pays and wanders off hasn't
// lost anything. The name they typed rides along in sessionStorage so the trip
// out to Stripe and back doesn't cost them that either.
//
// Nothing on this page decides who has paid. It asks GET /api/billing, and
// POST /api/leagues refuses a non-Owner without a credit whatever this page
// renders.
//
// The application Owner skips step one entirely: starting a league is free for
// them, the same as it always was.

const DRAFT_KEY = "prlm-new-league-draft";

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch { return {}; }
}
function writeDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

export default function StartLeaguePage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // The first run restores the draft and saves nothing, so the empty fields of
  // the first render can't overwrite what was typed before the checkout. Every
  // run after that saves.
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (!draftLoaded.current) {
      draftLoaded.current = true;
      const d = readDraft();
      if (d.name) setName(d.name);
      if (d.description) setDescription(d.description);
      return;
    }
    writeDraft({ name, description });
  }, [name, description]);

  const load = useCallback(() => api("/api/billing")
    .then(s => { setStatus(s); setLoadError(null); })
    .catch(err => setLoadError(err.message)), []);

  // Back from Stripe: confirm the payment with the server before anything else
  // loads, so the page opens on "paid" rather than flickering through "pay".
  // The query string is then tidied away so a reload doesn't confirm again.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const checkout = params.get("checkout");
      const sessionId = params.get("session_id");
      if (checkout === "stripe" && sessionId) {
        try {
          const r = await api("/api/billing/stripe/confirm", { method: "POST", body: { session_id: sessionId } });
          if (!cancelled) {
            setNotice(r.ok
              ? { type: "success", msg: "Payment received. Name your league below and it's yours." }
              : { type: r.pending ? "success" : "error", msg: r.error });
          }
        } catch (err) {
          if (!cancelled) setNotice({ type: "error", msg: err.message });
        }
      } else if (checkout === "cancelled") {
        setNotice({ type: "error", msg: "Checkout cancelled. You weren't charged." });
      }
      if (checkout) {
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState(null, "", url.toString());
      }
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
  }, [user, load]);

  async function createLeague(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await api("/api/leagues", {
        method: "POST",
        body: { name: name.trim(), description: description.trim() || null },
      });
      clearDraft();
      // Open League Setup in the new league with a full page load. A
      // client-side router.push here races LeagueProvider re-stamping the
      // address bar for the league switch (history.replaceState), and loses:
      // the push is dropped and the page just sits here. A fresh load also
      // starts every provider in the new league, where this account is Owner.
      setActiveLeagueId(created.id);
      window.location.assign(`/admin?league=${encodeURIComponent(created.id)}`);
    } catch (err) {
      setNotice({ type: "error", msg: err.message });
      if (err?.data?.code === "payment-required") await load();
      setBusy(false);
    }
  }

  const paid = useCallback(async (msg) => {
    setNotice({ type: "success", msg: msg || "Payment received. Name your league below and it's yours." });
    await load();
  }, [load]);

  if (loading) return <div className="skeleton" style={{ height: 260 }} />;

  if (!user) {
    return (
      <section>
        <div className="page-title"><h2>Start a League</h2></div>
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>Sign in to start your own league.</p>
          <Link href="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </section>
    );
  }

  const mode = status?.mode;
  const price = status?.price_label || (status?.price_cents ? formatPrice(status.price_cents) : "");
  const canCreate = mode === "free" || mode === "credit";

  return (
    <section>
      <div className="page-title">
        <h2>Start a League</h2>
        <Link href="/leagues" className="page-badge">← All leagues</Link>
      </div>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        Your own league, completely separate from every other league here: its own games, series,
        seasons, drivers, standings and staff. You&rsquo;ll be its <strong>Owner</strong>, and you
        decide who else gets in. Joining and racing in leagues is always free.
        {mode === "pay" || mode === "credit"
          ? <> Starting one is a one-time <strong>{price}</strong>.</>
          : null}
      </p>

      {notice && <div className={`toast toast-${notice.type}`} style={{ maxWidth: 760 }}>{notice.msg}</div>}
      {loadError && <div className="toast toast-error" style={{ maxWidth: 760 }}>{loadError}</div>}

      {!status && !loadError && <div className="skeleton" style={{ height: 220, marginTop: 14 }} />}

      {(mode === "closed" || mode === "not-ready") && (
        <div className="form-card" style={{ marginTop: 14 }}>
          <h3>Not open yet</h3>
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", marginBottom: 0 }}>
            This site isn&rsquo;t taking new leagues right now. If you&rsquo;d like to run one here,
            ask the site owner.
          </p>
        </div>
      )}

      {mode === "pay" && (
        <div className="form-card" style={{ marginTop: 14 }}>
          <h3>Step 1 · Pay {price}</h3>
          <p style={{ color: "var(--ink-2)", fontSize: "0.85rem", marginTop: 0 }}>
            One payment, one league, no subscription. The payment is checked with Stripe or PayPal
            before your league unlocks.
          </p>
          {status.stripe && <StripeButton price={price} onError={msg => setNotice({ type: "error", msg })} />}
          {status.stripe && status.paypal && (
            <p style={{ textAlign: "center", color: "var(--ink-2)", fontSize: "0.8rem", margin: "14px 0" }}>or</p>
          )}
          {status.paypal && (
            <PayPalButtons sdkUrl={status.paypal.sdk_url} onPaid={paid}
              onNotice={(type, msg) => setNotice({ type, msg })} />
          )}
        </div>
      )}

      {(mode === "pay" || canCreate) && (
        <div className="form-card" style={{ marginTop: 14, opacity: canCreate ? 1 : 0.6 }}>
          <h3>{mode === "free" ? "Name your league" : "Step 2 · Name your league"}</h3>
          <p style={{ color: "var(--ink-2)", fontSize: "0.85rem", marginTop: 0 }}>
            {mode === "free" && "Free for you as the application Owner."}
            {mode === "credit" && (
              status.credits > 1
                ? `Paid. You have ${status.credits} leagues ready to create.`
                : "Paid. Your league is ready to create."
            )}
            {mode === "pay" && "Unlocks once your payment goes through. What you type here is kept."}
          </p>
          <form onSubmit={createLeague}>
            <div className="field"><label htmlFor="new-league-name">League Name</label>
              <input id="new-league-name" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Apex Touring Car Club" maxLength={80} />
            </div>
            <div className="field"><label htmlFor="new-league-desc">Short Description (optional)</label>
              <input id="new-league-desc" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="What you race, and when" maxLength={200} />
            </div>
            <p style={{ color: "var(--ink-2)", fontSize: "0.8rem" }}>
              You can change the name and add a logo afterward under League Setup.
            </p>
            <button className="btn btn-primary" type="submit" disabled={!canCreate || busy || !name.trim()}>
              {busy ? "Creating…" : "Create League"}
            </button>
          </form>
        </div>
      )}

      {status?.payments?.length > 0 && <MyPayments rows={status.payments} />}
    </section>
  );
}

// Card, Apple Pay, Google Pay and Cash App Pay all live behind Stripe
// Checkout, on Stripe's own page. Which of them show is set in the Stripe
// Dashboard; see "Paying to start a league" in README.md.
function StripeButton({ price, onError }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { url } = await api("/api/billing/stripe/checkout", { method: "POST" });
      window.location.assign(url);
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="btn btn-primary" style={{ width: "100%", maxWidth: 360 }}
        disabled={busy} onClick={go}>
        {busy ? "Opening checkout…" : `Pay ${price} with card or Cash App`}
      </button>
      <p style={{ color: "var(--ink-2)", fontSize: "0.78rem", margin: "6px 0 0" }}>
        Card, Apple Pay, Google Pay or Cash App Pay, on Stripe&rsquo;s secure checkout.
      </p>
    </div>
  );
}

// One <script> per SDK URL for the life of the page, however many times the
// buttons mount (React's strict mode mounts them twice in development).
const scriptLoads = new Map();
function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { scriptLoads.delete(src); reject(new Error("PayPal didn't load")); };
      document.head.appendChild(el);
    }));
  }
  return scriptLoads.get(src);
}

// PayPal's own buttons: PayPal, Venmo (for US buyers on a device where Venmo
// is available) and Pay Later. The order is created and captured by this
// site's server, never in the browser. See app/api/billing/paypal.
function PayPalButtons({ sdkUrl, onPaid, onNotice }) {
  const ref = useRef(null);
  const [state, setState] = useState("loading");
  // The latest callbacks, read by the buttons without re-rendering them.
  const cb = useRef({ onPaid, onNotice });
  useEffect(() => { cb.current = { onPaid, onNotice }; }, [onPaid, onNotice]);

  useEffect(() => {
    let cancelled = false;
    let buttons = null;
    loadScript(sdkUrl).then(() => {
      if (cancelled || !ref.current || !window.paypal?.Buttons) return;
      buttons = window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        createOrder: async () => {
          const { id } = await api("/api/billing/paypal/order", { method: "POST" });
          return id;
        },
        onApprove: async (data) => {
          try {
            const r = await api("/api/billing/paypal/capture", { method: "POST", body: { order_id: data.orderID } });
            if (r.ok) cb.current.onPaid();
            else cb.current.onNotice(r.pending ? "success" : "error", r.error);
          } catch (err) {
            cb.current.onNotice("error", err.message);
          }
        },
        onCancel: () => cb.current.onNotice("error", "PayPal checkout cancelled. You weren't charged."),
        onError: (err) => cb.current.onNotice("error",
          err?.message || "PayPal ran into a problem. You weren't charged; try again."),
      });
      buttons.render(ref.current).then(() => { if (!cancelled) setState("ready"); })
        .catch(() => { if (!cancelled) setState("failed"); });
    }).catch(() => { if (!cancelled) setState("failed"); });
    return () => {
      cancelled = true;
      try { buttons?.close?.(); } catch {}
    };
  }, [sdkUrl]);

  return (
    <div style={{ maxWidth: 360 }}>
      {state === "loading" && <div className="skeleton" style={{ height: 96 }} />}
      {state === "failed" && (
        <p style={{ color: "var(--ink-2)", fontSize: "0.85rem" }}>
          PayPal and Venmo couldn&rsquo;t load. An ad or tracker blocker is the usual cause.
        </p>
      )}
      <div ref={ref} />
      {state === "ready" && (
        <p style={{ color: "var(--ink-2)", fontSize: "0.78rem", margin: "6px 0 0" }}>
          PayPal or Venmo. The Venmo button shows for US buyers where Venmo is available.
        </p>
      )}
    </div>
  );
}

// The account's own recent checkouts, so "did my payment go through?" has an
// answer right here.
function MyPayments({ rows }) {
  return (
    <div className="form-card" style={{ marginTop: 14 }}>
      <h3>Your payments</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: "0.85rem" }}>
        {rows.map(r => (
          <li key={r.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border)", color: "var(--ink-1)" }}>
            <strong>{r.amount_cents ? formatPrice(r.amount_cents) : "Free"}</strong>
            {" · "}{methodLabel(r)}
            {" · "}{statusLabel(r.status)}
            {r.created_at && (
              <span style={{ color: "var(--ink-2)" }}> · {new Date(r.created_at).toLocaleDateString()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
