import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withAdmin } from "@/lib/serverAuth";
import { countTrackRaces, findDuplicateTrackGroups } from "@/lib/trackMerge";

export const dynamic = "force-dynamic";

// The Tracks pool, read once and searched for the same circuit entered more
// than once.
//
//   GET /api/admin/tracks/duplicates
//     → { groups: [...], tracks_scanned, races_scanned }
//
// Why this is a request at all, when lib/trackMerge.js is pure and the browser
// already holds the track list: the RACE COUNTS. "Fold these three into one" is
// not a question anybody can answer from three names — an admin needs to see
// that nine races were run at this one and one at that one, because that is
// what says which is the real venue and which is the spelling somebody used
// once. Counting them means reading the races collection, so the scan happens
// where the races are.
//
// Read-only. It writes nothing and merges nothing; it hands back a reading
// list, and /api/admin/tracks/merge does the work once an admin has ticked
// what they agree with.

const handleGET = withAdmin(async (request, _ctx, _user, _role, leagueId) => {
  const [trackSnap, raceSnap] = await Promise.all([
    db().collection("tracks").get(),
    db().collection("races").get(),
  ]);

  // Scoped in memory rather than by query, because a legacy document carries no
  // league_id at all and a `where("league_id", "==", …)` would hide it — see
  // docInLeague. A half-migrated league would otherwise be told it has no
  // duplicates while looking straight at three of them.
  const tracks = trackSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => docInLeague(t, leagueId));
  const races = raceSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => docInLeague(r, leagueId));

  return NextResponse.json({
    ok: true,
    groups: findDuplicateTrackGroups(tracks, { raceCounts: countTrackRaces(tracks, races) }),
    tracks_scanned: tracks.length,
    races_scanned: races.length,
  });
});

export const GET = handleGET;
