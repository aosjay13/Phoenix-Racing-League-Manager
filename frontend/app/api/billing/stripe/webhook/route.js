import { NextResponse } from "next/server";
import { PURPOSE } from "@/lib/billing";
import { fetchStripeSession, settleStripeSession } from "@/lib/billingServer";
import { verifyStripeSignature } from "@/lib/stripeSignature";

export const dynamic = "force-dynamic";

// The Checkout events that change whether somebody has paid for a league.
const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

// POST /api/billing/stripe/webhook: Stripe telling the server a checkout
// finished, whether or not the buyer's browser ever came back.
//
// No sign-in: Stripe is the caller, and it proves it with the Stripe-Signature
// header, checked against STRIPE_WEBHOOK_SECRET over the raw body. Even then
// the event body is only used for the session id. The session itself is read
// back from Stripe, the same as every other path, so there is exactly one place
// that decides what a session means (settleStripeSession).
//
// A 500 makes Stripe retry (for up to three days), so it is only sent when
// retrying could help. Events for anything that isn't a league payment get a
// 200 and are left alone.
export async function POST(request) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }
  const payload = await request.text();
  const valid = verifyStripeSignature({
    payload, header: request.headers.get("stripe-signature"), secret,
  });
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!HANDLED.has(event?.type)) return NextResponse.json({ received: true });
  const object = event.data?.object;
  if (object?.object !== "checkout.session" || object?.metadata?.purpose !== PURPOSE) {
    return NextResponse.json({ received: true });
  }

  try {
    await settleStripeSession(await fetchStripeSession(object.id));
  } catch (err) {
    console.error("[billing] webhook couldn't settle", object.id, err?.message || err);
    return NextResponse.json({ error: "Couldn't record the payment" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
