import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { ratingOf } from "@/lib/skillRating";

export const dynamic = "force-dynamic";

// Skill Ratings leaderboard — every global driver ranked by their current SR.
// Scope mirrors /api/stats and is driven by the shared Game / Series / Season
// dropdowns:
//   scope=league             → the whole driver pool
//   scope=game&game_id=…     → drivers who started an SR race in that game
//   scope=series&series_id=… → …in that series
//   scope=season&season_id=… → …in that season
// SR itself is global (one number per driver, following them across every
// game); a narrowed scope only decides which drivers are listed and their
// in-scope race count / most-recent trend.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "league";

  // Resolve the seasons in scope; null means league-wide (no restriction).
  let seasonIds = null;
  if (scope === "season") {
    const seasonId = searchParams.get("season_id");
    if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });
    seasonIds = [seasonId];
  } else if (scope === "game" || scope === "series") {
    const field = scope === "game" ? "game_id" : "series_id";
    const val = searchParams.get(field);
    if (!val) return NextResponse.json({ error: `${field} required` }, { status: 400 });
    const snap = await db().collection("seasons").where(field, "==", val).get();
    seasonIds = snap.docs.map(d => d.id);
  } else if (scope !== "league") {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }

  // Base rows: every global driver with their current SR (baseline for those
  // never rated yet).
  const driversSnap = await db().collection("drivers").get();
  const drivers = {};
  for (const d of driversSnap.docs) {
    const data = d.data();
    drivers[d.id] = {
      driver_id: d.id,
      driver_name: data.name || "Unknown",
      user_id: data.user_id || null,
      skill_rating: ratingOf(data.skillRating),
      total_races: 0,
      last_delta: null,
      _lastAt: null,
    };
  }

  // A game/series scope with no seasons yet has nothing to rank.
  if (seasonIds && !seasonIds.length) {
    return NextResponse.json({ scope, count: 0, rows: [] });
  }

  // Gather the results (with sr_delta), entries (result → global driver) and
  // races (for recency) within scope. League scope reads the collections whole.
  let resultDocs = [];
  let entryDocs = [];
  let raceDocs = [];
  if (seasonIds) {
    const perSeason = await Promise.all(seasonIds.map(async sid => {
      const [r, e, ra] = await Promise.all([
        db().collection("results").where("season_id", "==", sid).get(),
        db().collection("entries").where("season_id", "==", sid).get(),
        db().collection("races").where("season_id", "==", sid).get(),
      ]);
      return { r: r.docs, e: e.docs, ra: ra.docs };
    }));
    for (const p of perSeason) { resultDocs.push(...p.r); entryDocs.push(...p.e); raceDocs.push(...p.ra); }
  } else {
    const [r, e, ra] = await Promise.all([
      db().collection("results").get(),
      db().collection("entries").get(),
      db().collection("races").get(),
    ]);
    resultDocs = r.docs; entryDocs = e.docs; raceDocs = ra.docs;
  }

  const driverByEntry = {};
  for (const e of entryDocs) { const id = e.data().driver_id; if (id) driverByEntry[e.id] = id; }
  const raceDate = {};
  for (const ra of raceDocs) raceDate[ra.id] = ra.data().date || null;

  const seen = new Set();
  for (const doc of resultDocs) {
    const r = doc.data();
    if (r.sr_delta == null) continue; // only SR-bearing main-race results
    const driverId = driverByEntry[r.entry_id];
    const row = drivers[driverId];
    if (!row) continue;
    row.total_races += 1;
    seen.add(driverId);
    // Most-recent trend: by race date, breaking ties on the result's save time.
    const at = `${raceDate[r.race_id] || ""}|${r.created_at || ""}`;
    if (row._lastAt == null || at >= row._lastAt) {
      row._lastAt = at;
      row.last_delta = Number(r.sr_delta);
    }
  }

  let rows = Object.values(drivers);
  // A narrowed scope lists only drivers who actually raced in it; league scope
  // shows the whole pool.
  if (seasonIds) rows = rows.filter(r => seen.has(r.driver_id));
  rows.sort((a, b) =>
    b.skill_rating - a.skill_rating ||
    b.total_races - a.total_races ||
    String(a.driver_name).localeCompare(String(b.driver_name))
  );
  rows = rows.map((r, i) => {
    const { _lastAt, ...rest } = r;
    return { rank: i + 1, ...rest };
  });

  return NextResponse.json({ scope, count: rows.length, rows });
}
