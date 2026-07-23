import { NextResponse } from "next/server";
import { SPECS, coerceField } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { recalcGameSkillRatings, gameIdForSeason } from "@/lib/skillRatingServer";

// PATCH a race. Mirrors the generic entityApi doc-update, but a change to the
// event's DATE or ROUND NUMBER reorders the game's SR timeline, so we trigger a
// chronological recalc afterwards — this is the retroactive "ripple" for a race
// that gets re-dated into the past (or future).
export const PATCH = withAdmin(async (request, { params }) => {
  const body = await request.json();
  const updates = {};
  for (const [name, opts] of Object.entries(SPECS.races.fields)) {
    if (body[name] !== undefined) {
      const coerced = coerceField(opts, body[name]);
      if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
      updates[name] = coerced.value;
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  const ref = db().collection("races").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await ref.update(updates);

  // Only a date/round change alters SR chronology — recompute the game then.
  if ("date" in updates || "round_number" in updates) {
    try {
      await recalcGameSkillRatings(await gameIdForSeason(doc.data().season_id));
    } catch (err) {
      console.error("Skill Rating recalc after race edit failed", err);
    }
  }

  return NextResponse.json({ id: params.id, ...doc.data(), ...updates });
});

// Deleting a race cascades to its saved results — stats/standings query
// results by season_id, so orphaned results would otherwise keep counting
// after the race is gone.
export const DELETE = withAdmin(async (request, { params }) => {
  const raceDoc = await db().collection("races").doc(params.id).get();
  const seasonId = raceDoc.exists ? raceDoc.data().season_id : null;

  const resultsSnap = await db().collection("results").where("race_id", "==", params.id).get();
  const docs = resultsSnap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await db().collection("races").doc(params.id).delete();

  // Recompute the game's SR now the event (and its results) are gone, so every
  // driver gets back exactly the rating those races moved (mirrors how points
  // and stats vanish), and later races re-run against the corrected timeline.
  try {
    await recalcGameSkillRatings(await gameIdForSeason(seasonId));
  } catch (err) {
    console.error("Skill Rating recalc after race delete failed", err);
  }

  return NextResponse.json({ ok: true, results_deleted: docs.length });
});
