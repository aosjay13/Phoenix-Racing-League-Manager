// Paying to start a league.
//
// The promise under test is the one the whole feature rests on: a league is
// only unlocked by money the SERVER has confirmed, and the application Owner
// never pays. Every "must NOT" case below is a way somebody could get a league
// without paying (a forged webhook, a cheaper order made in the browser, a
// session that belongs to someone else, a spent credit brought back to life),
// and a wrong answer to any of them doesn't throw. It just gives a league away.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAY_EXPIRED, PAY_PAID, PAY_PENDING, PAY_REVOKED, PAY_USED, PURPOSE,
  canMarkExpired, canMarkPaid, canRevoke, formatPrice, leaguePriceCents, methodLabel,
  paymentDocId, paypalAmount, paypalApiBase, paypalConfigured, paypalEnv, paypalFundingSource,
  paypalOrderVerdict, paypalSdkUrl, startLeagueMode, stripeConfigured, stripeSessionVerdict,
  unspentCredits,
} from "@/lib/billing";
import { verifyStripeSignature } from "@/lib/stripeSignature";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ── 1. Price ────────────────────────────────────────────────────────────────

check("whole dollars", leaguePriceCents({ LEAGUE_PRICE_USD: "25" }), 2500);
check("dollars and cents", leaguePriceCents({ LEAGUE_PRICE_USD: "19.99" }), 1999);
check("one decimal", leaguePriceCents({ LEAGUE_PRICE_USD: "9.5" }), 950);
check("a leading $ is fine", leaguePriceCents({ LEAGUE_PRICE_USD: "$30" }), 3000);
check("whitespace is fine", leaguePriceCents({ LEAGUE_PRICE_USD: "  15 " }), 1500);
check("unset: paid creation is off", leaguePriceCents({}), null);
check("empty: off", leaguePriceCents({ LEAGUE_PRICE_USD: "" }), null);
check("zero: off, never a free checkout", leaguePriceCents({ LEAGUE_PRICE_USD: "0" }), null);
check("negative: off", leaguePriceCents({ LEAGUE_PRICE_USD: "-5" }), null);
check("words: off", leaguePriceCents({ LEAGUE_PRICE_USD: "twenty" }), null);
check("three decimals: off rather than rounded", leaguePriceCents({ LEAGUE_PRICE_USD: "1.999" }), null);
check("under Stripe's 50 cent minimum: off", leaguePriceCents({ LEAGUE_PRICE_USD: "0.49" }), null);
check("exactly 50 cents is allowed", leaguePriceCents({ LEAGUE_PRICE_USD: "0.50" }), 50);

check("formatPrice", formatPrice(2500), "$25.00");
check("formatPrice cents", formatPrice(1999), "$19.99");
check("paypalAmount is a decimal string", paypalAmount(2500), "25.00");
check("paypalAmount cents", paypalAmount(950), "9.50");

// ── 2. Configuration ────────────────────────────────────────────────────────

check("stripe off without a key", stripeConfigured({}), false);
check("stripe on with a key", stripeConfigured({ STRIPE_SECRET_KEY: "sk_test_x" }), true);
check("paypal needs both halves", paypalConfigured({ PAYPAL_CLIENT_ID: "id" }), false);
check("paypal on with both", paypalConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }), true);
check("paypal defaults to the sandbox", paypalEnv({}), "sandbox");
check("a typo lands on the sandbox too", paypalEnv({ PAYPAL_ENV: "liev" }), "sandbox");
check("live only when named", paypalEnv({ PAYPAL_ENV: "LIVE" }), "live");
check("sandbox API", paypalApiBase({}), "https://api-m.sandbox.paypal.com");
check("live API", paypalApiBase({ PAYPAL_ENV: "live" }), "https://api-m.paypal.com");

