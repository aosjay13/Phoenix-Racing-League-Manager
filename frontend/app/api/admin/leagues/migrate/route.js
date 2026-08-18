import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { forgetLegacyLeague, withGlobalOwner } from "@/lib/serverAuth";
import { SCOPED_COLLECTIONS } from "@/lib/backup";
import { LEAGUE_ROLES_FIELD, seedLeagueRoles } from "@/lib/leagueRoles";

export const dynamic = "force-dynamic";

// The name the very first (default) league is created with when there are no
// leagues yet — the existing data's home. Renameable afterward in League
// Settings.
const DEFAULT_LEAGUE_NAME = "Prodigy Racing Association";

// The per-league collection list lives in lib/backup.js — the backup engine
// needs exactly the same partition map, and two copies of it would drift the
// first time a collection is added. `users` and `claim_requests` are
// deliberately not in it: those belong to people (an account spans leagues), and
// they are partitioned differently — see the `league_roles` step below.

// The "Containment" migration. Application-Owner-only, IDEMPOTENT and
// ADDITIVE-ONLY:
//   • It never deletes or overwrites any field — it only SETS `league_id` on
//     docs that don't have one yet, and only ADDS the default league's key to a
//     user's `league_roles` map.
//   • Docs that already carry a league_id are skipped, so re-running is safe
//     and a partial/interrupted run simply resumes where it left off.
// Steps:
//   1. Ensure a default league exists (create it if the collection is empty).
//   2. Stamp every scoped doc missing league_id with that league's id.
//   3. Give every existing ACCOUNT its standing in that league, copied from the
//      old global `role` field.
// Returns a per-collection count of how many docs were stamped, so the result
// is verifiable.
//
// ── Step 3, and why nobody gets locked out ─────────────────────────────────
//
// Roles used to be one global string per account. They are now a map keyed by
// league (see lib/leagueRoles.js), and an account with no entry for a league is
// unaffiliated with it. Left alone, that would mean every existing account —
// including the league's own Owner and Admins — woke up as a stranger to the
// league they run.
//
// Three things stop that, and all three are in place before this ever runs:
//
//   1. An UNMIGRATED account (no `league_roles` field at all) still resolves its
//      old global `role` inside the legacy league, so the app is correct even if
//      this migration is never run.
//   2. ADMIN_EMAILS accounts are permanent Owners of every league regardless of
//      what any map says — the escape hatch of last resort.
//   3. This step, which writes the fallback down as real data: every account's
//      existing role, recorded against the default league. It only ADDS the key
//      when it is missing, so re-running can never demote somebody who has since
//      been given a different role here.
export const POST = withGlobalOwner(async (request, ctx, user) => {
  // 1. Resolve (or create) the containment league.
  const leaguesSnap = await db().collection("leagues").get();
  const created = leaguesSnap.empty;
  let league;
  if (created) {
    const doc = {
      name: DEFAULT_LEAGUE_NAME,
      logo_url: null,
      description: null,
      owner_id: user.uid,
      created_at: new Date().toISOString(),
      created_by: user.uid,
    };
    const ref = await db().collection("leagues").add(doc);
    league = { id: ref.id, ...doc };
    // The legacy-league memo in serverAuth was resolved when there were no
    // leagues at all; drop it so the very next request sees the one just made.
    forgetLegacyLeague();
  } else {
    // Oldest league is the containment target for any still-unstamped legacy data.
    const docs = leaguesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    league = docs[0];
  }

  // 2. Backfill league_id on every scoped doc that lacks one.
  const stamped = {};
  for (const col of SCOPED_COLLECTIONS) {
    const snap = await db().collection(col).get();
    const pending = snap.docs.filter(d => d.data().league_id == null);
    stamped[col] = pending.length;
    // Firestore batches cap at 500 writes; stay well under.
    for (let i = 0; i < pending.length; i += 450) {
      const batch = db().batch();
      for (const d of pending.slice(i, i + 450)) {
        batch.update(d.ref, { league_id: league.id });
      }
      await batch.commit();
    }
  }

  // 3. Give every account its membership of the default league, carried over
  //    from the role it already had. Accounts that already have an entry for
  //    this league are skipped untouched.
  const usersSnap = await db().collection("users").get();
  const seeds = [];
  for (const doc of usersSnap.docs) {
    const map = seedLeagueRoles(doc.data(), league.id);
    if (map) seeds.push({ ref: doc.ref, map });
  }
  for (let i = 0; i < seeds.length; i += 450) {
    const batch = db().batch();
    for (const s of seeds.slice(i, i + 450)) {
      batch.set(s.ref, { [LEAGUE_ROLES_FIELD]: s.map }, { merge: true });
    }
    await batch.commit();
  }
  stamped.users = seeds.length;

  const total = Object.values(stamped).reduce((a, b) => a + b, 0);
  return NextResponse.json({ ok: true, league, created, stamped, total, members: seeds.length });
});
