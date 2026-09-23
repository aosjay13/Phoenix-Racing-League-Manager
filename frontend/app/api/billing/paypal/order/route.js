import { NextResponse } from "next/server";
import { withUser } from "@/lib/serverAuth";
import { PROVIDER_PAYPAL, leaguePriceCents } from "@/lib/billing";
import { checkoutRefusal, startPaypalOrder } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// POST /api/billing/paypal/order: create the PayPal order the PayPal and Venmo
// buttons pay. Called by the buttons' createOrder, so the order always comes
// from the server at the server's price, never from the browser.
export const POST = withUser(async (request, ctx, user) => {
  const refusal = await checkoutRefusal(user, PROVIDER_PAYPAL);
  if (refusal) {
    const { status, ...answer } = refusal;
    return NextResponse.json(answer, { status });
  }
  try {
    const order = await startPaypalOrder({ user, priceCents: leaguePriceCents() });
    return NextResponse.json({ id: order.id });
  } catch (err) {
    console.error("[billing] PayPal order failed", err?.message || err);
    return NextResponse.json(
      { error: "Couldn't start the PayPal checkout. Nothing was charged; try again in a moment." },
      { status: 502 },
    );
  }
});
