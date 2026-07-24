import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId } from "@/lib/serverAuth";
import { planRosterImport } from "@/lib/rosterImport";

export const dynamic = "force-dynamic";

// Bulk roster import — the painless season rollover.
//
//   POST { season_id, source: "series" }               → every driver who has
//         ever raced in this season's SERIES (across all its seasons)
//   POST { season_id, source: "season", from_season_id } → clone one past
//         season's roster
//
// Deduplication is the whole point: a driver already on the target season's
// roster is SKIPPED, never duplicated and never an error, so the button is safe
// to press twice (or to top up a roster that's already half-built). Identity is
// matched the same way the rest of the app matches drivers — global driver_id
// first, then linked account, then lowercased name — so someone pulled in under
// a series alias still resolves to the person already on the roster.
//
// What carries over: the driver's name, car number, global driver_id and linked
// account. What doesn't: team and class, which are per-season records whose ids
// mean nothing in the new season — assign those on the roster afterwards.
//
// The matching rules themselves live in lib/rosterImport.js (planRosterImport)
// so they can be tested without a database.
const SOURCES = new Set(["series", "season"]);

export const POST = withAdmin(async (request, ctx, user) => {
  const { season_id, source, from_season_id } = await request.json();
  if (!season_id) return NextResponse.json({ error: "season_id required" }, { status: 400 });
  if (!SOURCES.has(source)) {
    return NextResponse.json({ error: 'source must be "series" or "season"' }, { status: 400 });
  }

  const targetDoc = await db().collection("seasons").doc(season_id).get();
  if (!targetDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const target = targetDoc.data();

  // Resolve which seasons to pull drivers FROM.
  let sourceSeasonIds;
  if (source === "season") {
    if (!from_season_id) return NextResponse.json({ error: "from_season_id required" }, { status: 400 });
    if (from_season_id === season_id) {
      return NextResponse.json({ error: "Pick a different season to import from." }, { status: 400 });
    }
    sourceSeasonIds = [from_season_id];
  } else {
    if (!target.series_id) {
      return NextResponse.json({ error: "This season isn't attached to a series." }, { status: 400 });
    }
    const snap = await db().collection("seasons").where("series_id", "==", target.series_id).get();
    sourceSeasonIds = snap.docs.map(d => d.id).filter(id => id !== season_id);
  }
  if (!sourceSeasonIds.length) {
    return NextResponse.json({ ok: true, imported: 0, skipped: 0, drivers: [], message: "No other seasons to import from." });
  }

  const [existingSnap, ...sourceSnaps] = await Promise.all([
    db().collection("entries").where("season_id", "==", season_id).get(),
    ...sourceSeasonIds.map(id => db().collection("entries").where("season_id", "==", id).get()),
  ]);

  // Candidates NEWEST first. planRosterImport keeps the first entry it sees for
  // a driver, so a driver who raced several seasons of this series carries over
  // the name and car number they ran most recently — not the one they used
  // years ago.
  const candidates = [];
  for (const snap of sourceSnaps) {
    for (const d of snap.docs) candidates.push({ id: d.id, ...d.data() });
  }
  candidates.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  const existing = existingSnap.docs.map(d => d.data());
  const { create, skipped } = planRosterImport(existing, candidates);

  const leagueId = getRequestLeagueId(request);
  const now = new Date().toISOString();
  const toCreate = create.map(row => ({
    season_id,
    ...(leagueId ? { league_id: leagueId } : {}),
    ...row,
    created_at: now,
    created_by: user.uid,
  }));

  // Firestore batches cap at 500 writes; a 40-driver roster fits in one, but
  // chunk anyway so a whole-series import of any size goes through.
  for (let i = 0; i < toCreate.length; i += 450) {
    const batch = db().batch();
    for (const doc of toCreate.slice(i, i + 450)) batch.set(db().collection("entries").doc(), doc);
    await batch.commit();
  }

  return NextResponse.json({
    ok: true,
    imported: toCreate.length,
    skipped,
    drivers: toCreate.map(d => d.name),
  });
});
