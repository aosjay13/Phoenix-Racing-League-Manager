import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId } from "@/lib/serverAuth";
import { applyRosterPlan, planRosterImport } from "@/lib/rosterImport";
import { loadDriverPool, loadGameNames, serializeMatches } from "@/lib/driverMatchServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// Bulk roster import — the painless season rollover.
//
//   POST { season_id, source: "series" }               → every driver who has
//         ever raced in this season's SERIES (across all its seasons)
//   POST { season_id, source: "season", from_season_id } → clone one season's
//         roster. Any season will do, including one from another series in the
//         league, which is how a brand-new series starts with the drivers it
//         already has instead of thirty names typed in again.
//   POST { …, preview: true }                          → say what a run WOULD
//         do and change nothing
//   POST { …, decisions: { <row key>: { action, driver_id } } }
//                                                      → run it, with the
//         doubtful rows settled by the admin
//
// Two kinds of duplicate are stopped here, and they're different problems:
//
//   • the same person twice on THIS roster — a driver already on the target
//     season is skipped, never duplicated and never an error, so the button is
//     safe to press twice or to top up a half-built roster;
//   • the same person twice in the APP — every imported entry comes out
//     carrying a `driver_id`, resolved against the global driver pool through
//     every name that driver answers to (profile name, per-game names,
//     PSN/Xbox/Discord/iRacing usernames, former names — see
//     lib/driverMatch.js). Anyone who genuinely isn't in the pool gets a driver
//     profile created for them as part of the import, so a roster never again
//     ends up full of entries attached to nobody.
//
// A candidate that RESEMBLES an existing driver without matching one is never
// resolved on its own: it comes back as `check`, and the dialog makes the admin
// say which. That is the prompt this whole thing was missing.
//
// What carries over: the driver's name, car number, driver_id and linked
// account. What doesn't: team and class, which are per-season records whose ids
// mean nothing in the new season — assign those on the roster afterwards.
//
// The matching rules themselves live in lib/rosterImport.js + lib/driverMatch.js
// so they can be tested without a database.
const SOURCES = new Set(["series", "season"]);

const handlePOST = withAdmin(async (request, ctx, user) => {
  const { season_id, source, from_season_id, preview = false, decisions = {} } = await request.json();
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
    return NextResponse.json({
      ok: true, imported: 0, skipped: 0, drivers: [], rows: [],
      summary: { total: 0, linked: 0, check: 0, new: 0, on_roster: 0, unusable: 0 },
      message: "No other seasons to import from.",
    });
  }

  const leagueId = getRequestLeagueId(request);
  const [existingSnap, pool, games, ...sourceSnaps] = await Promise.all([
    db().collection("entries").where("season_id", "==", season_id).get(),
    loadDriverPool(leagueId),
    loadGameNames(leagueId),
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
  const plan = planRosterImport(existing, candidates, pool, { games });

  // The names behind each resolved driver_id, so the review table can say
  // "imports under Ryan Maynard" rather than showing an id.
  const poolNames = Object.fromEntries(pool.map(d => [d.id, d.name]));
  const rows = plan.rows.map(r => ({
    ...r,
    driver_name: r.driver_id ? poolNames[r.driver_id] ?? null : null,
    matches: serializeMatches(r.matches),
  }));

  if (preview) {
    return NextResponse.json({ ok: true, preview: true, rows, summary: plan.summary });
  }

  const { create, skipped, needsDriver } = applyRosterPlan(plan.rows, decisions);

  // Everyone who genuinely isn't in the app yet gets a driver profile, so the
  // entries this writes are never orphaned. Done first, in one batch, and the
  // new ids are stamped onto the entries below.
  const now = new Date().toISOString();
  for (let i = 0; i < needsDriver.length; i += 450) {
    const batch = db().batch();
    for (const row of needsDriver.slice(i, i + 450)) {
      const ref = db().collection("drivers").doc();
      batch.set(ref, {
        name: row.name,
        user_id: row.user_id || "",
        notes: "",
        ...(leagueId ? { league_id: leagueId } : {}),
        created_at: now,
        created_by: user.uid,
        // Records that this profile was made by a roster import rather than
        // typed in, which is worth knowing when tidying a league up later.
        created_from_import: season_id,
      });
      create[row.at].driver_id = ref.id;
    }
    await batch.commit();
  }

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
    // How many of those were attached to a driver the app already had, and how
    // many needed a profile of their own — the two halves of "everyone lines
    // up with a current driver, and if they don't, one is made".
    linked: toCreate.length - needsDriver.length,
    created_drivers: needsDriver.length,
    drivers: toCreate.map(d => d.name),
    summary: plan.summary,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
