import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { isEnvAdmin, withSignedIn } from "@/lib/serverAuth";
import {
  LEAGUE_ROLES_FIELD, directLeagueRole, hasLeagueRoles, isLeagueKey, leagueRolePatch,
  normalizeLeagueRoles,
} from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// Record that this account belongs to a league, as a Player.
//
// ── Why this route exists ──────────────────────────────────────────────────
//
// An authentication account is global; standing in a league is a row in
// Firestore (`users.league_roles` — see lib/leagueRoles.js). Sign-up creates the
// first and, until this existed, nothing created the second: /api/users/me does
// it, but /api/users/me refuses an unverified account, so a brand-new player was
// invisible to every league — including the one whose page they signed up on —
// until they had been to their inbox and come back.
//
// That is the gap this closes. It is the ONE route open to an account that has
// not verified its email yet (withSignedIn), and it is deliberately the smallest
// thing that could be: it writes a Player membership and the profile fields
// their sign-in already told us, and nothing else. Everything the app can
// actually DO still sits behind the verification wall.
//
// It is also what the sign-up form calls with the league the player was looking
// at, so "I joined from League B's page" survives into the database rather than
// being lost the moment the page navigates away.
//
//   body.league_id  the league to join. Falls back to the X-League-Id header,
//                   which api() stamps on every request anyway.
//
// Idempotent, and it never demotes: an account that already holds a role in this
// league keeps it, so pressing sign-in twice — or an Admin re-opening the app —
// can't turn them into a Player.
export const POST = withSignedIn(async (request, ctx, user, headerLeagueId) => {
  const body = await request.json().catch(() => ({}));
  const leagueId = String(body.league_id || headerLeagueId || "").trim();

  // No league in play at all — a pre-migration install, where nothing is
  // partitioned yet. Creating the account is still the right outcome; there is
  // simply no membership to record. Answered as ok so the sign-up form doesn't
  // treat a perfectly normal install as a failure.
  if (!leagueId) {
    return NextResponse.json({ ok: true, joined: false, reason: "no-league" });
  }
  if (!isLeagueKey(leagueId)) {
    return NextResponse.json({ error: "Invalid league id" }, { status: 400 });
  }
  // The league has to exist. Without this the map could be seeded with any
  // string a caller invented, and every reader of it would carry that forever.
  const leagueDoc = await db().collection("leagues").doc(leagueId).get();
  if (!leagueDoc.exists) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  const envAdmin = isEnvAdmin(user.email);
  const role = envAdmin ? "owner" : "player";

  if (!doc.exists) {
    // The same profile /api/users/me would have written on their first verified
    // visit, plus the league they signed up in.
    const profile = {
      display_name: user.name || user.email?.split("@")[0] || "Driver",
      email: user.email || null,
      photo_url: user.picture || null,
      bio: "",
      country: "",
      number: null,
      role,
      [LEAGUE_ROLES_FIELD]: { [leagueId]: role },
      // Which league they came in through, kept for the record: the map says
      // where they are NOW, this says where they started.
      signup_league_id: leagueId,
      // "Signed up, hasn't been through the door yet." The admin roster reads
      // this so a brand-new account still shows as pending rather than as a
      // fully set-up member the moment its document appears — /api/users/me
      // clears it on the first verified visit. See app/api/admin/users/route.js.
      signup_pending: true,
      created_at: new Date().toISOString(),
    };
    await ref.set(profile);
    return NextResponse.json({ ok: true, joined: true, created: true, league_id: leagueId, role });
  }

  const data = doc.data();

  // Already stands somewhere in this league: leave it exactly as it is. An Admin
  // signing back in must not be quietly reduced to a Player.
  if (directLeagueRole(data, leagueId) != null) {
    return NextResponse.json({ ok: true, joined: false, reason: "already-a-member", league_id: leagueId });
  }

  // An account that predates `league_roles` entirely is left alone for the same
  // reason /api/users/me leaves it alone: its old global role still answers
  // inside the legacy league, and stamping "player" here would demote an
  // existing admin who happened to sign in before the containment migration was
  // run. The migration is what writes their standing down properly.
  if (!hasLeagueRoles(data)) {
    return NextResponse.json({ ok: true, joined: false, reason: "legacy-account", league_id: leagueId });
  }

  // merge:true deep-merges the map, so this adds one key and leaves this
  // account's standing in every other league untouched.
  await ref.set(leagueRolePatch(leagueId, role), { merge: true });
  return NextResponse.json({
    ok: true, joined: true, created: false, league_id: leagueId, role,
    leagues: Object.keys(normalizeLeagueRoles(data[LEAGUE_ROLES_FIELD])).length + 1,
  });
});
