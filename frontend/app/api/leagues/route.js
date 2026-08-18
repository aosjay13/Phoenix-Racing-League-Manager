import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { forgetLegacyLeague, withOwner } from "@/lib/serverAuth";
import { leagueRolePatch } from "@/lib/leagueRoles";

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
//
// The creator is written in as the new league's OWNER straight away. Roles are
// per-league now (see lib/leagueRoles.js), so without this the person who just
// made a league would be a stranger to it the moment they switched into it —
// unable to add a game, and unable to give themselves the role that would let
// them. Nobody else carries over: an Admin of the league this was created from
// has no standing here until they're invited, which is the whole point.
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

  const patch = leagueRolePatch(ref.id, "owner");
  if (patch) {
    // merge:true deep-merges the map, so this adds one key and leaves every
    // other league's role on the account untouched.
    await db().collection("users").doc(user.uid).set(patch, { merge: true });
  }
  // A league list that was empty a moment ago has a legacy league now.
  forgetLegacyLeague();

  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});
