// Paying to start a league.
//
// Browsing, joining and racing are free. Starting a NEW league is what costs
// money, and only for people other than the application Owner: the Owner (an
// ADMIN_EMAILS account, or the Owner of the legacy league; see isGlobalOwner in
// lib/serverAuth.js) creates leagues for nothing, the same as before.
//
// ── The model: one payment buys one league ─────────────────────────────────
//
// A verified payment becomes a LEAGUE CREDIT, a row in `league_payments` with
// status "paid". Creating a league spends one: the same transaction that writes
// the league doc flips the credit to "used" and records which league it paid
// for. So paying and naming the league are two separate steps, and nothing is
// lost between them. Somebody who pays and then closes the tab still has their
// credit the next time they come back.
//
// It is a one-time charge per league on purpose. Cash App and Venmo don't do
// recurring billing through a website checkout, so a subscription would shut
// both of them out.
//
// ── Where each payment method comes from ───────────────────────────────────
//
//   Stripe Checkout   cards, Apple Pay, Google Pay, and Cash App Pay (Stripe is
//                     the only way a website can take Cash App and be told the
//                     money arrived).
//   PayPal Checkout   PayPal balance, Venmo, Pay Later, and cards. Venmo only
//                     exists for a website through PayPal.
//
// A personal $cashtag, Venmo handle or PayPal.me link can't tell the server a
// payment happened, so they can't unlock anything on their own. When somebody
// pays the Owner that way, the Owner hands them a credit by hand from League
// Setup ▸ League Payments ("comp").
//
// ── The one rule that matters ──────────────────────────────────────────────
//
// Whether somebody has paid is decided on the SERVER, from what Stripe or PayPal
// say when the server asks them, never from anything the browser reports.
// Hiding the Create button would stop nobody who can open dev tools. POST
// /api/leagues refuses a non-Owner who holds no credit, whatever the page shows.
//
// Everything in this file is pure (no Firestore, no network, no Node built-ins)
// so the decisions can be unit-tested and the pages can import it too.
// lib/billingServer.js does the talking, and lib/stripeSignature.js checks
// webhook signatures.

export const PAYMENTS_COLLECTION = "league_payments";

// The life of one row.
export const PAY_PENDING = "pending";   // checkout started, not paid (yet)
export const PAY_PAID = "paid";         // money arrived: an unspent league credit
export const PAY_USED = "used";         // spent on a league (league_id says which)
export const PAY_EXPIRED = "expired";   // checkout abandoned or declined
export const PAY_REVOKED = "revoked";   // the Owner took an unspent credit back (a refund)

export const PROVIDER_STRIPE = "stripe";
export const PROVIDER_PAYPAL = "paypal";
export const PROVIDER_COMP = "comp";    // given by the Owner, no money through the app

export const CURRENCY = "usd";

// What the Stripe session and PayPal order are tagged with, so a payment made
// for something else on the same merchant account is never mistaken for a
// league credit.
export const PURPOSE = "league_credit";

// ── Price ──────────────────────────────────────────────────────────────────

// LEAGUE_PRICE_USD, in cents. "25", "25.00" and "$25" all read as 2500.
// Unset, zero, negative or unreadable means null: paid league creation is
// switched off, and the Start a League page says so rather than guessing a
// price. Stripe refuses charges under 50 cents, so anything below that is
// refused here too rather than failing at checkout.
export function leaguePriceCents(env = process.env) {
  const raw = String(env?.LEAGUE_PRICE_USD ?? "").trim().replace(/^\$/, "");
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isFinite(cents) || cents < 50) return null;
  return cents;
}

