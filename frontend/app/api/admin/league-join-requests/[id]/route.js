import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { ROLE_LABELS } from "@/lib/roles";
import {
  LEAGUE_ROLES_FIELD, leagueRolePatch, normalizeLeagueRoles,
} from "@/lib/leagueRoles";
import {
  JOIN_APPROVED, JOIN_COLLECTION, JOIN_DENIED, JOIN_MESSAGE_MAX, JOIN_PENDING, scopeCoversLeague,
} from "@/lib/leagueJoin";
import { withJoinApprover } from "@/lib/leagueJoinServer";

export const dynamic = "force-dynamic";

// Approve or deny one request to join a league.
//
//   body.action = "approve"  → the account becomes a PLAYER of that league
//   body.action = "deny"     → nothing is granted; the reason is recorded
//
// ── What approving actually writes ─────────────────────────────────────────
//
// One key of one map: `users/<uid>.league_roles[<leagueId>] = "player"`, merged,
// so this account's standing in every other league is untouched and two admins
// approving in two leagues at the same moment can't clobber each other. That one
// key is what makes the account a member — it is what puts them on this league's
// user roster, lets them be linked to one of its driver profiles, and lets them
// sign up for its series. Nothing about any OTHER league changes, and no staff
// role is ever handed out here: Player is the floor, and promoting somebody is a
// separate, deliberate act on User Accounts.
//
// ── The permission rule ────────────────────────────────────────────────────
//
// withJoinApprover establishes which leagues this account runs; the row's own
// `league_id` is then checked against that set. So an Admin of League B cannot
// approve somebody into League A even holding the request's id — the refusal is
// on the row, not on the screen that showed it. The application Owner passes for
// every league.
export const PATCH = withJoinApprover(async (request, ctx, user, scope) => {
  const { id } = ctx.params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "deny" ? "deny" : body.action === "approve" ? "approve" : null;
  if (!action) {
    return NextResponse.json({ error: 'action must be "approve" or "deny"' }, { status: 400 });
  }

  const ref = db().collection(JOIN_COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const req = { id: doc.id, ...doc.data() };

  if (!scopeCoversLeague(scope, req.league_id)) {
    // Deliberately not a 404: the row exists, and pretending otherwise would
    // make a genuine permission problem look like a broken link.
    return NextResponse.json(
      { error: `You don't run ${req.league_name || "that league"}, so this isn't yours to decide.` },
      { status: 403 },
    );
  }
  if ((req.status || JOIN_PENDING) !== JOIN_PENDING) {
    return NextResponse.json(
      { error: "Somebody has already decided this request.", code: "already-resolved" },
      { status: 409 },
    );
  }

  // The league still has to exist. Approving into a deleted league would write a
  // membership key nobody can ever see or remove.
  const leagueDoc = await db().collection("leagues").doc(req.league_id).get();
  if (!leagueDoc.exists) {
    return NextResponse.json(
      { error: "That league no longer exists.", code: "league-gone" }, { status: 409 });
  }

  const actorDoc = await db().collection("users").doc(user.uid).get();
  const actorName = actorDoc.exists
    ? (actorDoc.data().display_name || user.email || "Staff")
    : (user.email || "Staff");

  const resolution = {
    status: action === "approve" ? JOIN_APPROVED : JOIN_DENIED,
    resolved_at: new Date().toISOString(),
    resolved_by: user.uid,
    resolved_by_name: actorName,
    reason: String(body.reason || "").trim().slice(0, JOIN_MESSAGE_MAX) || null,
  };

  if (action === "deny") {
    await ref.set(resolution, { merge: true });
    return NextResponse.json({ ok: true, id, status: resolution.status, granted: false });
  }

  const userRef = db().collection("users").doc(req.uid);
  const targetDoc = await userRef.get();
  if (!targetDoc.exists) {
    // The account has been deleted since it asked. Close the row rather than
    // leaving a job in the queue that can never be done.
    await ref.set({ ...resolution, status: JOIN_DENIED, reason: "The account no longer exists." },
      { merge: true });
    return NextResponse.json(
      { error: "That account no longer exists, so the request was closed." }, { status: 409 });
  }

  const existing = normalizeLeagueRoles(targetDoc.data()?.[LEAGUE_ROLES_FIELD]);
  const already = Object.prototype.hasOwnProperty.call(existing, req.league_id);
  if (!already) {
    const patch = leagueRolePatch(req.league_id, "player");
    if (!patch) {
      return NextResponse.json({ error: "That league's id can't be recorded." }, { status: 409 });
    }
    await userRef.set(patch, { merge: true });
  }
  await ref.set(resolution, { merge: true });

  return NextResponse.json({
    ok: true,
    id,
    status: resolution.status,
    granted: !already,
    league_id: req.league_id,
    league_name: leagueDoc.data()?.name || req.league_name || "League",
    user_name: req.user_name || "That account",
    // What they now hold there. Said back so the toast doesn't have to guess.
    role: already ? existing[req.league_id] : "player",
    role_label: ROLE_LABELS[already ? existing[req.league_id] : "player"] || "Player",
  });
});
