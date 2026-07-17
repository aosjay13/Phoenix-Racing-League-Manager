import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

const SESSION_TYPES = ["qualifying", "race", "heat", "consolation", "feature"];

// Assigns (or clears) the points system for one session of an event, and
// cascades the new points_template_id onto any results already saved for
// that session — so changing the points structure after results are entered
// immediately re-scores that session everywhere (results screens, event
// pages, championship standings), with no re-save of the results needed.
// body: { session_type, session, template_id } — template_id "" or null
// clears the override back to the season default; "none" awards 0 points.
export const POST = withAdmin(async (request, { params }) => {
  const { session_type, session, template_id } = await request.json();
  const type = SESSION_TYPES.includes(session_type) ? session_type : "race";
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }

  const raceRef = db().collection("races").doc(params.id);
  const raceDoc = await raceRef.get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const race = raceDoc.data();

  const sp = { ...(race.session_points || {}) };
  if (template_id) sp[session] = template_id;
  else delete sp[session];

  // Re-point saved results filed under this session at the new points system.
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const resultsSnap = await db().collection("results").where("race_id", "==", params.id).get();
  const batch = db().batch();
  let rescored = 0;
  for (const doc of resultsSnap.docs) {
    const d = doc.data();
    const docType = d.session_type || "race";
    const docSession = d.session || firstStd;
    if (docType === type && docSession === session) {
      batch.update(doc.ref, { points_template_id: template_id || null });
      rescored += 1;
    }
  }
  batch.update(raceRef, { session_points: sp });
  await batch.commit();

  const after = await raceRef.get();
  return NextResponse.json({ id: after.id, ...after.data(), _rescored: rescored });
});