{
  const live = new URL(paypalSdkUrl({ clientId: "abc", env: "live" }));
  check("SDK client id", live.searchParams.get("client-id"), "abc");
  check("Venmo is asked for", live.searchParams.get("enable-funding"), "venmo");
  check("capture intent", live.searchParams.get("intent"), "capture");
  check("live doesn't pin the buyer country", live.searchParams.has("buyer-country"), false);
  const sandbox = new URL(paypalSdkUrl({ clientId: "abc", env: "sandbox" }));
  check("sandbox pins a US buyer so Venmo can be tested", sandbox.searchParams.get("buyer-country"), "US");
}

// ── 3. Who pays ─────────────────────────────────────────────────────────────

const on = { priceCents: 2500, stripe: true, paypal: true };
check("the application Owner is free", startLeagueMode({ ...on, globalOwner: true }), "free");
check("the Owner is free even with nothing set up", startLeagueMode({ globalOwner: true }), "free");
check("the Owner is free before the first league exists",
  startLeagueMode({ globalOwner: true, installReady: false }), "free");
check("anyone else with no credit pays", startLeagueMode({ ...on }), "pay");
check("Stripe alone is enough to pay", startLeagueMode({ priceCents: 2500, stripe: true }), "pay");
check("PayPal alone is enough to pay", startLeagueMode({ priceCents: 2500, paypal: true }), "pay");
check("a credit means create", startLeagueMode({ ...on, credits: 1 }), "credit");
check("a credit still works if the providers are switched off later",
  startLeagueMode({ credits: 1 }), "credit");
check("no price: closed", startLeagueMode({ stripe: true, paypal: true }), "closed");
check("no provider: closed", startLeagueMode({ priceCents: 2500 }), "closed");
check("no first league yet: nobody but the Owner", startLeagueMode({ ...on, installReady: false }), "not-ready");
check("not even with a credit", startLeagueMode({ ...on, credits: 1, installReady: false }), "not-ready");

// ── 4. Credits ──────────────────────────────────────────────────────────────

{
  const rows = [
    { id: "used", status: PAY_USED, league_id: "L1", paid_at: "2026-01-01" },
    { id: "newer", status: PAY_PAID, paid_at: "2026-03-01" },
    { id: "pending", status: PAY_PENDING, created_at: "2025-12-01" },
    { id: "older", status: PAY_PAID, paid_at: "2026-02-01" },
    { id: "revoked", status: PAY_REVOKED, paid_at: "2025-01-01" },
    { id: "expired", status: PAY_EXPIRED, created_at: "2025-01-01" },
    // Paid but already carries a league: spent, whatever the status says.
    { id: "odd", status: PAY_PAID, league_id: "L2", paid_at: "2025-01-01" },
  ];
  check("only paid, unspent rows are credits, oldest first",
    unspentCredits(rows).map(r => r.id), ["older", "newer"]);
  check("no rows, no credits", unspentCredits([]), []);
  check("junk is ignored", unspentCredits([null, undefined, {}]), []);
}

// Rows only move forward.
check("pending can become paid", canMarkPaid(PAY_PENDING), true);
check("a fresh row can become paid", canMarkPaid(undefined), true);
check("an expired checkout that did get paid still counts", canMarkPaid(PAY_EXPIRED), true);
check("paid can't be re-marked (no second credit)", canMarkPaid(PAY_PAID), false);
check("used can't go back to paid (no spent credit revived)", canMarkPaid(PAY_USED), false);
check("revoked can't come back through a late webhook", canMarkPaid(PAY_REVOKED), false);
check("pending can expire", canMarkExpired(PAY_PENDING), true);
check("paid can't be expired by a late 'declined'", canMarkExpired(PAY_PAID), false);
check("used can't be expired", canMarkExpired(PAY_USED), false);
check("an unspent credit can be revoked", canRevoke({ status: PAY_PAID }), true);
check("a spent credit can't be (the league exists)", canRevoke({ status: PAY_USED, league_id: "L" }), false);
check("a pending checkout isn't a credit to revoke", canRevoke({ status: PAY_PENDING }), false);
check("nothing to revoke", canRevoke(null), false);

