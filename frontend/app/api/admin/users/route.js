import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase";
import { withAdmin, isEnvAdmin } from "@/lib/serverAuth";
import { normalizeRole, roleLevel } from "@/lib/roles";

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

// Admin-only: the full account roster — with emails, roles, verification state,
// and the linked driver profile for each user — powering the Admin ▸ User
// Accounts dashboard. (The public /api/users route deliberately strips email +
// role.)
export const GET = withAdmin(async () => {
  const [usersSnap, driversSnap, authAccounts] = await Promise.all([
    db().collection("users").get(),
    db().collection("drivers").get(),
    // Never let an Auth hiccup take down the dashboard — fall back to the
    // Firestore-only roster, which is what this route used to return.
    listAuthAccounts().catch(err => { console.error("listUsers failed", err); return null; }),
  ]);

  // uid -> linked driver profile (first match wins; the link lives on the
  // driver doc as drivers.user_id — see /api/users/[uid] and the roster).
  const driverByUser = {};
  for (const d of driversSnap.docs) {
    const uid = d.data().user_id;
    if (uid && !driverByUser[uid]) driverByUser[uid] = { id: d.id, name: d.data().name || "Driver" };
  }

  const profileByUid = {};
  for (const doc of usersSnap.docs) profileByUid[doc.id] = doc.data();

  const authByUid = {};
  for (const rec of authAccounts || []) authByUid[rec.uid] = rec;

  // Union of both sides: accounts with a profile, accounts that only exist in
  // Auth, and (defensively) profiles whose Auth identity has since been removed.
  const uids = new Set([...Object.keys(profileByUid), ...Object.keys(authByUid)]);

  const users = [...uids].map(uid => {
    const data = profileByUid[uid] || null;
    const auth = authByUid[uid] || null;
    const linked = driverByUser[uid] || null;
    const email = data?.email || auth?.email || null;
    const envAdmin = isEnvAdmin(email);
    // Env admins are permanent Owners even if their doc hasn't been synced yet.
    const role = envAdmin ? "owner" : normalizeRole(data?.role || "player");
    const created = data?.created_at || isoOrNull(auth?.metadata?.creationTime);
    return {
      uid,
      display_name: data?.display_name || auth?.displayName || null,
      email,
      photo_url: data?.photo_url || auth?.photoURL || null,
      role,
      role_level: roleLevel(role),
      env_admin: envAdmin,
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
    };
  });

  users.sort((a, b) => String(a.display_name || a.email).localeCompare(String(b.display_name || b.email)));
  return NextResponse.json(users);
});

// Firebase Auth reports timestamps as UTC date strings; the dashboard compares
// created_at as ISO text, so normalize before handing them over.
function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
