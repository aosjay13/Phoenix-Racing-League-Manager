import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { classIdForScope, classOfResult, isClassScoped } from "@/lib/classServer";
import {
  customPointsName, isCustomPointsId, newCustomPointsId, prunedCustomPoints, sanitizeCustomPoints,
} from "@/lib/customPoints";
import { withStatsRefresh } from "@/lib/statsCache";

const SESSION_TYPES = ["qualifying", "race", "heat", "consolation", "feature"];

// Assigns (or clears) the points system for one session of an event, and
// cascades the new points_template_id onto any results already saved for
// that session — so changing the points structure after results are entered
// immediately re-scores that session everywhere (results screens, event
// pages, championship standings), with no re-save of the results needed.
// body: { session_type, session, template_id, session_class?, custom_points? }
// — template_id "" or null clears the override; "none" awards 0 points.
//
// `custom_points` is the other way to answer the same question: instead of
// naming a points system that already exists, it sends the structure itself —
// `{ race_points, qual_points, bonus_points }` — for THIS session alone. It's
// stored on the race under `races.custom_points`, keyed by a minted id the
// session then points at like any other, so a scale typed for one night scores
// through exactly the same path a template does without ever joining the
// template library (see lib/customPoints.js). Sending it again for a session
// that already has one edits that structure in place rather than piling up a
// new one, and `template_id` is ignored while it is present.
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
const handlePOST = withAdmin(async (request, { params }) => {
  const { session_type, session, template_id, session_class, custom_points, class_label } = await request.json();
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

  // A structure sent for this session alone. It's written first, because the
  // assignment below is simply the id it was written under — from there on it
  // behaves as any template id does.
  const custom = sanitizeCustomPoints(custom_points, {
    name: customPointsName(session, scoped ? String(class_label || "").trim() : ""),
  });
  const assignedBefore = scoped
    ? (race.session_points_by_class?.[session_class]?.[session] || "")
    : (race.session_points?.[session] || "");
  let assignedId = template_id || "";
  if (custom) {
    // Editing a session that already scores on a custom structure updates that
    // structure in place: its id is already stamped on every result of the
    // session, so re-pointing them isn't needed and a second entry would just
    // be an orphan.
    assignedId = isCustomPointsId(assignedBefore) ? assignedBefore : newCustomPointsId();
    raceUpdates.custom_points = { ...(race.custom_points || {}), [assignedId]: custom };
  }

  if (scoped) {
    const byClass = { ...(race.session_points_by_class || {}) };
    const forClass = { ...(byClass[session_class] || {}) };
    if (assignedId) forClass[session] = assignedId;
    else delete forClass[session];
    if (Object.keys(forClass).length) byClass[session_class] = forClass;
    else delete byClass[session_class];
    raceUpdates.session_points_by_class = byClass;
  } else {
    const sp = { ...(race.session_points || {}) };
    if (assignedId) sp[session] = assignedId;
    else delete sp[session];
    raceUpdates.session_points = sp;
  }

  // What the affected results should now point at. Clearing a class's override
  // hands its results back to the event-wide assignment rather than blanking
  // them, which would silently drop a template the event set for everyone.
  const effective = assignedId || (scoped ? (race.session_points?.[session] || null) : null);

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
  // What this event's results point at once the cascade below has run — the
  // other half of "is this custom structure still in use?".
  const resultTemplateIds = [];
  for (const doc of resultsSnap.docs) {
    const d = doc.data();
    const docType = d.session_type || "race";
    const docSession = d.session || firstStd;
    const mine = docType === type && docSession === session
      && (!scoped || (classOfResult(d, entriesById) || "") === wantedClass);
    if (!mine) { resultTemplateIds.push(d.points_template_id); continue; }
    batch.update(doc.ref, { points_template_id: effective });
    resultTemplateIds.push(effective);
    rescored += 1;
  }

  // A custom structure nothing points at any more is dead weight on the race
  // document — a session switched from custom to a template, or back to the
  // default, leaves one behind. Dropped in the same write that orphaned it.
  const pruned = prunedCustomPoints({ ...race, ...raceUpdates }, resultTemplateIds);
  if (pruned) raceUpdates.custom_points = pruned;

  batch.update(raceRef, raceUpdates);
  await batch.commit();

  const after = await raceRef.get();
  return NextResponse.json({ id: after.id, ...after.data(), _rescored: rescored });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
