import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { withStatsRefresh } from "@/lib/statsCache";

// Renames one session of an event and cascades the change so nothing orphans:
//   - the name in the race's sessions / heats / consolations list (or
//     feature_name for the feature),
//   - the session_points entry keyed by that name (and any per-class ones),
//   - and every saved results doc filed under the old session name.
// body: { session_type: "race"|"heat"|"consolation"|"feature", from, to }
const handlePOST = withAdmin(async (request, { params }) => {
  const { session_type, from, to } = await request.json();
  const type = session_type || "race";
  const newName = (to || "").trim();
  if (!from || !newName) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  if (!["race", "heat", "consolation", "feature"].includes(type)) {
    return NextResponse.json({ error: "invalid session_type" }, { status: 400 });
  }
  if (from === newName) return NextResponse.json({ error: "Name unchanged" }, { status: 400 });

  const raceRef = db().collection("races").doc(params.id);
  const raceDoc = await raceRef.get();
  if (!raceDoc.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const race = raceDoc.data();

  const updates = {};
  if (type === "feature") {
    updates.feature_name = newName;
  } else {
    const field = type === "race" ? "sessions" : type === "heat" ? "heats" : "consolations";
    const list = Array.isArray(race[field]) && race[field].length ? race[field] : (type === "race" ? ["Race"] : []);
    if (!list.includes(from)) {
      return NextResponse.json({ error: `"${from}" is not a ${type} session` }, { status: 400 });
    }
    if (list.includes(newName)) {
      return NextResponse.json({ error: `"${newName}" already exists` }, { status: 409 });
    }
    updates[field] = list.map(n => (n === from ? newName : n));
  }

  // Carry the per-session points template and stats/points toggles across the rename.
  const sp = { ...(race.session_points || {}) };
  if (from in sp) { sp[newName] = sp[from]; delete sp[from]; updates.session_points = sp; }
  for (const field of ["session_stats", "session_points_enabled"]) {
    const map = { ...(race[field] || {}) };
    if (from in map) { map[newName] = map[from]; delete map[from]; updates[field] = map; }
  }
  // …and the per-class assignments for the same session, one map per class, so
  // renaming a session an individual class had its own points system for
  // doesn't quietly drop that class back to the default.
  const byClass = { ...(race.session_points_by_class || {}) };
  let renamedAnyClass = false;
  for (const [scope, map] of Object.entries(byClass)) {
    if (!(from in map)) continue;
    const next = { ...map };
    next[newName] = next[from];
    delete next[from];
    byClass[scope] = next;
    renamedAnyClass = true;
  }
  if (renamedAnyClass) updates.session_points_by_class = byClass;

  // Cascade to saved results filed under the old session name.
  const firstStd = Array.isArray(race.sessions) && race.sessions.length ? race.sessions[0] : "Race";
  const resultsSnap = await db().collection("results").where("race_id", "==", params.id).get();
  const batch = db().batch();
  let migrated = 0;
  for (const doc of resultsSnap.docs) {
    const d = doc.data();
    const docType = d.session_type || "race";
    const docSession = d.session || firstStd;
    if (docType === type && docSession === from) { batch.update(doc.ref, { session: newName }); migrated += 1; }
  }
  batch.update(raceRef, updates);
  await batch.commit();

  const after = await raceRef.get();
  return NextResponse.json({ id: after.id, ...after.data(), _migrated: migrated });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
