import { db } from "@/lib/firebase";
import { isGlobalOwner, legacyLeagueId } from "@/lib/serverAuth";
import {
  CURRENCY, PAYMENTS_COLLECTION, PAY_EXPIRED, PAY_PAID, PAY_PENDING, PAY_REVOKED, PAY_USED,
  PROVIDER_COMP, PROVIDER_PAYPAL, PROVIDER_STRIPE, PURPOSE,
  canMarkExpired, canMarkPaid, canRevoke, leaguePriceCents, paymentDocId, paypalAmount,
  paypalApiBase, paypalConfigured, paypalOrderVerdict, stripeConfigured, stripeSessionVerdict,
  unspentCredits,
} from "@/lib/billing";

// The half of league billing that talks to Firestore, Stripe and PayPal. The
// rules themselves live in lib/billing.js; read that first.
//
// Both providers are called over their plain REST APIs with fetch rather than
// through their SDKs. It is four endpoints each, and it keeps two large
// dependencies (and their release cadence) out of the app.

const payments = () => db().collection(PAYMENTS_COLLECTION);

const now = () => new Date().toISOString();

// Where this deployment lives, for the URLs Stripe sends the buyer back to.
// APP_URL wins when it is set. Otherwise the forwarded headers are the honest
// answer behind Vercel's proxy, and the request URL is the fallback.
export function siteOrigin(request) {
  const configured = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto || "https"}://${host}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

// Should this account be allowed to START a checkout right now? Returns null
// when it should, or { status, error } for the route to send back. Shared by
// the Stripe and PayPal routes so the two can't disagree.
export async function checkoutRefusal(user, provider) {
  if (await isGlobalOwner(user)) {
    return { status: 400, error: "Starting a league is free for you as the application Owner." };
  }
  if (!(await legacyLeagueId())) {
    return { status: 409, error: "This site isn't taking new leagues yet." };
  }
  const configured = provider === PROVIDER_STRIPE ? stripeConfigured() : paypalConfigured();
  if (!leaguePriceCents() || !configured) {
    return { status: 503, error: "That way of paying isn't set up on this site yet." };
  }
  // Somebody with a paid credit waiting has already paid for the league they
  // are about to create. A second checkout is almost always a second tab or a
  // double press, and charging twice for one league is the worst outcome here.
  if (unspentCredits(await paymentsFor(user.uid)).length) {
    return {
      status: 409,
      error: "You've already paid for a league that hasn't been created yet. Create it first.",
      code: "credit-waiting",
    };
  }
  return null;
}

// ── Firestore rows ─────────────────────────────────────────────────────────

// Every row for one account, newest first.
export async function paymentsFor(uid) {
  const snap = await payments().where("uid", "==", uid).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

async function writePending(docId, fields) {
  await payments().doc(docId).set({
    ...fields,
    status: PAY_PENDING,
    league_id: null,
    created_at: now(),
    updated_at: now(),
  });
}

// Turn a row into a spendable credit. Idempotent, and only ever forward: a
// payment that is already paid, spent or revoked stays exactly as it is, so the
// webhook and the browser both reporting the same payment can't mint two
// credits, and a late report can't bring a spent credit back to life.
async function recordPaid(docId, fields) {
  const ref = payments().doc(docId);
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (cur && !canMarkPaid(cur.status)) return { id: docId, ...cur };
    // The row was written for one account when checkout started. A payment
    // report naming somebody else is not this row's payment.
    if (cur?.uid && fields.uid && cur.uid !== fields.uid) {
      throw new Error("Payment belongs to a different account");
    }
    const stamp = now();
    // A report that doesn't know a field (a session with no customer email)
    // must not blank out what the row already recorded.
    const known = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
    const next = {
      league_id: null,
      created_at: stamp,
      ...(cur || {}),
      ...known,
      status: PAY_PAID,
      paid_at: stamp,
      updated_at: stamp,
    };
    tx.set(ref, next);
    return { id: docId, ...next };
  });
}

