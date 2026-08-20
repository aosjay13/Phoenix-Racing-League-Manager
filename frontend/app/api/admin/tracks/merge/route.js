import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { withStatsRefresh } from "@/lib/statsRefresh";

export const dynamic = "force-dynamic";

// Merge duplicate venues into one, under a name the admin chooses.
//
// The same circuit often ends up in the pool two or three times — "Daytona",
// "Daytona Intl Speedway", a free-text spelling typed straight into a race
// before the Tracks database existed. This re-points every race held at the
// losing venues onto the survivor and stamps the chosen name on them, then
// deletes the loser docs.
//
// Nothing is lost: a venue's whole history (its leaderboard, past winners, lap
// records, each driver's per-track stats) is derived from the races that point
// at it — see lib/trackStatsServer.js and lib/careerStatsServer.js — so moving
// the races moves all of it. Results reference entries, not tracks, and are
// never touched.
//
// Body: { from_ids: [...], into_id, name }
//   from_ids — the duplicates to fold in and delete
//   into_id  — the venue that survives (keeps its id, so existing links work)
//   name     — what the merged venue is called; defaults to the survivor's

const FILLABLE = ["location", "length", "track_type", "logo_url", "notes"];

const blank = v => !String(v ?? "").trim();

const handlePOST = withAdmin(async (request) => {
  const body = await request.json();
  const intoId = body.into_id;
  // Accept one id or many; a duplicate list containing the survivor is a no-op
  // for that entry rather than an error.
  const fromIds = [...new Set((Array.isArray(body.from_ids) ? body.from_ids : [body.from_id])
    .filter(Boolean).filter(id => id !== intoId))];
  if (!intoId || !fromIds.length) {
    return NextResponse.json({ error: "into_id and at least one different from_id required" }, { status: 400 });
  }

  const intoDoc = await db().collection("tracks").doc(intoId).get();
  if (!intoDoc.exists) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  const into = intoDoc.data();

  const fromDocs = await Promise.all(fromIds.map(id => db().collection("tracks").doc(id).get()));
  for (const d of fromDocs) {
    if (!d.exists) return NextResponse.json({ error: "Track not found" }, { status: 404 });
    // Leagues are separate worlds — merging across them would drag one league's
    // races into another's venue.
    if ((d.data().league_id || null) !== (into.league_id || null)) {
      return NextResponse.json({ error: "Those tracks are in different leagues" }, { status: 400 });
    }
  }

  const finalName = String(body.name ?? into.name ?? "").trim() || String(into.name || "").trim();
  if (!finalName) return NextResponse.json({ error: "name required" }, { status: 400 });

  // Every race to re-point: those linked to a losing venue by id, plus legacy
  // free-text races that only ever stored its NAME (no track_id) — the same
  // pairing lib/trackStatsServer.js counts as "held here", so a merge captures
  // exactly the history the venue's profile was showing. The survivor's own
  // races are collected too: they don't move, but they carry the venue name as
  // text and so have to follow a rename.
  const raceRefs = new Map();       // race id -> { ref, update }
  const movedIds = new Set();       // races that changed venue (vs. renamed only)
  const addRace = (doc, update) => {
    const prev = raceRefs.get(doc.id);
    raceRefs.set(doc.id, { ref: doc.ref, update: { ...(prev?.update || {}), ...update } });
    if (update.track_id) movedIds.add(doc.id);
  };

  const names = new Set();
  const addName = n => { const t = String(n || "").trim(); if (t) names.add(t); };

  for (const d of fromDocs) {
    const data = d.data();
    addName(data.name);
    (data.merged_names || []).forEach(addName);   // carry transitive history
    const [byId, byName] = await Promise.all([
      db().collection("races").where("track_id", "==", d.id).get(),
      String(data.name || "").trim()
        ? db().collection("races").where("track", "==", String(data.name).trim()).get()
        : Promise.resolve({ docs: [] }),
    ]);
    for (const r of byId.docs) addRace(r, { track_id: intoId, track: finalName });
    for (const r of byName.docs) {
      const race = r.data();
      // A race pinned to some OTHER venue's id only matched by a coincidence of
      // names — leave it where it is. Same for a race in another league, which
      // may legitimately have its own venue by that name (a race from before
      // leagues existed carries no league_id and is treated as in-league).
      const tid = race.track_id;
      const otherLeague = race.league_id && race.league_id !== (into.league_id || null);
      if ((!tid || tid === d.id) && !otherLeague) addRace(r, { track_id: intoId, track: finalName });
    }
  }

  // The survivor's own races: renamed only, never re-pointed.
  const ownRaces = await db().collection("races").where("track_id", "==", intoId).get();
  for (const r of ownRaces.docs) {
    if (r.data().track !== finalName) addRace(r, { track: finalName });
  }

  const raceUpdates = [...raceRefs.values()];
  for (let i = 0; i < raceUpdates.length; i += 450) {
    const batch = db().batch();
    for (const { ref, update } of raceUpdates.slice(i, i + 450)) batch.update(ref, update);
    await batch.commit();
  }

  // The survivor keeps everything it already had; blank details are filled in
  // from the venues folded into it (first one that has the field), so merging a
  // sparse duplicate that happened to carry the location or the logo doesn't
  // throw that detail away.
  const updates = { name: finalName };
  for (const field of FILLABLE) {
    if (!blank(into[field])) continue;
    const donor = fromDocs.map(d => d.data()).find(d => !blank(d[field]));
    if (donor) updates[field] = donor[field];
  }
  // Names this venue used to be listed under — provenance for an admin looking
  // at the merged track later, and never the venue's own current name.
  updates.merged_names = [...new Set([...(into.merged_names || []), ...names])]
    .filter(n => n.toLowerCase() !== finalName.toLowerCase());

  await db().collection("tracks").doc(intoId).update(updates);
  for (const d of fromDocs) await d.ref.delete();

  return NextResponse.json({
    ok: true,
    track: { id: intoId, ...into, ...updates },
    merged_ids: fromIds,
    tracks_merged: fromDocs.length,
    races_moved: movedIds.size,
    races_renamed: raceUpdates.length - movedIds.size,
    merged_names: updates.merged_names,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
