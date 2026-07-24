import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withOwner } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// GET: every league, oldest first. Reads are public (like the rest of the
// hierarchy) so the League Switcher can populate for any visitor.
export async function GET() {
  const snap = await db().collection("leagues").get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return NextResponse.json(docs);
}

// POST: create a fresh, EMPTY league — no games/series/seasons/drivers, just
// the league doc. New hierarchy/pool rows created while this league is active
// pick up its id (see lib/entityApi.js), so the environment stays isolated.
// Owner-only: Admins/Moderators/Statisticians are rejected by withOwner.
export const POST = withOwner(async (request, ctx, user) => {
  const body = await request.json();
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const doc = {
    name,
    logo_url: body.logo_url || null,
    description: body.description || null,
    owner_id: user.uid,
    created_at: new Date().toISOString(),
    created_by: user.uid,
  };
  const ref = await db().collection("leagues").add(doc);
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});
