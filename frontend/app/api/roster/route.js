import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export const dynamic = "force-dynamic";

// Scope-aware roster directory, mirroring /api/stats.
//   scope=season  → drivers in one season (car numbers shown)
//   scope=series  → drivers across a series; number = latest season's entry number
//   scope=game    → drivers across every series in a game; number omitted (multiple)
//   scope=league  → every driver, everywhere; number omitted
//
// Drivers are unified across seasons by linked account (user_id) when present,
// otherwise by roster name — the same identity rule used by the stats page.
// Each driver also carries `series_entries`, a map of seriesId → the driver's
// latest entry in that series, which powers the per-series number editor.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  let seasons;
  if (scope === "season") {
    const id = searchParams.get("season_id");
    if (!id) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    seasons = [{ id: doc.id, ...doc.data() }];
  } else {
    let q = db().collection("seasons");
    if (scope === "game") {
      const gameId = searchParams.get("game_id");
      if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
      q = q.where("game_id", "==", gameId);
    } else if (scope === "series") {
      const seriesId = searchParams.get("series_id");
      if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
      q = q.where("series_id", "==", seriesId);
    } else if (scope !== "league") {
      return NextResponse.json({ error: "invalid scope" }, { status: 400 });
    }
    const snap = await q.get();
    seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Oldest → newest, so the most recent entry overwrites earlier identity data.
  seasons.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const showNumber = scope === "season" || scope === "series";
  const drivers = {};        // key -> driver bucket
  let editSeasonId = null;   // latest season in scope; the write target for edits

  for (const season of seasons) {
    editSeasonId = season.id;
    const seriesId = season.series_id || "unknown";
    const [entriesSnap, teamsSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("teams").where("season_id", "==", season.id).get(),
    ]);
    const teamName = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data().name]));

    for (const doc of entriesSnap.docs) {
      const entry = { id: doc.id, ...doc.data() };
      const key = entry.user_id ? `u:${entry.user_id}` : `n:${String(entry.name || "").trim().toLowerCase()}`;
      const bucket = (drivers[key] ??= {
        key,
        name: entry.name,
        user_id: entry.user_id ?? null,
        number: null,
        numbers: new Set(),
        team_id: null,
        team_name: null,
        entry_id: null,
        season_id: null,
        series_entries: {},
      });
      // Latest entry seen wins for the driver's display identity.
      bucket.name = entry.name;
      bucket.user_id = entry.user_id ?? bucket.user_id;
      bucket.team_id = entry.team_id ?? bucket.team_id;
      bucket.team_name = entry.team_id ? teamName[entry.team_id] ?? bucket.team_name : bucket.team_name;
      bucket.entry_id = entry.id;
      bucket.season_id = season.id;
      if (entry.number != null) {
        bucket.number = entry.number;
        bucket.numbers.add(entry.number);
      }
      // Per-series: keep the driver's latest entry for that series.
      bucket.series_entries[seriesId] = {
        entry_id: entry.id,
        season_id: season.id,
        number: entry.number ?? null,
      };
    }
  }

  const rows = Object.values(drivers).map(d => ({
    key: d.key,
    name: d.name,
    user_id: d.user_id,
    // Only expose a concrete number when the scope pins it to one series.
    number: showNumber ? d.number : null,
    team_id: d.team_id,
    team_name: d.team_name,
    entry_id: d.entry_id,
    season_id: d.season_id,
    series_entries: d.series_entries,
  }));

  return NextResponse.json({
    show_number: showNumber,
    edit_season_id: editSeasonId,
    seasons_counted: seasons.length,
    rows,
  });
}
