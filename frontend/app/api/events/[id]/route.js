import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { decorateRaceBonuses, decorateSessionFlags, isQualifying, makeScorer, resolveSeasonConfig } from "@/lib/standings";
import { fetchTemplatesById } from "@/lib/pointsTemplatesServer";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { fetchSeasonClasses, classOfResult, racePerClassResults } from "@/lib/classServer";
import { fetchSeriesForSeason } from "@/lib/seriesServer";
import { isBracketDoc, isBracketEvent } from "@/lib/bracketRacing";
import { isBangerDoc, isBangerEvent } from "@/lib/bangerRacing";

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
  const series = await fetchSeriesForSeason(season);
  const config = resolveSeasonConfig(season || {}, series);
  const entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const teamsById = Object.fromEntries(teamsSnap.docs.map(d => [d.id, d.data()]));
  // The event's own doc is the only race in scope here, and decorating against
  // it is what tells the scorer which session carries the qualifying points
  // (and which class each session's points template was assigned to) — so the
  // points printed on this page are the same numbers the standings total.
  const all = decorateRaceBonuses(decorateSessionFlags(resultsSnap.docs.map(d => d.data()), { [event.id]: event }));
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
  // The bonus values in force for one session, keyed by the class each result
  // counts toward ("" for an unclassed result) — the same resolved structure
  // scorer.points() paid the row from, so the viewer's "1 Bonus Point for a Lap
  // Led" header can never disagree with the points column beneath it. Only the
  // classes that actually raced the session appear, and a session nobody raced
  // resolves to an empty map.
  const sessionBonuses = rows => {
    const out = {};
    for (const r of rows) {
      const classId = classOfResult(r, entriesById) || "";
      if (classId in out) continue;
      out[classId] = configFor(r).bonuses;
    }
    return out;
  };

  const races = names.map(name => {
    const rows = raceResults.filter(r => (r.session || declared[0]) === name);
    return {
      name,
      bonuses: sessionBonuses(rows),
      results: rows
        .map(r => {
          // Start = the driver's own saved start_pos, else their qualifying
          // finishing position — their OWN class's Qualifying at a split event,
          // which is what scorer.qualPosFor resolves.
          const qp = scorer.qualPosFor(r);
          const start = r.start_pos != null ? Number(r.start_pos) : qp;
          return { ...joinEntry(r), start_pos: start, points: scorer.points(r) };
        })
        .sort((a, b) => a.finish_pos - b.finish_pos),
    };
  }).filter(s => s.results.length || names.length === 1);

  // Qualifying is the only source of starting position — there's no fallback
  // to anything recorded on a race result.
  //
  // The Pts column quotes the scale this grid slot is actually paid under, which
  // lives on the race the points are folded into (scorer.qualConfigFor — with
  // nothing assigned to Qualifying, the race's own points system provides the
  // qualifying scale). Reading it off the qualifying result alone printed the
  // season default over a race scored on a template, so a pole worth 35 in the
  // standings showed here as 0. Falls back to the qualifying result itself when
  // the driver has no race at this event yet.
  const payingRowFor = qr => raceResults.find(r =>
    r.entry_id === qr.entry_id
    && classOfResult(r, entriesById) === classOfResult(qr, entriesById)
    && scorer.paysQualBonus(r));
  const qualifying = qualResults
    .map(r => {
      const qc = scorer.qualConfigFor(payingRowFor(r) || r);
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
    // Bracket Style Racing, resolved for THIS event by the event rule
    // (isBracketEvent): a flagged series/season, a round pinned to a flagged
    // class, or a season whose classes all race brackets. The results table
    // prints the round a shared position came out of ("Semi-final losers"),
    // and that must never appear on an ordinary race — a repeated position
    // there is a data error, not a bracket. `bracket_classes` carries the ids
    // of any class that races brackets on its own, so a class-scoped view of
    // an otherwise ordinary season still labels its ladder.
    is_bracket_racing: isBracketEvent({ series, season, race: event, classes }),
    bracket_classes: classes.filter(isBracketDoc).map(c => c.id),
    // Demo Derby / Banger Racing, resolved the same way — it decides whether the
    // results table carries the takedown / survival / most-lethal columns the
    // admin grid collects, and whether those rates appear in the bonus header.
    // `banger_classes` covers a derby class inside an otherwise ordinary season,
    // whose own class-scoped view should still show them.
    is_banger_racing: isBangerEvent({ series, season, race: event, classes }),
    banger_classes: classes.filter(isBangerDoc).map(c => c.id),
    races,
    qualifying,
  });
}
