import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";

// Hand-sorting a series' seasons — the admin's override of the default order
// (newest first, by race date; see lib/seasonOrder.js).
//
// The whole arrangement is written in one go rather than a season at a time:
// `sort_order` is only meaningful as a run of positions down one list, so every
// season named in the request is stamped with its index, 0 at the top. Send
// `reset: true` to clear the lot and hand the list back to the race dates.
//
// Seasons of the series that AREN'T named are deliberately left alone: they
// keep whatever they had, and an unstamped one still finds its place by date
// (that's what keeps a season created after a hand-sort from silently landing
// at the bottom).
export const POST = withAdmin(async (request) => {
  const body = await request.json().catch(() => ({}));
  const seriesId = String(body.series_id || "").trim();
  if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });

  const snap = await scopeByLeague(
    db().collection("seasons").where("series_id", "==", seriesId),
    getRequestLeagueId(request),
  ).get();
  const inSeries = new Set(snap.docs.map(d => d.id));

  // Ids that aren't this series' seasons are dropped rather than rejected: the
  // caller's list can be a moment stale, and the rest of the order is still good.
  const order = body.reset
    ? []
    : [...new Set((Array.isArray(body.season_ids) ? body.season_ids : []).map(String))]
        .filter(id => inSeries.has(id));

  if (!body.reset && !order.length) {
    return NextResponse.json({ error: "season_ids required" }, { status: 400 });
  }

  const batch = db().batch();
  if (body.reset) {
    for (const doc of snap.docs) batch.update(doc.ref, { sort_order: null });
  } else {
    order.forEach((id, i) => batch.update(db().collection("seasons").doc(id), { sort_order: i }));
  }
  await batch.commit();

  return NextResponse.json({ ok: true, custom_order: !body.reset, ordered: order.length });
});
