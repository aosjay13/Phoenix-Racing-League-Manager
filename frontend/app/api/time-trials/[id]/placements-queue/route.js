import { NextResponse } from "next/server";
import { getRequestLeagueId, withAdmin } from "@/lib/serverAuth";
import { fetchTrial } from "@/lib/timeTrialsServer";
import { hasDestinations, matchingQueueRows, trialDestinations } from "@/lib/placementQueue";
import { fetchPlacementQueue, placementQueueRow } from "@/lib/placementQueueServer";

export const dynamic = "force-dynamic";

// "Import from Placements Queue" → who this session is actually being run for.
//
// A placement night is one big pool on purpose. The admin ticks the divisions
// it sorts into ("Gold Series", "Silver Series"), and everybody approved for a
// placement in any of them belongs on that ONE sheet, so the whole field can be
// ranked against each other and distributed. Building that sheet by hand means
// typing forty names that the app already has, from a list on another screen.
//
// So this answers, for one trial: of everyone in the league waiting on a
// placement session, who signed up for one of the places this session is
// sending people? The destinations are read off the trial itself rather than
// taken from the request — the pool is defined by what the session IS, and a
// caller must not be able to widen it.
//
// It writes nothing. The rows go onto the sheet in the browser, where the admin
// reviews them and presses Save, exactly like a driver added by hand — a night's
// unsaved laps must survive pressing this button.
export const GET = withAdmin(async (request, { params }) => {
  const trial = await fetchTrial(params.id);
  if (!trial) return NextResponse.json({ error: "Time trial not found" }, { status: 404 });

  const destinations = trialDestinations(trial);
  // Nothing ticked is not "everyone". A session with no destinations has no
  // pool to draw from, and answering with the league's whole queue would put
  // every waiting driver in the game onto one unrelated sheet.
  if (!hasDestinations(destinations)) {
    return NextResponse.json({
      rows: [], destinations, total: 0, code: "no-destinations",
      error: "Pick where this session is placing drivers first — the queue is pooled by destination.",
    });
  }

  const queue = await fetchPlacementQueue(getRequestLeagueId(request));
  const rows = matchingQueueRows(queue, destinations);
  return NextResponse.json({
    rows: rows.map(placementQueueRow),
    destinations,
    // How many are waiting league-wide, so the screen can say "4 of 27 are for
    // this session's divisions" rather than leaving an admin wondering where
    // the rest of the queue went.
    total: queue.length,
  });
});