check("doc id", paymentDocId("stripe", "cs_test_abc123"), "stripe_cs_test_abc123");
check("doc id can't be steered into a path", paymentDocId("paypal", "../../users/x"), "paypal_usersx");
check("no id, no doc", paymentDocId("paypal", ""), "");

check("method label: Cash App", methodLabel({ provider: "stripe", method: "cashapp" }), "Cash App");
check("method label: Venmo", methodLabel({ provider: "paypal", method: "venmo" }), "Venmo");
check("method label: comp", methodLabel({ provider: "comp", method: "comp" }), "Given by the Owner");

// ── 5. Stripe webhook signatures ────────────────────────────────────────────

{
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  const t = Math.floor(now / 1000);
  const sign = (body, ts = t, key = secret) =>
    crypto.createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");

  ok("a genuine signature passes",
    verifyStripeSignature({ payload, header: `t=${t},v1=${sign(payload)}`, secret, now }));
  ok("spaces in the header are fine",
    verifyStripeSignature({ payload, header: `t=${t}, v1=${sign(payload)}`, secret, now }));
  ok("any one of several v1 signatures is enough (secret rollover)",
    verifyStripeSignature({ payload, header: `t=${t},v1=${"0".repeat(64)},v1=${sign(payload)}`, secret, now }));
  ok("MUST NOT pass: a tampered body",
    !verifyStripeSignature({ payload: payload.replace("evt_1", "evt_2"), header: `t=${t},v1=${sign(payload)}`, secret, now }));
  ok("MUST NOT pass: signed with another secret",
    !verifyStripeSignature({ payload, header: `t=${t},v1=${sign(payload, t, "whsec_other")}`, secret, now }));
  ok("MUST NOT pass: an old event replayed",
    !verifyStripeSignature({ payload, header: `t=${t - 600},v1=${sign(payload, t - 600)}`, secret, now }));
  ok("MUST NOT pass: no signature",
    !verifyStripeSignature({ payload, header: `t=${t}`, secret, now }));
  ok("MUST NOT pass: no header", !verifyStripeSignature({ payload, header: null, secret, now }));
  ok("MUST NOT pass: no secret configured",
    !verifyStripeSignature({ payload, header: `t=${t},v1=${sign(payload)}`, secret: "", now }));
  ok("MUST NOT pass: a v0 signature only",
    !verifyStripeSignature({ payload, header: `t=${t},v0=${sign(payload)}`, secret, now }));
  ok("MUST NOT pass: garbage signature",
    !verifyStripeSignature({ payload, header: `t=${t},v1=not-hex`, secret, now }));
}

// ── 6. Stripe sessions ──────────────────────────────────────────────────────

const session = (extra = {}) => ({
  object: "checkout.session",
  id: "cs_test_1",
  client_reference_id: "uidA",
  metadata: { purpose: PURPOSE, uid: "uidA" },
  currency: "usd",
  amount_total: 2500,
  status: "complete",
  payment_status: "paid",
  ...extra,
});

check("a paid session for this account is a credit",
  stripeSessionVerdict(session(), { uid: "uidA" }), { ok: true, uid: "uidA", amountCents: 2500 });
check("the webhook (no uid) reads the account off the session",
  stripeSessionVerdict(session()).uid, "uidA");
check("MUST NOT credit: somebody else's session",
  stripeSessionVerdict(session(), { uid: "uidB" }).reason, "wrong-account");
check("MUST NOT credit: a payment for something else on the same Stripe account",
  stripeSessionVerdict(session({ metadata: { purpose: "donation" } }), { uid: "uidA" }).reason, "wrong-purpose");
check("MUST NOT credit: not paid yet",
  stripeSessionVerdict(session({ payment_status: "unpaid", status: "open" }), { uid: "uidA" }).ok, false);
check("MUST NOT credit: a different currency",
  stripeSessionVerdict(session({ currency: "eur" }), { uid: "uidA" }).reason, "wrong-currency");
check("MUST NOT credit: not a session at all",
  stripeSessionVerdict({ object: "payment_intent" }).reason, "not-a-session");
