import { NextResponse } from "next/server";
import { withUser } from "@/lib/serverAuth";
import { fetchStripeSession, settleStripeSession } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// POST /api/billing/stripe/confirm { session_id }: the browser is back from
// Stripe and wants to know whether it paid.
//
// The session id in the address bar proves nothing on its own. The server
// looks the session up with its secret key and only records a credit if Stripe
// says it was paid, by THIS account, for a league. The webhook records the same
// payment on its own; whichever arrives first wins and the other is a no-op.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.session_id || "").trim();
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: "That isn't a checkout this site started." }, { status: 400 });
  }
  let session;
  try {
    session = await fetchStripeSession(sessionId);
  } catch (err) {
    if (err.status === 404) {
      return NextResponse.json({ error: "That isn't a checkout this site started." }, { status: 404 });
    }
    console.error("[billing] couldn't read Stripe session", err?.message || err);
    return NextResponse.json(
      { error: "Couldn't reach Stripe to confirm the payment. Reload in a moment." },
      { status: 502 },
    );
  }
  const result = await settleStripeSession(session, { uid: user.uid });
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === "wrong-account" || result.reason === "wrong-purpose") {
    return NextResponse.json({ error: "That checkout belongs to a different account." }, { status: 403 });
  }
  if (result.final) {
    return NextResponse.json({ ok: false, error: "That payment didn't go through, so nothing was charged." });
  }
  // Paid by a method that takes a while to clear. The webhook or the next page
  // load picks it up once it does.
  return NextResponse.json({
    ok: false,
    pending: true,
    error: "Stripe is still processing that payment. Your league unlocks as soon as it clears.",
  });
});
