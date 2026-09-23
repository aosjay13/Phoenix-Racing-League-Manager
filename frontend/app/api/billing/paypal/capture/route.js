import { NextResponse } from "next/server";
import { withUser } from "@/lib/serverAuth";
import { capturePaypalOrder } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// POST /api/billing/paypal/capture { order_id }: the buyer approved the payment
// in the PayPal or Venmo window; take the money and record the credit.
//
// The capture happens HERE, with the server's credentials, and the credit is
// only recorded once PayPal's answer shows a completed capture at this site's
// price on an order this server created for this account. See
// capturePaypalOrder and paypalOrderVerdict.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || "").trim();
  if (!/^[A-Za-z0-9-]+$/.test(orderId)) {
    return NextResponse.json({ error: "That isn't a PayPal order this site started." }, { status: 400 });
  }
  let result;
  try {
    result = await capturePaypalOrder(orderId, { uid: user.uid });
  } catch (err) {
    console.error("[billing] PayPal capture failed", orderId, err?.message || err);
    return NextResponse.json(
      { error: "Couldn't confirm the payment with PayPal. If you were charged, reload this page in a minute and it will catch up." },
      { status: 502 },
    );
  }
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === "unknown-order") {
    return NextResponse.json({ error: "That isn't a PayPal order this site started." }, { status: 404 });
  }
  if (result.reason === "capture-pending") {
    return NextResponse.json({
      ok: false,
      pending: true,
      error: "PayPal is still processing that payment. Your league unlocks as soon as it clears.",
    });
  }
  return NextResponse.json(
    { error: "PayPal didn't complete that payment, so no league was unlocked." },
    { status: 402 },
  );
});
