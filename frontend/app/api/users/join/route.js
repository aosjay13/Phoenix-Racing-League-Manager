import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { isEnvAdmin, legacyLeagueId, withSignedIn } from "@/lib/serverAuth";
import {
  LEAGUE_ROLES_FIELD, isLeagueKey, isLeagueMember, normalizeLeagueRoles,
} from "@/lib/leagueRoles";
import { fileJoinRequest } from "@/lib/leagueJoinServer";

export const dynamic = "force-dynamic";

// Make sure this account has a profile document, and — when it asks — file its
// request to join the league it signed up on.
//
// ── Why this route exists ──────────────────────────────────────────────────
//
// An authentication account is global; standing in a league is a row in
// Firestore (`users.league_roles` — see lib/leagueRoles.js). Sign-up creates the
// first and nothing else creates the second early enough: /api/users/me refuses
// an unverified account, so a brand-new player was invisible to every league —
// including the one whose page they signed up on — until they had been to their
// inbox and come back.
//
// That is the gap this closes. It is the ONE route open to an account that has
// not verified its email yet (withSignedIn), and it is deliberately the smallest
// thing that could be: it writes the profile fields their sign-in already told
// us, records which league they came in through, and files a PENDING request to
// join it. Everything the app can actually DO still sits behind verification.
//
// ── What it no longer does ─────────────────────────────────────────────────
//
// It used to hand out the membership itself, as a Player, straight away. So did
// /api/users/me, for any league the account merely opened. Between them, every
// account on the installation drifted into every league it ever looked at — and
// nobody had decided to let any of them in. Membership is now something a league
// GRANTS: this files the request, that league's own staff approve it (see
// /api/admin/league-join-requests/[id]), and the approval is the only thing that
// writes the key.
//
//   body.league_id     the league to ask about. Falls back to the X-League-Id
//                      header, which api() stamps on every request anyway.
//   body.request_join  file a join request for it. The sign-up form sets this;
//                      signing IN does not, because merely signing in while
//                      looking at a league is not an application to join it.
//
// Idempotent, and it never demotes or downgrades: an account that already holds
// a role in this league keeps it, and one that already has a request waiting
// gets that same row back rather than a second one in an admin's queue.
export const POST = withSignedIn(async (request, ctx, user, headerLeagueId) => {
  const body = await request.json().catch(() => ({}));
  const leagueId = String(body.league_id || headerLeagueId || "").trim();
  const wantsRequest = body.request_join !== false;

  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  const envAdmin = isEnvAdmin(user.email);

  // No league in play at all — a pre-migration install, where nothing is
  // partitioned yet. Creating the account is still the right outcome; there is
  // simply no league to ask about. Answered as ok so the sign-up form doesn't
  // treat a perfectly normal install as a failure.
  if (!leagueId || !isLeagueKey(leagueId)) {
    if (!doc.exists) await ref.set(seedProfile(user, { envAdmin }));
    return NextResponse.json({ ok: true, joined: false, requested: false, reason: "no-league" });
  }

  // The league has to exist. Without this a request — or a membership map —
  // could be seeded with any string a caller invented.
  const leagueDoc = await db().collection("leagues").doc(leagueId).get();
  if (!leagueDoc.exists) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  if (!doc.exists) {
    await ref.set(seedProfile(user, { envAdmin, leagueId }));
  }
  const data = doc.exists ? doc.data() : (await ref.get()).data();

  // Already stands somewhere in this league: nothing to ask for, and nothing to
  // change. An Admin signing back in must not be quietly reduced to a Player,
  // and an account that predates the role map belongs to the legacy league
  // through its old global role — isLeagueMember answers both.
  const member = envAdmin
    || isLeagueMember(data, leagueId, { legacyLeagueId: await legacyLeagueId() });
  if (member) {
    return NextResponse.json({
      ok: true, joined: false, requested: false, reason: "already-a-member", league_id: leagueId,
    });
  }

  if (!wantsRequest) {
    return NextResponse.json({
      ok: true, joined: false, requested: false, reason: "not-requested", league_id: leagueId,
    });
  }

  const result = await fileJoinRequest({ user, leagueId, profile: data });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    joined: false,          // nothing is granted here — an approval does that
    requested: true,
    created: !!result.created,
    league_id: leagueId,
    request_id: result.request.id,
    leagues: Object.keys(normalizeLeagueRoles(data?.[LEAGUE_ROLES_FIELD])).length,
  });
});

// The same profile /api/users/me would write on their first verified visit, and
// with the same standing: none. The map is written as an EMPTY object rather
// than left off, because the legacy fallback keys on the field being ABSENT —
// omitting it would make this brand-new account inherit the legacy league
// through a global role it has no history behind.
function seedProfile(user, { envAdmin = false, leagueId = "" } = {}) {
  const role = envAdmin ? "owner" : "player";
  return {
    display_name: user.name || user.email?.split("@")[0] || "Driver",
    email: user.email || null,
    photo_url: user.picture || null,
    bio: "",
    country: "",
    number: null,
    role,
    // Env-var Owners are Owner in every league by definition, so recording it
    // grants nothing they didn't already have.
    [LEAGUE_ROLES_FIELD]: envAdmin && leagueId ? { [leagueId]: "owner" } : {},
    // Which league they came in through, kept for the record: the map says
    // where they stand NOW, this says where they started — and it is what the
    // discovery page puts at the top of the list.
    ...(leagueId ? { signup_league_id: leagueId } : {}),
    // "Signed up, hasn't been through the door yet." The admin roster reads
    // this so a brand-new account still shows as pending rather than as a
    // fully set-up member the moment its document appears — /api/users/me
    // clears it on the first verified visit. See app/api/admin/users/route.js.
    signup_pending: true,
    created_at: new Date().toISOString(),
  };
}
