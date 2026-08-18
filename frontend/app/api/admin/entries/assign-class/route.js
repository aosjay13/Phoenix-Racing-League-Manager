import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withAdmin } from "@/lib/serverAuth";
import { entryClassIds } from "@/lib/classServer";

export const dynamic = "force-dynamic";

// Put a season's drivers into a class in one go.
//
// A class championship only ranks the results recorded IN that class, and a
// result's class is the one stamped on it when it was saved, falling back to
// the driver's roster class (see classOfResult). So a season that runs a class
// but never assigned anyone to it has a full overall championship and an empty
// class one — every driver racing, nobody in the class. Fixing that by hand
// means editing the roster one driver at a time, which is why the class table
// now offers this instead.
//
// It only ever ADDS a class to an entry (a driver already in Pro who is added
// to Banger races both), and it never touches results: existing results whose
// own class is blank resolve through the entry, so history joins the class
// championship the moment its drivers do. `scope` is:
//
//   "unclassified" (default) — only drivers not yet in any class
//   "all"                    — every driver in the season
export const POST = withAdmin(async (request, ctx, admin, role, leagueId) => {
  const { season_id, class_id, scope = "unclassified" } = await request.json();
  if (!season_id || !class_id) {
    return NextResponse.json({ error: "season_id and class_id required" }, { status: 400 });
  }

  const classDoc = await db().collection("classes").doc(class_id).get();
  // The class — and therefore the season whose roster is about to be rewritten —
  // has to belong to the league this admin is staff of.
  if (classDoc.exists && !docInLeague(classDoc.data(), leagueId)) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (!classDoc.exists) return NextResponse.json({ error: "Class not found" }, { status: 404 });
  if (classDoc.data().season_id !== season_id) {
    // A class belongs to exactly one season; assigning across seasons would put
    // drivers in a championship they never raced.
    return NextResponse.json({ error: "That class belongs to another season" }, { status: 400 });
  }

  const snap = await db().collection("entries").where("season_id", "==", season_id).get();
  const entries = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const targets = entries.filter(e => {
    const ids = entryClassIds(e);
    if (ids.includes(class_id)) return false;          // already in it
    return scope === "all" ? true : ids.length === 0;  // unclassified only, by default
  });

  if (!targets.length) {
    return NextResponse.json({ assigned: 0, class_name: classDoc.data().name ?? "", total: entries.length });
  }

  const batch = db().batch();
  for (const entry of targets) {
    const class_ids = [...entryClassIds(entry), class_id];
    // `class_id` mirrors the first of them, exactly as the entries route keeps
    // the two in step — see normalizeEntryClasses in lib/entityApi.js.
    batch.update(entry.ref, { class_ids, class_id: class_ids[0] });
  }
  await batch.commit();

  return NextResponse.json({
    assigned: targets.length,
    total: entries.length,
    class_name: classDoc.data().name ?? "",
  });
});
