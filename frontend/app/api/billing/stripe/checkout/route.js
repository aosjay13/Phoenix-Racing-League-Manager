import { NextResponse } from "next/server";
import { withUser } from "@/lib/serverAuth";
import { PROVIDER_STRIPE, leaguePriceCents } from "@/lib/billing";
import { checkoutRefusal, siteOrigin, startStripeCheckout } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// POST /api/billing/stripe/checkout: start a Stripe Checkout for one league
// credit and hand back the URL to send the browser to. The price is the
// server's (LEAGUE_PRICE_USD); nothing in the request can change it.
export const POST = withUser(async (request, ctx, user) => {
  const refusal = await checkoutRefusal(user, PROVIDER_STRIPE);
  if (refusal) {
    const { status, ...answer } = refusal;
    return NextResponse.json(answer, { status });
  }
  try {
    const session = await startStripeCheckout({
      user, origin: siteOrigin(request), priceCents: leaguePriceCents(),
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing] Stripe checkout failed", err?.message || err);
    return NextResponse.json(
      { error: "Couldn't start the checkout. Nothing was charged; try again in a moment." },
      { status: 502 },
    );
  }
});
