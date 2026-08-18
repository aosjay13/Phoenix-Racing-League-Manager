import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { docInLeague, legacyLeagueId, withAdmin, isEnvAdmin } from "@/lib/serverAuth";
import { roleLevel } from "@/lib/roles";
import { isLeagueMember, leagueIdsFor, leagueRoleFor } from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// Every account that exists in Firebase Auth, paged out in full. This — not the
// Firestore `users` collection — is the real signup roster: a user doc is only
// written the first time an account makes a *verified* API call (see
// /api/users/me), so an account that signed up, or even verified, without
// returning to the app has no doc at all. Listing Auth directly is what keeps
// those accounts from being invisible to the league owner.
async function listAuthAccounts() {
  const out = [];
  let pageToken;
  do {
    const page = await adminAuth().listUsers(1000, pageToken);
    out.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

// Admin-only: THIS LEAGUE'S account roster — with emails, per-league roles,
// verification state, and the driver profile each user races as here — powering
// the Admin ▸ User Accounts dashboard. (The public /api/users route deliberately
// strips email + role.)
//
// ── What "this league's roster" means ──────────────────────────────────────
//
// An account is listed when it has a MEMBERSHIP of the active league: an entry
// in its `league_roles` map keyed by this league's id (any role, Player
// included), or — for an account that predates that map — the legacy league,
// which is where all its history already is. Everyone else is a stranger to
// this league and is left out, so League B's staff never see who plays in
// League A, let alone get to edit them.
//
// The account roster used to be the whole Firebase Auth user list, and that was
// load-bearing: it is what stops a brand-new signup being invisible until they
// happen to open the app. Isolating the list would have quietly taken that away
// — a new account belongs to no league yet, so nothing would ever show it. So
// unaffiliated accounts are still available, but only on request
// (`?include_unaffiliated=1`), returned flagged `in_league: false`, and rendered
// as a separate "not in this league yet" section. Giving one a role is what
// makes it a member here; until then it is listed, not governed.
export const GET = withAdmin(async (request, ctx, admin, role, leagueId) => {
  const includeUnaffiliated =
    new URL(request.url).searchParams.get("include_unaffiliated") === "1";

  const [usersSnap, driversSnap, authAccounts, legacy] = await Promise.all([
    db().collection("users").get(),
    db().collection("drivers").get(),
    // Never let an Auth hiccup take down the dashboard — fall back to the
    // Firestore-only roster, which is what this route used to return.
    listAuthAccounts().catch(err => { console.error("listUsers failed", err); return null; }),
    leagueId ? legacyLeagueId() : Promise.resolve(null),
  ]);

  // uid -> the driver profile they race as IN THIS LEAGUE (the link lives on the
  // driver doc as drivers.user_id — see /api/users/[uid] and the roster). One
  // per league: the same account can hold a different profile in each.
  const driverByUser = {};
  for (const d of driversSnap.docs) {
    const data = d.data();
    if (!data.user_id || !docInLeague(data, leagueId)) continue;
    if (!driverByUser[data.user_id]) driverByUser[data.user_id] = { id: d.id, name: data.name || "Driver" };
  }

  const profileByUid = {};
  for (const doc of usersSnap.docs) profileByUid[doc.id] = doc.data();

  const authByUid = {};
  for (const rec of authAccounts || []) authByUid[rec.uid] = rec;

  // Union of both sides: accounts with a profile, accounts that only exist in
  // Auth, and (defensively) profiles whose Auth identity has since been removed.
  const uids = new Set([...Object.keys(profileByUid), ...Object.keys(authByUid)]);

  const rows = [];
  for (const uid of uids) {
    const data = profileByUid[uid] || null;
    const auth = authByUid[uid] || null;
    const linked = driverByUser[uid] || null;
    const email = data?.email || auth?.email || null;
    const envAdmin = isEnvAdmin(email);

    // Membership decides whether this row belongs on this league's roster at
    // all. Env admins are members of every league by definition; an account
    // holding one of this league's driver profiles is plainly one of its
    // players even if its role map somehow hasn't caught up.
    const member = !leagueId
      || envAdmin
      || !!linked
      || (!!data && isLeagueMember(data, leagueId, { legacyLeagueId: legacy }));
    if (!member && !includeUnaffiliated) continue;

    // The role IN THIS LEAGUE. Env admins are permanent Owners everywhere, even
    // if their doc hasn't been synced yet.
    const leagueRole = envAdmin
      ? "owner"
      : (member ? leagueRoleFor(data, leagueId, { legacyLeagueId: legacy }) : "player");
    const created = data?.created_at || isoOrNull(auth?.metadata?.creationTime);
    rows.push({
      uid,
      display_name: data?.display_name || auth?.displayName || null,
      email,
      photo_url: data?.photo_url || auth?.photoURL || null,
      role: leagueRole,
      role_level: roleLevel(leagueRole),
      env_admin: envAdmin,
      // Is this account a member of the league being viewed? False rows only
      // appear when the caller asked for them, and the UI shows them in their
      // own "not in this league" section — they can be given a role (which
      // joins them) but nothing else.
      in_league: member,
      // How many leagues this account belongs to in total. The dashboard uses it
      // to say whether removing them here deletes the account outright or only
      // takes them off this league's books.
      league_count: envAdmin ? null : leagueIdsFor(data).length,
      created_at: created,
      // Verified in Firebase Auth — env admins are verification-exempt
      // (see lib/serverAuth isVerified), so they always read as verified here.
      email_verified: envAdmin || !!auth?.emailVerified,
      // Whether this account has ever completed a verified request and had its
      // user doc created. False means "signed up but never got through the door".
      has_profile: !!data,
      // Null when Auth couldn't be listed, so the UI can stay quiet about
      // verification rather than claiming everyone is unverified.
      auth_known: !!authAccounts,
      last_sign_in: isoOrNull(auth?.metadata?.lastSignInTime),
      driver_id: linked?.id || null,
      driver_name: linked?.name || null,
    });
  }

  rows.sort((a, b) => String(a.display_name || a.email).localeCompare(String(b.display_name || b.email)));
  return NextResponse.json(rows);
});

// Firebase Auth reports timestamps as UTC date strings; the dashboard compares
// created_at as ISO text, so normalize before handing them over.
function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