async function recordExpired(docId) {
  const ref = payments().doc(docId);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !canMarkExpired(snap.data().status)) return;
    tx.update(ref, { status: PAY_EXPIRED, updated_at: now() });
  });
}

// Create a league AND spend one credit on it, in one transaction, or do neither.
// Two tabs pressing Create at once both see the same credit; Firestore retries
// the loser, which then finds nothing left and gets null back.
export async function createLeagueWithCredit(uid, leagueRef, leagueDoc) {
  return db().runTransaction(async tx => {
    const snap = await tx.get(payments().where("uid", "==", uid).where("status", "==", PAY_PAID));
    const credit = unspentCredits(snap.docs.map(d => ({ id: d.id, ...d.data() })))[0];
    if (!credit) return null;
    const stamp = now();
    tx.update(payments().doc(credit.id), {
      status: PAY_USED, league_id: leagueRef.id, used_at: stamp, updated_at: stamp,
    });
    tx.set(leagueRef, leagueDoc);
    return credit;
  });
}

// ── Stripe ─────────────────────────────────────────────────────────────────

// Stripe's API takes form-encoded bodies with bracketed keys for nesting:
// line_items[0][price_data][currency]=usd.
function stripeForm(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") stripeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeApi(method, path, params) {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Error("Stripe isn't set up on this site");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(params && method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params && method !== "GET" ? stripeForm(params).toString() : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Start a Stripe Checkout for one league credit. Which payment methods appear
// (card, Apple Pay, Google Pay, Cash App Pay, Link…) is decided in the Stripe
// Dashboard rather than here, so switching Cash App Pay on or off needs no
// deploy. See "Paying to start a league" in README.md.
export async function startStripeCheckout({ user, origin, priceCents }) {
  const session = await stripeApi("POST", "/checkout/sessions", {
    mode: "payment",
    client_reference_id: user.uid,
    customer_email: user.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: priceCents,
        product_data: {
          name: "Start a league",
          description: "One new league on Phoenix Racing League Manager",
        },
      },
    }],
    metadata: { purpose: PURPOSE, uid: user.uid },
    payment_intent_data: { metadata: { purpose: PURPOSE, uid: user.uid } },
    // {CHECKOUT_SESSION_ID} is filled in by Stripe, so the page can confirm the
    // payment the moment the buyer lands back on it.
    success_url: `${origin}/leagues/new?checkout=stripe&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/leagues/new?checkout=cancelled`,
  });
  await writePending(paymentDocId(PROVIDER_STRIPE, session.id), {
    uid: user.uid,
    email: user.email || null,
    provider: PROVIDER_STRIPE,
    method: PROVIDER_STRIPE,
    external_id: session.id,
    amount_cents: priceCents,
    currency: CURRENCY,
  });
  return session;
}

// Read a session straight from Stripe, with the payment method expanded so the
// Owner's payment list can say "Cash App" rather than just "Stripe". Every path
// (the webhook included) reads the session this way rather than trusting
// whatever body it was handed.
export async function fetchStripeSession(sessionId) {
  const id = encodeURIComponent(String(sessionId || ""));
  return stripeApi("GET", `/checkout/sessions/${id}?expand[]=payment_intent.payment_method`);
}

// "card", "cashapp", "link"… Apple Pay and Google Pay are cards to Stripe.
function stripeMethod(session) {
  const pm = session?.payment_intent?.payment_method;
  return (pm && typeof pm === "object" && pm.type) || PROVIDER_STRIPE;
}

// Apply what Stripe says about a session to its row. `uid` null means "don't
// check who is asking" (the webhook); the uid then comes off the session.
export async function settleStripeSession(session, { uid = null } = {}) {
  const verdict = stripeSessionVerdict(session, { uid });
  const docId = paymentDocId(PROVIDER_STRIPE, session?.id);
  if (!docId) return { ok: false, reason: "not-a-session" };
  if (verdict.ok) {
    const row = await recordPaid(docId, {
      uid: verdict.uid,
      email: session.customer_details?.email || session.customer_email || null,
      provider: PROVIDER_STRIPE,
      method: stripeMethod(session),
      external_id: session.id,
      amount_cents: verdict.amountCents,
      currency: CURRENCY,
    });
    return { ok: true, row };
  }
  if (verdict.final) await recordExpired(docId);
  return verdict;
}

