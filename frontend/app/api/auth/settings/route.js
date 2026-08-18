import { NextResponse } from "next/server";
import { withGlobalOwner } from "@/lib/serverAuth";
import { requireEmailVerification, setRequireEmailVerification } from "@/lib/authSettings";

export const dynamic = "force-dynamic";

// GET is deliberately PUBLIC, and that is the whole point of it.
//
// The client's verification wall (components/VerifyGate.jsx) has to know whether
// this installation still asks for verification — and the one account that
// needs the answer most is an unverified one, which by definition cannot call
// any authenticated route. Gating this behind sign-in would make the switch
// unreadable by exactly the people it exists for.
//
// What it discloses is a single boolean about the installation's own policy. It
// names no account and grants nothing.
export async function GET() {
  return NextResponse.json({ require_email_verification: await requireEmailVerification() });
}

// Application-Owner only. Turning the wall off is a decision about the whole
// installation, not about one league, so it sits with the same role that runs
// the containment migration and the backups (see isGlobalOwner).
export const PATCH = withGlobalOwner(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body.require_email_verification !== "boolean") {
    return NextResponse.json(
      { error: "require_email_verification must be true or false" },
      { status: 400 },
    );
  }
  const required = await setRequireEmailVerification(body.require_email_verification, {
    actorUid: user.uid,
  });
  return NextResponse.json({ ok: true, require_email_verification: required });
});
