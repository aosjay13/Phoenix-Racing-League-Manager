import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase";
import { withGlobalOwner } from "@/lib/serverAuth";
import { formatPrice, leaguePriceCents, paypalConfigured, paypalEnv, stripeConfigured } from "@/lib/billing";
import { grantComp, listPayments } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// GET /api/admin/league-payments: every league payment and free league, newest
// first, for the application Owner. Money for new leagues is the app's
// business rather than any one league's, so this is gated on isGlobalOwner
// like backup and restore, not on the Owner of the league on screen.
export const GET = withGlobalOwner(async () => {
  const [rows, leaguesSnap] = await Promise.all([listPayments(), db().collection("leagues").get()]);
  const leagueNames = Object.fromEntries(leaguesSnap.docs.map(d => [d.id, d.data().name || ""]));
  const priceCents = leaguePriceCents();
  return NextResponse.json({
    // What is switched on, so the screen can say what a buyer actually sees.
    config: {
      price_label: priceCents ? formatPrice(priceCents) : null,
      stripe: stripeConfigured(),
      stripe_webhook: !!String(process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
      paypal: paypalConfigured(),
      paypal_env: paypalConfigured() ? paypalEnv() : null,
    },
    payments: rows.map(r => ({
      ...r,
      league_name: r.league_id ? (leagueNames[r.league_id] ?? null) : null,
    })),
  });
});

// POST /api/admin/league-payments { email, note }: give an account a league it
// hasn't paid for through the app. For somebody who paid the Owner directly
// by Cash App or Venmo, a free first league, or a friend. The account has to
// exist already, since the credit is tied to who spends it.
export const POST = withGlobalOwner(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email address they signed up with." }, { status: 400 });
  }
  let target;
  try {
    target = await adminAuth().getUserByEmail(email);
  } catch {
    return NextResponse.json(
      { error: `No account uses ${email}. They need to sign up first.` },
      { status: 404 },
    );
  }
  const note = String(body.note || "").trim().slice(0, 300);
  const row = await grantComp({
    uid: target.uid, email: target.email || email, grantedBy: user.email || user.uid, note,
  });
  return NextResponse.json(row, { status: 201 });
});
