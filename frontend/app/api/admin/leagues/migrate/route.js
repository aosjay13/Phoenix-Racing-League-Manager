import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withOwner } from "@/lib/serverAuth";
import { SCOPED_COLLECTIONS } from "@/lib/backup";

export const dynamic = "force-dynamic";

// The name the very first (default) league is created with when there are no
// leagues yet — the existing data's home. Renameable afterward in League
// Settings.
const DEFAULT_LEAGUE_NAME = "Prodigy Racing Association";

// The per-league collection list lives in lib/backup.js — the backup engine
// needs exactly the same partition map, and two copies of it would drift the
// first time a collection is added. `users` and `claim_requests` are
// deliberately not in it: those belong to people (accounts span leagues), not
// to a single league.

// The "Containment" migration. Owner-only, IDEMPOTENT and ADDITIVE-ONLY:
//   • It never deletes or overwrites any field — it only SETS `league_id` on
//     docs that don't have one yet.
//   • Docs that already carry a league_id are skipped, so re-running is safe
//     and a partial/interrupted run simply resumes where it left off.
// Steps:
//   1. Ensure a default league exists (create it if the collection is empty).
//   2. Stamp every scoped doc missing league_id with that league's id.
// Returns a per-collection count of how many docs were stamped, so the result
// is verifiable.
export const POST = withOwner(async (request, ctx, user) => {
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

  const total = Object.values(stamped).reduce((a, b) => a + b, 0);
  return NextResponse.json({ ok: true, league, created, stamped, total });
});
