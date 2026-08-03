import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { decorateRaceBonuses, isQualifying, makeScorer, resolveSeasonConfig } from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { fetchSeasonClasses, classOfResult, racePerClassResults } from "@/lib/classServer";

// Full detail for one event: a dedicated qualifying session plus every race
// session (including heat/consolation/feature sessions for heat-format
// events), each with computed points — resolved per-session via that
// session's own points_template_id when it has one, else the season default.
export async function GET(request, { params }) {
  const raceDoc = await db().collection("races").doc(params.id).get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const event = { id: raceDoc.id, ...raceDoc.data() };

  const [seasonDoc, entriesSnap, teamsSnap, resultsSnap, templatesById, classes] = await Promise.all([
    db().collection("seasons").doc(event.season_id).get(),
    db().collection("entries").where("season_id", "==", event.season_id).get(),
    db().collection("teams").where("season_id", "==", event.season_id).get(),
    db().collection("results").where("race_id", "==", event.id).get(),
    fetchTemplatesById(),
    fetchSeasonClasses(event.season_id),
  ]);

  const season = seasonDoc.exists ? { id: seasonDoc.id, ...seasonDoc.data() } : null;
  const config = resolveSeasonConfig(season || {});
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const teamsById = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data()]));
  const all = decorateRaceBonuses(resultsSnap.docs.map(d => d.data()));
  // Points shown per row come from the class that row raced in — its own points
  // structure when it has one — with the session's template on top.
  const scorer = makeScorer(all, { config, classes, entriesById, templatesById });
  const configFor = r => scorer.configFor(r);

  // Contextual name rendering: this event belongs to one game (season.game_id),
  // so resolve the name each driver is shown under in that game (see
  // lib/driverNames.js) and stamp it on every result row — null when they've set
  // none, so the client falls back to the name on the entry.
  const gameId = season?.game_id || null;
  let aliasByDriver = {};
  if (gameId) {
    const names = await fetchDriverNames(all.map(r => entriesById[r.entry_id]?.driver_id), gameId);
    aliasByDriver = Object.fromEntries(Object.entries(names).map(([id, n]) => [id, n.game]));
  }

  // The class each result counts toward, resolved once here (stamped class, else
  // the driver's roster class) so the client can group a split event's sessions
  // into one table per class without repeating the fallback rule.
  const joinEntry = r => {
    const entry = entriesById[r.entry_id] || {};
    return {
      ...r,
      class_id: classOfResult(r, entriesById) || "",
      driver_name: entry.name ?? "Unknown",
      driver_number: entry.number ?? null,
      driver_id: entry.driver_id ?? null,
      user_id: entry.user_id ?? null,
      team: teamsById[entry.team_id]?.name ?? null,
      game_alias: entry.driver_id ? (aliasByDriver[entry.driver_id] ?? null) : null,
    };
  };

  const raceResults = all.filter(r => !isQualifying(r));
  const qualResults = all.filter(r => isQualifying(r));
  const qualPosMap = scorer.qualPosMap;

  // Race sessions: whatever the event declares (standard `sessions`, or for
  // heat-format events its heats/consolations/feature), plus any found in
  // the saved results.
  const declared = event.heat_format
    ? [...(event.heats || []), ...(event.consolations || []), event.feature_name || "A-Main Feature"]
    : Array.isArray(event.sessions) && event.sessions.length ? event.sessions : ["Race"];
  const names = [...declared];
  for (const r of raceResults) {
    const label = r.session || declared[0];
    if (!names.includes(label)) names.push(label);
  }
  const races = names.map(name => ({
    name,
    results: raceResults
      .filter(r => (r.session || declared[0]) === name)
      .map(r => {
        const qp = qualPosMap[`${r.race_id}|${r.entry_id}`] ?? null;
        // Start = the driver's own saved start_pos, else their qualifying
        // finishing position. Finish is scored/ordered independently of both.
        const start = r.start_pos != null ? Number(r.start_pos) : qp;
        return { ...joinEntry(r), start_pos: start, points: scorer.points(r) };
      })
      .sort((a, b) => a.finish_pos - b.finish_pos),
  })).filter(s => s.results.length || names.length === 1);

  // Qualifying is the only source of starting position — there's no fallback
  // to anything recorded on a race result.
  const qualifying = qualResults
    .map(r => {
      const qc = configFor(r);
      return { ...joinEntry(r), position: Number(r.finish_pos), qual_points: Number(qc.qualPoints[r.finish_pos] ?? 0) };
    })
    .sort((a, b) => a.position - b.position);

  // The race stores only the venue's NAME; the exporter's metadata strip wants
  // its layout/length too, so resolve the linked track doc when there is one.
  let track = null;
  if (event.track_id) {
    const tdoc = await db().collection("tracks").doc(event.track_id).get();
    if (tdoc.exists) {
      const t = tdoc.data();
      track = { id: tdoc.id, name: t.name ?? null, location: t.location ?? null, length: t.length ?? null, track_type: t.track_type ?? null };
    }
  }

  return NextResponse.json({
    event,
    track,
    // Full season doc (not just id/name) so the edit screen can resolve
    // points client-side (season defaults + per-session template overrides)
    // without a second round trip.
    season,
    // The season's classes, plus whether THIS event splits its sessions by
    // class — with it on, each session's results are one grid per class (its
    // own pole, its own P1) rather than a single combined order.
    classes,
    per_class_results: racePerClassResults(event, season),
    races,
    qualifying,
  });
}
