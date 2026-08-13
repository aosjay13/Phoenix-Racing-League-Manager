import { NextResponse } from "next/server";
import { withUser } from "@/lib/serverAuth";
import { messagesForUser } from "@/lib/messagesServer";

export const dynamic = "force-dynamic";

// The signed-in player's own inbox — every decision an admin has made about
// them, with the thread hanging off each one. Read by the message board on the
// Dashboard.
//
// Scoped to the caller by their own uid rather than by anything in the request,
// so there is no way to read somebody else's mail.
export const GET = withUser(async (request, ctx, user) => {
  return NextResponse.json(await messagesForUser(user.uid));
});
