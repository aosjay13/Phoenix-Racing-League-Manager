import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { decorateRaceBonuses, isQualifying, pointsFor, resolveSeasonConfig } from "@/lib/standings";

// Full detail for one event: a dedicated qualifying session plus every race
// session, each with computed points.
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
  const all = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));

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

  const raceResults = all.filter(r => !isQualifying(r));
  const qualResults = all.filter(r => isQualifying(r));

  // Race sessions: whatever the event declares, plus any found in the data.
  const declared = Array.isArray(event.sessions) && event.sessions.length ? event.sessions : ["Race"];
  const names = [...declared];
  for (const r of raceResults) {
    const label = r.session || declared[0];
    if (!names.includes(label)) names.push(label);
  }
  const races = names.map(name => ({
    name,
    results: raceResults
      .filter(r => (r.session || declared[0]) === name)
      .map(r => ({ ...joinEntry(r), points: pointsFor(r, config) }))
      .sort((a, b) => a.finish_pos - b.finish_pos),
  })).filter(s => s.results.length || names.length === 1);

  // Qualifying: prefer the dedicated qualifying session; otherwise fall back to
  // the starting positions recorded on the first race session (legacy events).
  let qualifying = [];
  if (qualResults.length) {
    qualifying = qualResults
      .map(r => ({
        ...joinEntry(r),
        position: Number(r.finish_pos),
        qual_points: Number(config.qualPoints[r.finish_pos] ?? 0),
      }))
      .sort((a, b) => a.position - b.position);
  } else if (races[0]) {
    qualifying = races[0].results
      .filter(r => r.start_pos != null)
      .map(r => ({ ...r, position: Number(r.start_pos), qual_time: r.qual_time, qual_points: Number(config.qualPoints[r.start_pos] ?? 0) }))
      .sort((a, b) => a.position - b.position);
  }

  return NextResponse.json({
    event,
    season: season ? { id: season.id, name: season.name, series_id: season.series_id } : null,
    races,
    qualifying,
  });
}
