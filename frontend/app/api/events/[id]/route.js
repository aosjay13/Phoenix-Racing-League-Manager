import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { decorateRaceBonuses, pointsFor, resolveSeasonConfig } from "@/lib/standings";

// Full detail for one event: qualifying + every race session with computed points.
export async function GET(request, { params }) {
  const raceDoc = await db().collection("races").doc(params.id).get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const event = { id: raceDoc.id, ...raceDoc.data() };

  const [seasonDoc, entriesSnap, teamsSnap, resultsSnap] = await Promise.all([
    db().collection("seasons").doc(event.season_id).get(),
    db().collection("entries").where("season_id", "==", event.season_id).get(),
    db().collection("teams").where("season_id", "==", event.season_id).get(),
    db().collection("results").where("race_id", "==", event.id).get(),
  ]);

  const season = seasonDoc.exists ? { id: seasonDoc.id, ...seasonDoc.data() } : null;
  const config = resolveSeasonConfig(season || {});
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const teamsById = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data()]));
  const results = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));

  const joinEntry = r => {
    const entry = entriesById[r.entry_id] || {};
    return {
      ...r,
      driver_name: entry.name ?? "Unknown",
      driver_number: entry.number ?? null,
      user_id: entry.user_id ?? null,
      team: teamsById[entry.team_id]?.name ?? null,
    };
  };

  // Session names: what the event declares, plus anything found in results.
  const declared = Array.isArray(event.sessions) && event.sessions.length ? event.sessions : ["Race"];
  const found = [...new Set(results.map(r => r.session || ""))];
  const names = [...declared];
  for (const f of found) {
    const label = f || declared[0];
    if (!names.includes(label)) names.push(label);
  }

  const sessions = names.map(name => {
    const rows = results
      .filter(r => (r.session || declared[0]) === name)
      .map(r => ({ ...joinEntry(r), points: pointsFor(r, config) }))
      .sort((a, b) => a.finish_pos - b.finish_pos);
    const qualifying = rows
      .filter(r => r.start_pos != null)
      .map(r => ({ ...r, qual_points: Number(config.qualPoints[r.start_pos] ?? 0) }))
      .sort((a, b) => a.start_pos - b.start_pos);
    return { name, results: rows, qualifying };
  }).filter(s => s.results.length || names.length === 1);

  return NextResponse.json({
    event,
    season: season ? { id: season.id, name: season.name, series_id: season.series_id } : null,
    sessions,
  });
}
