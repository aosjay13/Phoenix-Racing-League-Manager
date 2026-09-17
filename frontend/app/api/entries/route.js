import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";
import { docInLeague, getRequestLeagueId, getRequestUser, scopeByLeague } from "@/lib/serverAuth";
import { findRosterEntry, reusePatch } from "@/lib/rosterEntry";
import { syncLineupFromEntry } from "@/lib/teamsServer";
import { revalidateStats } from "@/lib/statsCache";

// A season's roster: one entry per driver (see lib/rosterEntry.js for why that
// matters and how "the same driver" is decided).
//
// Creating an entry for somebody who already has one ANSWERS WITH THE ENTRY THEY
// HAVE instead of writing a second. Adding a driver twice is not a mistake worth
// refusing — it is what an admin does when they're entering a class's grid and
// the driver isn't on it, or when the "is this someone you already have?" dialog
// is answered "yes, that's them" — it just must not end in two roster rows for
// one person, with a season's results split between them.
//
// The screens ask this question too, each in their own words; this is the answer
// that cannot be forgotten, and the one a script posting straight at the API
// gets as well.
async function reuseExistingEntry(body, request) {
  const seasonId = String(body?.season_id ?? "").trim();
  // No season is an invalid create, not a duplicate — let the field check answer
  // it, so the caller is told "season_id required" rather than nothing at all.
  if (!seasonId) return null;

  const leagueId = getRequestLeagueId(request);
  const snap = await scopeByLeague(db().collection("entries").where("season_id", "==", seasonId), leagueId).get();
  const roster = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => docInLeague(e, leagueId));

  const existing = findRosterEntry(roster, body);
  if (!existing) return null;

  // Reusing still honours what the create was FOR: the class whose grid the
  // driver was added to is folded into the entry they already have, so they
  // appear in it. Nothing else on the entry is touched — see reusePatch.
  const patch = reusePatch(existing, body);
  if (Object.keys(patch).length) {
    await db().collection("entries").doc(existing.id).update(patch);
    revalidateStats(leagueId);
  }
  // 200, not 201: nothing was created. The body is the entry itself, so every
  // caller that adds the returned row to a grid keeps working, and `reused` says
  // what happened for anything that wants to tell the admin.
  return NextResponse.json({ ...existing, ...patch, reused: true });
}

const routes = makeCollectionRoutes({ ...SPECS.entries, guard: reuseExistingEntry });
export const GET = routes.GET;

// Adding a driver to a season's roster WITH a team is the same statement as
// putting them on that team's line-up for the season, so the line-up is kept in
// step (see lib/teamsServer.js) — otherwise the team tables would show the
// driver only through the entry's tag, and the Team Roster screen would show
// the team as empty. Never fails the create over it: the entry's own tag still
// resolves them.
export async function POST(request, ctx) {
  const response = await routes.POST(request, ctx);
  if (response.status !== 201) return response;
  try {
    const created = await response.clone().json();
    if (created.team_id && created.driver_id) {
      const user = await getRequestUser(request);
      await syncLineupFromEntry({
        seasonId: created.season_id,
        driverId: created.driver_id,
        teamId: created.team_id,
        userId: user?.uid ?? null,
      });
    }
  } catch (err) {
    console.error("Team line-up sync failed", err);
  }
  return response;
}
