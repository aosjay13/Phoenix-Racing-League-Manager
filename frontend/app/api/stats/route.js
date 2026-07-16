import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  aggregateCareerStats,
  calculateStandings,
  decorateRaceBonuses,
  isQualifying,
  pointsFor,
  resolveSeasonConfig,
} from "@/lib/standings";

export const dynamic = "force-dynamic";

// Aggregated driver stats across seasons — the app version of the
// spreadsheet's "Overall Stats" sheets.
//   scope=league                → every season
//   scope=game&game_id=…        → all seasons in a game
//   scope=series&series_id=…    → all seasons in a series
//   scope=season&season_id=…    → one season
// Drivers are unified across seasons by linked account (user_id) when
// present, otherwise by roster name.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  let seasonsQuery = db().collection("seasons");
  if (scope === "game") {
    const gameId = searchParams.get("game_id");
    if (!gameId) return NextResponse.json({ error: "game_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("game_id", "==", gameId);
  } else if (scope === "series") {
    const seriesId = searchParams.get("series_id");
    if (!seriesId) return NextResponse.json({ error: "series_id required" }, { status: 400 });
    seasonsQuery = seasonsQuery.where("series_id", "==", seriesId);
  } else if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    const doc = await db().collection("seasons").doc(seasonId).get();
    if (!doc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    return NextResponse.json(await buildStats([{ id: doc.id, ...doc.data() }]));
  } else if (scope !== "league") {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }

  const snap = await seasonsQuery.get();
  const seasons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return NextResponse.json(await buildStats(seasons));
}

async function buildStats(seasons) {
  // driverKey -> { name, number, user_id, results[], titles }
  const drivers = {};

  for (const season of seasons) {
    const config = resolveSeasonConfig(season);
    const [entriesSnap, resultsSnap] = await Promise.all([
      db().collection("entries").where("season_id", "==", season.id).get(),
      db().collection("results").where("season_id", "==", season.id).get(),
    ]);
    const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));
    const results = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));

    const keyFor = entry =>
      entry.user_id ? `u:${entry.user_id}` : `n:${String(entry.name || "").trim().toLowerCase()}`;

    for (const r of results) {
      const entry = entriesById[r.entry_id];
      if (!entry) continue;
      const key = keyFor(entry);
      const bucket = (drivers[key] ??= {
        driver_name: entry.name,
        driver_number: entry.number ?? null,
        user_id: entry.user_id ?? null,
        results: [],
        titles: 0,
      });
      // Prefer the most recent identity details we see.
      bucket.driver_name = entry.name;
      if (entry.number != null) bucket.driver_number = entry.number;
      if (entry.user_id) bucket.user_id = entry.user_id;
      bucket.results.push({ ...r, points: isQualifying(r) ? 0 : pointsFor(r, config) });
    }

    // Titles: champion of each completed season.
    if (season.status === "completed" && results.length) {
      const standings = calculateStandings(results, entries, [], config);
      const winner = standings.rows[0] && entriesById[standings.rows[0].entry_id];
      if (winner) {
        const key = keyFor(winner);
        if (drivers[key]) drivers[key].titles += 1;
      }
    }
  }

  const rows = Object.values(drivers).map(d => ({
    driver_name: d.driver_name,
    driver_number: d.driver_number,
    user_id: d.user_id,
    ...aggregateCareerStats(d.results, d.titles),
  }));

  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.driver_name.localeCompare(b.driver_name));

  return {
    seasons_counted: seasons.length,
    rows,
  };
}
