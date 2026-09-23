import { NextResponse } from "next/server";
import { withGlobalOwner } from "@/lib/serverAuth";
import { revokeCredit } from "@/lib/billingServer";

export const dynamic = "force-dynamic";

// PATCH /api/admin/league-payments/[id] { action: "revoke" }: take back a
// credit nobody has spent yet. Use it after refunding a payment in Stripe or
// PayPal, or to withdraw a free league given by mistake. The refund itself is
// done in Stripe or PayPal; this only stops the credit from being spent.
export const PATCH = withGlobalOwner(async (request, { params }, user) => {
  const body = await request.json().catch(() => ({}));
  if (body.action !== "revoke") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const result = await revokeCredit(params.id, { by: user.email || user.uid });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.row);
});