check("an expired session is final",
  stripeSessionVerdict(session({ status: "expired", payment_status: "unpaid" })), { ok: false, reason: "expired", final: true });
check("a finished checkout whose bank payment failed is final",
  stripeSessionVerdict(session({ payment_status: "unpaid", payment_intent: { status: "requires_payment_method" } })).final, true);
check("a finished checkout still clearing is NOT final",
  stripeSessionVerdict(session({ payment_status: "unpaid", payment_intent: { status: "processing" } })).final, undefined);

// ── 7. PayPal orders ────────────────────────────────────────────────────────

const order = (extra = {}, capture = {}) => ({
  id: "ORDER1",
  status: "COMPLETED",
  payment_source: { paypal: {} },
  purchase_units: [{
    custom_id: "uidA",
    amount: { currency_code: "USD", value: "25.00" },
    payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" }, ...capture }] },
  }],
  ...extra,
});

check("a captured order at our price is a credit",
  paypalOrderVerdict(order(), { uid: "uidA", amountCents: 2500 }),
  { ok: true, uid: "uidA", amountCents: 2500, captureId: "CAP1", method: "paypal" });
check("Venmo is recorded as Venmo",
  paypalOrderVerdict(order({ payment_source: { venmo: {} } }), { uid: "uidA", amountCents: 2500 }).method, "venmo");
check("MUST NOT credit: a one-cent order made in the browser",
  paypalOrderVerdict(order({}, { amount: { currency_code: "USD", value: "0.01" } }), { uid: "uidA", amountCents: 2500 }).reason,
  "wrong-amount");
check("MUST NOT credit: another currency",
  paypalOrderVerdict(order({}, { amount: { currency_code: "MXN", value: "25.00" } }), { uid: "uidA", amountCents: 2500 }).reason,
  "wrong-currency");
check("MUST NOT credit: somebody else's order",
  paypalOrderVerdict(order(), { uid: "uidB", amountCents: 2500 }).reason, "wrong-account");
check("MUST NOT credit: approved but not captured",
  paypalOrderVerdict(order({ status: "APPROVED", purchase_units: [{ custom_id: "uidA", amount: { currency_code: "USD", value: "25.00" } }] }),
    { uid: "uidA", amountCents: 2500 }).reason, "not-captured");
check("a capture PayPal is still reviewing waits",
  paypalOrderVerdict(order({}, { status: "PENDING" }), { uid: "uidA", amountCents: 2500 }).reason, "capture-pending");
check("a voided order is final",
  paypalOrderVerdict(order({ status: "VOIDED" }), { uid: "uidA", amountCents: 2500 }).final, true);
check("MUST NOT credit: nothing", paypalOrderVerdict(null, { uid: "uidA", amountCents: 2500 }).ok, false);

check("funding: card", paypalFundingSource({ payment_source: { card: {} } }), "card");
check("funding: unknown falls back to PayPal", paypalFundingSource({}), "paypal");

// ── 8. The paywall is on the server ─────────────────────────────────────────
//
// The rules above only matter if the route that creates leagues uses them. A
// refactor that put POST /api/leagues back behind a plain role check would
// pass every test above and hand leagues out for nothing, so the route's
// shape is pinned here too.

{
  const src = readFileSync(path.join(appRoot, "app/api/leagues/route.js"), "utf8");
  const post = src.slice(src.indexOf("export const POST"));
  ok("POST /api/leagues exists", post.length > 0);
  ok("the Owner is recognised as the APPLICATION Owner", post.includes("isGlobalOwner(user)"));
  ok("everyone else spends a credit in the same write as the league", post.includes("createLeagueWithCredit("));
  ok("no credit is a 402, not a created league", /status:\s*402/.test(post));
  ok("the first league is the Owner's", post.includes("legacyLeagueId()"));
  ok("the league doc isn't written outside those two paths", (post.match(/\.add\(/g) || []).length === 0);
}

console.log(`billing: ${n} checks passed`);
