import { NextResponse } from "next/server";
import { isGlobalOwner, legacyLeagueId, withUser } from "@/lib/serverAuth";
import {
  PAY_PAID, PAY_REVOKED, PAY_USED, formatPrice, leaguePriceCents, paypalConfigured, paypalEnv,
  paypalSdkUrl, startLeagueMode, stripeConfigured, unspentCredits,
} from "@/lib/billing";
import { paymentsFor, reconcilePending } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

const SHOWN = new Set([PAY_PAID, PAY_USED, PAY_REVOKED]);

// GET /api/billing: where the signed-in account stands on starting a league.
// Free (the application Owner), holding a paid credit, needing to pay, or
// unable to because paid creation isn't switched on. See lib/billing.js.
//
// Asking also settles any checkout this account started that was paid without
// the app hearing about it (see reconcilePending), so opening the Start a
// League page is always enough to find a payment that went through.
export const GET = withUser(async (request, ctx, user) => {
  const [globalOwner, legacy] = await Promise.all([isGlobalOwner(user), legacyLeagueId()]);
  const priceCents = leaguePriceCents();
  const stripe = stripeConfigured() && !!priceCents;
  const paypal = paypalConfigured() && !!priceCents;

  if (!globalOwner) {
    await reconcilePending(user.uid).catch(err =>
      console.error("[billing] reconcile failed", err?.message || err));
  }
  const rows = globalOwner ? [] : await paymentsFor(user.uid);
  const credits = unspentCredits(rows);

  return NextResponse.json({
    mode: startLeagueMode({
      globalOwner, credits: credits.length, priceCents, stripe, paypal, installReady: !!legacy,
    }),
    global_owner: globalOwner,
    price_cents: priceCents,
    price_label: priceCents ? formatPrice(priceCents) : null,
    credits: credits.length,
    stripe,
    // The client id is public by design (it is in every PayPal button on the
    // web). Served from here rather than baked into the bundle, so switching
    // PayPal on is an env change and a redeploy, not a rebuild with a
    // NEXT_PUBLIC_ variable.
    paypal: paypal
      ? { sdk_url: paypalSdkUrl({ clientId: process.env.PAYPAL_CLIENT_ID.trim(), env: paypalEnv() }) }
      : null,
    // The account's own payments, so "did my payment go through?" has an
    // answer on the page. Checkouts that were started and never finished are
    // left out; every press of the PayPal button starts one.
    payments: rows.filter(r => SHOWN.has(r.status)).slice(0, 10).map(r => ({
      id: r.id,
      provider: r.provider,
      method: r.method || r.provider,
      status: r.status,
      amount_cents: r.amount_cents ?? null,
      created_at: r.created_at || null,
      paid_at: r.paid_at || null,
      used_at: r.used_at || null,
      league_id: r.league_id || null,
    })),
  });
});