// ── PayPal ─────────────────────────────────────────────────────────────────

// An access token lasts about nine hours. Kept for the life of the warm server
// instance, and dropped a minute early so a request never goes out on one that
// is about to lapse.
let paypalTokenCache = { token: null, until: 0 };

async function paypalToken() {
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.until) return paypalTokenCache.token;
  const id = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!id || !secret) throw new Error("PayPal isn't set up on this site");
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || `PayPal sign-in failed (${res.status})`);
  }
  paypalTokenCache = {
    token: data.access_token,
    until: Date.now() + Math.max(0, (Number(data.expires_in) || 0) - 60) * 1000,
  };
  return data.access_token;
}

async function paypalApi(method, path, { body, headers = {} } = {}) {
  const token = await paypalToken();
  const res = await fetch(`${paypalApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.details?.[0]?.description || data?.message || `PayPal request failed (${res.status})`);
    err.status = res.status;
    err.issue = data?.details?.[0]?.issue || data?.name || "";
    throw err;
  }
  return data;
}

// Create the order the PayPal/Venmo buttons pay. Created HERE, at the server's
// price, and recorded as a pending row, so the capture step can refuse any
// order it didn't make.
export async function startPaypalOrder({ user, priceCents }) {
  const order = await paypalApi("POST", "/v2/checkout/orders", {
    body: {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: PURPOSE,
        custom_id: user.uid,
        description: "Start a league on Phoenix Racing League Manager",
        amount: { currency_code: CURRENCY.toUpperCase(), value: paypalAmount(priceCents) },
      }],
      // Nothing is shipped, so PayPal shouldn't ask for an address.
      application_context: {
        brand_name: "Phoenix Racing League Manager",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    },
  });
  await writePending(paymentDocId(PROVIDER_PAYPAL, order.id), {
    uid: user.uid,
    email: user.email || null,
    provider: PROVIDER_PAYPAL,
    method: PROVIDER_PAYPAL,
    external_id: order.id,
    amount_cents: priceCents,
    currency: CURRENCY,
  });
  return order;
}

async function fetchPaypalOrder(orderId) {
  return paypalApi("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

// Capture an approved order and turn it into a credit. Safe to call twice: the
// PayPal-Request-Id makes a repeated capture return the first one's result, and
// anything else that goes wrong falls back to reading the order and judging
// what it says, so a capture that went through before a dropped connection is
// still honoured.
export async function capturePaypalOrder(orderId, { uid }) {
  const docId = paymentDocId(PROVIDER_PAYPAL, orderId);
  const snap = docId ? await payments().doc(docId).get() : null;
  const row = snap?.exists ? snap.data() : null;
  // Only orders this server created, for this account.
  if (!row || row.uid !== uid) return { ok: false, reason: "unknown-order" };
  if (row.status === PAY_PAID || row.status === PAY_USED) return { ok: true, row: { id: docId, ...row } };
  if (row.status === PAY_REVOKED) return { ok: false, reason: "revoked" };

  let order;
  try {
    order = await paypalApi("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      headers: { Prefer: "return=representation", "PayPal-Request-Id": `capture-${orderId}` },
    });
  } catch (err) {
    order = await fetchPaypalOrder(orderId).catch(() => null);
    if (!order) throw err;
  }
  return settlePaypalOrder(order, row, docId);
}

async function settlePaypalOrder(order, row, docId) {
  const verdict = paypalOrderVerdict(order, { uid: row.uid, amountCents: row.amount_cents });
  if (verdict.ok) {
    const paid = await recordPaid(docId, {
      uid: row.uid,
      provider: PROVIDER_PAYPAL,
      method: verdict.method,
      external_id: order.id,
      capture_id: verdict.captureId,
      amount_cents: verdict.amountCents,
      currency: CURRENCY,
    });
    return { ok: true, row: paid };
  }
  if (verdict.final) await recordExpired(docId);
  return verdict;
}

// ── Catching up on payments nobody reported ────────────────────────────────

// How long a checkout is worth asking about. Stripe sessions expire after 24
// hours and PayPal orders well before a week; a row still pending past this is
// abandoned.
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A PayPal order nobody has approved after this long was walked away from.
const PAYPAL_UNAPPROVED_MS = 6 * 60 * 60 * 1000;
// Bound the extra round trips one page load can cause.
const RECONCILE_LIMIT = 5;

// Ask the providers about this account's pending checkouts and settle any that
// were paid without the app hearing about it: a webhook that never arrived, a
// tab closed on the way back from Stripe, a PayPal approval whose capture call
// never ran. Runs whenever the Start a League page asks for the account's
// billing status, so a paid-for credit can't stay lost. Failures are swallowed;
// the next visit tries again.
export async function reconcilePending(uid) {
  const snap = await payments().where("uid", "==", uid).where("status", "==", PAY_PENDING).get();
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const nowMs = Date.now();
  let checked = 0;
  for (const row of rows) {
    const age = nowMs - Date.parse(row.created_at || "");
    if (!Number.isFinite(age) || age > PENDING_MAX_AGE_MS) {
      await recordExpired(row.id).catch(() => {});
      continue;
    }
    if (checked >= RECONCILE_LIMIT) continue;
    checked += 1;
    try {
      if (row.provider === PROVIDER_STRIPE) {
        await settleStripeSession(await fetchStripeSession(row.external_id), { uid });
      } else if (row.provider === PROVIDER_PAYPAL) {
        let order;
        try {
          order = await fetchPaypalOrder(row.external_id);
        } catch (err) {
          if (err.status === 404) await recordExpired(row.id);
          continue;
        }
        if (order.status === "APPROVED") {
          // They approved it in PayPal and the page never got as far as
          // capturing. Capturing now is finishing what they asked for.
          await capturePaypalOrder(row.external_id, { uid });
        } else if (order.status === "COMPLETED" || order.status === "VOIDED") {
          await settlePaypalOrder(order, row, row.id);
        } else if (age > PAYPAL_UNAPPROVED_MS) {
          await recordExpired(row.id);
        }
      }
    } catch (err) {
      console.error("[billing] couldn't reconcile", row.id, err?.message || err);
    }
  }
}

// ── The Owner's tools ──────────────────────────────────────────────────────

export async function listPayments(limit = 200) {
  const snap = await payments().orderBy("created_at", "desc").limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// A league credit with no money through the app: somebody paid the Owner by
// Cash App or Venmo directly, a free first league, a friend. Still a row like
// any other, so it is spent, listed and revoked the same way.
export async function grantComp({ uid, email, grantedBy, note }) {
  const ref = payments().doc();
  const stamp = now();
  const row = {
    uid,
    email: email || null,
    provider: PROVIDER_COMP,
    method: PROVIDER_COMP,
    external_id: null,
    amount_cents: 0,
    currency: CURRENCY,
    status: PAY_PAID,
    league_id: null,
    note: note || null,
    granted_by: grantedBy || null,
    created_at: stamp,
    paid_at: stamp,
    updated_at: stamp,
  };
  await ref.set(row);
  return { id: ref.id, ...row };
}

// Take back an unspent credit, e.g. after refunding it in Stripe or PayPal. A
// credit that already paid for a league can't be revoked here: the league
// exists, and deleting people's leagues over billing is not something this app
// does.
export async function revokeCredit(id, { by }) {
  const ref = payments().doc(id);
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: "Not found" };
    const row = { id, ...snap.data() };
    if (!canRevoke(row)) {
      return { ok: false, status: 409, error: "Only an unspent credit can be revoked." };
    }
    const stamp = now();
    tx.update(ref, { status: PAY_REVOKED, revoked_at: stamp, revoked_by: by || null, updated_at: stamp });
    return { ok: true, row: { ...row, status: PAY_REVOKED, revoked_at: stamp } };
  });
}