// "$25.00" for the page, "25.00" for PayPal (which wants a decimal string).
export function formatPrice(cents) {
  if (!Number.isFinite(cents)) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

export function paypalAmount(cents) {
  return (cents / 100).toFixed(2);
}

// ── Which providers are switched on ────────────────────────────────────────

export function stripeConfigured(env = process.env) {
  return !!String(env?.STRIPE_SECRET_KEY || "").trim();
}

export function paypalConfigured(env = process.env) {
  return !!String(env?.PAYPAL_CLIENT_ID || "").trim()
    && !!String(env?.PAYPAL_CLIENT_SECRET || "").trim();
}

// "live" only when asked for by name. A typo lands on the sandbox, where a
// mistake costs nobody anything.
export function paypalEnv(env = process.env) {
  return String(env?.PAYPAL_ENV || "").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

export function paypalApiBase(env = process.env) {
  return paypalEnv(env) === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

// The PayPal JS SDK URL the browser loads to draw the PayPal and Venmo buttons.
// Venmo is off by default in the SDK and has to be asked for. In the sandbox it
// also only shows for a US buyer, which a developer outside the US isn't, so
// the sandbox pins the buyer country to make the button testable.
export function paypalSdkUrl({ clientId, env = "sandbox", currency = "USD" }) {
  const p = new URLSearchParams({
    "client-id": clientId,
    currency,
    intent: "capture",
    components: "buttons",
    "enable-funding": "venmo",
  });
  if (env !== "live") p.set("buyer-country", "US");
  return `https://www.paypal.com/sdk/js?${p.toString()}`;
}

// ── Row ids ────────────────────────────────────────────────────────────────

// One row per checkout, keyed on the provider's own id. The same payment can be
// reported three ways (the webhook, the browser coming back from checkout, and
// the reconciliation sweep) and they all land on the same document.
export function paymentDocId(provider, externalId) {
  const id = String(externalId || "").replace(/[^A-Za-z0-9_-]/g, "");
  return id ? `${provider}_${id}` : "";
}

// ── Credits ────────────────────────────────────────────────────────────────

// Unspent credits, oldest first, so the one spent is always the one paid
// longest ago.
export function unspentCredits(rows = []) {
  return rows
    .filter(r => r && r.status === PAY_PAID && !r.league_id)
    .sort((a, b) => String(a.paid_at || a.created_at || "").localeCompare(String(b.paid_at || b.created_at || "")));
}

// What the Start a League page should offer, as a value:
//   "free"      the application Owner, who never pays
//   "credit"    has an unspent credit; name the league and go
//   "pay"       needs to pay, and at least one way to pay is switched on
//   "closed"    needs to pay, but no price or no provider is set up
//   "not-ready" nobody but the Owner may start a league yet (see below)
//
// `installReady` is false until the installation has its first league. The
// oldest league decides who the application Owner is (isGlobalOwner), so if a
// stranger's paid league were the first one, its creator would become the
// Owner of the whole app. The Owner sets up the first league; everybody else
// comes after.
export function startLeagueMode({
  globalOwner = false, credits = 0, priceCents = null, stripe = false, paypal = false,
  installReady = true,
} = {}) {
  if (globalOwner) return "free";
  if (!installReady) return "not-ready";
  if (credits > 0) return "credit";
  if (priceCents && (stripe || paypal)) return "pay";
  return "closed";
}

// Row transitions. A row only ever moves forward: a late webhook for a payment
// that has already been spent must never turn it back into a spendable credit,
// and a "declined" report must never undo money that did arrive.
export function canMarkPaid(status) {
  return !status || status === PAY_PENDING || status === PAY_EXPIRED;
}

export function canMarkExpired(status) {
  return !status || status === PAY_PENDING;
}

export function canRevoke(row) {
  return !!row && row.status === PAY_PAID && !row.league_id;
}

// ── Stripe ─────────────────────────────────────────────────────────────────

// Does this Checkout Session pay for a league credit for this account?
// `uid` null skips the account check (the webhook doesn't know who is asking;
// it reads the uid off the session instead).
export function stripeSessionVerdict(session, { uid = null } = {}) {
  if (!session || session.object !== "checkout.session") return { ok: false, reason: "not-a-session" };
  if (session.metadata?.purpose !== PURPOSE) return { ok: false, reason: "wrong-purpose" };
  const owner = session.client_reference_id || session.metadata?.uid || "";
  if (!owner) return { ok: false, reason: "no-account" };
  if (uid && owner !== uid) return { ok: false, reason: "wrong-account" };
  if (String(session.currency || "").toLowerCase() !== CURRENCY) return { ok: false, reason: "wrong-currency" };
  if (session.payment_status === "paid") {
    return { ok: true, uid: owner, amountCents: Number(session.amount_total) || 0 };
  }
  if (session.status === "expired") return { ok: false, reason: "expired", final: true };
  // A finished checkout whose payment then failed (a bank debit that bounced).
  // Only knowable with the payment intent expanded, which fetchStripeSession
  // always asks for.
  const pi = session.payment_intent;
  if (session.status === "complete" && pi && typeof pi === "object"
      && (pi.status === "canceled" || pi.status === "requires_payment_method")) {
    return { ok: false, reason: "payment-failed", final: true };
  }
  return { ok: false, reason: "unpaid" };
}

// ── PayPal ─────────────────────────────────────────────────────────────────

// Does this (captured) PayPal order pay for a league credit for this account,
// at the amount the server asked for?
//
// The amount check is the one that matters. The PayPal JS SDK can create an
// order in the browser with any amount it likes under this app's client id, so
// an order id arriving from the browser proves nothing until the server has
// looked at the order and seen its own price on it. The caller also only
// accepts orders it created itself (there's a pending row for each), which
// this function doesn't need to know about.
export function paypalOrderVerdict(order, { uid, amountCents }) {
  if (!order || !order.id) return { ok: false, reason: "not-an-order" };
  const unit = order.purchase_units?.[0];
  if (!unit) return { ok: false, reason: "no-purchase-unit" };
  const capture = unit.payments?.captures?.[0];
  const owner = unit.custom_id || capture?.custom_id || "";
  if (uid && owner !== uid) return { ok: false, reason: "wrong-account" };
  const amount = capture?.amount || unit.amount;
  if (String(amount?.currency_code || "").toUpperCase() !== CURRENCY.toUpperCase()) {
    return { ok: false, reason: "wrong-currency" };
  }
  if (Math.round(Number(amount?.value) * 100) !== amountCents) return { ok: false, reason: "wrong-amount" };
  if (order.status === "VOIDED") return { ok: false, reason: "voided", final: true };
  if (order.status !== "COMPLETED" || capture?.status !== "COMPLETED") {
    return { ok: false, reason: capture?.status === "PENDING" ? "capture-pending" : "not-captured" };
  }
  return { ok: true, uid: owner, amountCents, captureId: capture.id || null, method: paypalFundingSource(order) };
}

// Which button the buyer pressed: "paypal", "venmo" or "card". PayPal says so
// in the order's payment_source, keyed by the funding source.
export function paypalFundingSource(order) {
  const src = order?.payment_source;
  if (!src || typeof src !== "object") return "paypal";
  if (src.venmo) return "venmo";
  if (src.card) return "card";
  return Object.keys(src)[0] || "paypal";
}

// ── Page copy ──────────────────────────────────────────────────────────────

const METHOD_LABELS = {
  stripe: "Card / Cash App (Stripe)",
  card: "Card",
  cashapp: "Cash App",
  link: "Link (Stripe)",
  paypal: "PayPal",
  venmo: "Venmo",
  comp: "Given by the Owner",
};

export function methodLabel(row) {
  return METHOD_LABELS[row?.method] || METHOD_LABELS[row?.provider] || row?.provider || "";
}

const STATUS_LABELS = {
  [PAY_PENDING]: "Checkout started",
  [PAY_PAID]: "Paid, not used yet",
  [PAY_USED]: "League created",
  [PAY_EXPIRED]: "Not completed",
  [PAY_REVOKED]: "Revoked",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || "";
}
