import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { isEnvAdmin, legacyLeagueId, withUser } from "@/lib/serverAuth";
import { isLeagueKey, isLeagueMember } from "@/lib/leagueRoles";
import { JOIN_COLLECTION, JOIN_MESSAGE_MAX } from "@/lib/leagueJoin";
import { fileJoinRequest } from "@/lib/leagueJoinServer";

export const dynamic = "force-dynamic";

// A player's own league join requests — every league they have asked to join,
// whatever the answer was. This is what the discovery page reads to know which
// cards say "Requested" and which say "Join League", so it deliberately returns
// resolved rows too: a denial with a reason on it is something the player is
// owed an explanation for.
//
// Scoped to the caller by uid and nothing else. There is no way to read
// somebody else's requests here — the admin queue is a separate route with its
// own permission rule (see /api/admin/league-join-requests).
export const GET = withUser(async (request, ctx, user) => {
  const snap = await db().collection(JOIN_COLLECTION).where("uid", "==", user.uid).get();
  const rows = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      league_id: data.league_id || "",
      league_name: data.league_name || "League",
      status: data.status || "pending",
      message: data.message || "",
      reason: data.reason || null,
      created_at: data.created_at || null,
      resolved_at: data.resolved_at || null,
    };
  });
  rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return NextResponse.json(rows);
});

// "Please let me into this league."
//
// Files a pending row and grants NOTHING. The account's standing only changes
// when staff of that league (or the application Owner) approve it — see
// /api/admin/league-join-requests/[id]. That is the whole point: membership used
// to be handed out automatically by merely looking at a league, and every
// roster in the app leaked as a result.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const leagueId = String(body.league_id || "").trim();
  if (!leagueId) return NextResponse.json({ error: "league_id required" }, { status: 400 });
  if (!isLeagueKey(leagueId)) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }

  // Already in? Then there is nothing to ask for, and filing a row would put a
  // meaningless job in an admin's queue. Checked against the legacy fallback as
  // well, so an account that predates the role map isn't asked to apply for the
  // league it has always been in.
  const doc = await db().collection("users").doc(user.uid).get();
  const data = doc.exists ? doc.data() : {};
  const member = isEnvAdmin(user.email)
    || isLeagueMember(data, leagueId, { legacyLeagueId: await legacyLeagueId() });
  if (member) {
    return NextResponse.json(
      { error: "You're already in this league.", code: "already-a-member" },
      { status: 409 },
    );
  }

  const result = await fileJoinRequest({
    user,
    leagueId,
    message: String(body.message || "").slice(0, JOIN_MESSAGE_MAX),
    profile: data,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json(
    { ...result.request, created: result.created },
    { status: result.created ? 201 : 200 },
  );
});
