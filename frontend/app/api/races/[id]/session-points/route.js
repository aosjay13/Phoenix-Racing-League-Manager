import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { classIdForScope, classOfResult, isClassScoped } from "@/lib/classServer";

const SESSION_TYPES = ["qualifying", "race", "heat", "consolation", "feature"];

// Assigns (or clears) the points system for one session of an event, and
// cascades the new points_template_id onto any results already saved for
// that session — so changing the points structure after results are entered
// immediately re-scores that session everywhere (results screens, event
// pages, championship standings), with no re-save of the results needed.
// body: { session_type, session, template_id, session_class? } — template_id
// "" or null clears the override; "none" awards 0 points.
//
// `session_class` scopes the assignment to ONE class of a split event, where
// each class runs its own Qualifying and Race: it's stored under
// session_points_by_class[scope][session] and cascaded only onto that class's
// results, so re-pointing Pro's Race leaves Amateur's alone. Without it the
// assignment is the event's, exactly as before.
//
// A cleared assignment falls back down the chain rather than to nothing: a
// class's session drops to the event-wide assignment for that session, and the
// event's drops to whatever the class — or, failing that, the season — scores
// on (see classScoresOwnPoints in lib/standings.js).
export const POST = withAdmin(async (request, { params }) => {
  const { session_type, session, template_id, session_class } = await request.json();
  const type = SESSION_TYPES.includes(session_type) ? session_type : "race";
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }

  const raceRef = db().collection("races").doc(params.id);
  const raceDoc = await raceRef.get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const race = raceDoc.data();

  const scoped = isClassScoped(session_class);
  const raceUpdates = {};
  if (scoped) {
    const byClass = { ...(race.session_points_by_class || {}) };
    const forClass = { ...(byClass[session_class] || {}) };
    if (template_id) forClass[session] = template_id;
    else delete forClass[session];
    if (Object.keys(forClass).length) byClass[session_class] = forClass;
    else delete byClass[session_class];
    raceUpdates.session_points_by_class = byClass;
  } else {
    const sp = { ...(race.session_points || {}) };
    if (template_id) sp[session] = template_id;
    else delete sp[session];
    raceUpdates.session_points = sp;
  }

  // What the affected results should now point at. Clearing a class's override
  // hands its results back to the event-wide assignment rather than blanking
  // them, which would silently drop a template the event set for everyone.
  const effective = template_id || (scoped ? (race.session_points?.[session] || null) : null);

  // A class-scoped cascade needs to know which class each result belongs to.
  // Results save their class, but ones written before classes existed resolve
  // through their driver's roster entry — so read the season's entries too.
  let entriesById = {};
  if (scoped && race.season_id) {
    const entriesSnap = await db().collection("entries").where("season_id", "==", race.season_id).get();
    entriesById = Object.fromEntries(entriesSnap.docs.map(d => [d.id, d.data()]));
  }
  const wantedClass = classIdForScope(session_class);

  // Re-point saved results filed under this session at the new points system.
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const resultsSnap = await db().collection("results").where("race_id", "==", params.id).get();
  const batch = db().batch();
  let rescored = 0;
  for (const doc of resultsSnap.docs) {
    const d = doc.data();
    const docType = d.session_type || "race";
    const docSession = d.session || firstStd;
    if (docType !== type || docSession !== session) continue;
    if (scoped && (classOfResult(d, entriesById) || "") !== wantedClass) continue;
    batch.update(doc.ref, { points_template_id: effective });
    rescored += 1;
  }
  batch.update(raceRef, raceUpdates);
  await batch.commit();

  const after = await raceRef.get();
  return NextResponse.json({ id: after.id, ...after.data(), _rescored: rescored });
});
