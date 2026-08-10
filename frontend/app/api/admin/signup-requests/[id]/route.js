import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import { carNumberTaken, seasonAcceptsSignups } from "@/lib/carSelection";
import { APPROVED, DENIED, PENDING } from "@/lib/signupQueue";

// Admin-only: let a pending sign-up onto the roster, or turn it down.
//
//   body.action = "approve" → creates the roster entry with the number, car and
//                             manufacturer the player asked for. When the
//                             request came from someone with no driver profile,
//                             the profile is created here too — this route and
//                             the claim queue are the ONLY places a
//                             player-requested driver is ever created.
//   body.action = "deny"    → marks it denied. `reason` is kept so the player
//                             can be told why.
//
// Approval re-checks everything that could have changed while the request sat
// in the queue — the season closing, the driver being added by hand, the number
// being taken — because a queue is exactly where stale data comes from.
export const PATCH = withAdmin(async (request, { params }, admin) => {
  const { id } = params;
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  const reqRef = db().collection("signup_requests").doc(id);
  const reqDoc = await reqRef.get();
  if (!reqDoc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const req = { id: reqDoc.id, ...reqDoc.data() };
  if (req.status !== PENDING) {
    return NextResponse.json({ error: "This sign-up has already been resolved." }, { status: 400 });
  }

  const stamp = { resolved_at: new Date().toISOString(), resolved_by: admin.uid };

  if (action === "deny") {
    await reqRef.update({
      status: DENIED, ...stamp,
      deny_reason: String(body.reason ?? "").trim().slice(0, 300) || null,
    });
    return NextResponse.json({ ok: true, id, status: DENIED });
  }
  if (action !== "approve") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const seasonDoc = await db().collection("seasons").doc(req.season_id).get();
  if (!seasonDoc.exists) {
    return NextResponse.json({ error: "That season no longer exists." }, { status: 404 });
  }
  const season = { id: seasonDoc.id, ...seasonDoc.data() };
  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json({
      error: `${season.name || "That season"} has been marked complete, so nobody can be added to it. Reopen the season first, or deny this sign-up.`,
    }, { status: 400 });
  }

  // ── The driver ───────────────────────────────────────────────────────────
  // Either they already had a profile, or this approval is what creates it.
  let driverId = req.driver_id || null;
  let driverName = req.driver_name || "";
  let created_driver = false;

  if (!driverId) {
    // A profile may have appeared since they asked (another request approved,
    // or an admin linking them by hand) — use it rather than making a second.
    const owned = await db().collection("drivers").where("user_id", "==", req.uid).limit(1).get();
    if (!owned.empty) {
      driverId = owned.docs[0].id;
      driverName = owned.docs[0].data().name || "";
    } else {
      const name = String(req.new_driver?.name || req.name || "").trim().slice(0, 60);
      if (!name) {
        return NextResponse.json({ error: "This sign-up has no driver name to create." }, { status: 400 });
      }
      const driverDoc = {
        name,
        user_id: req.uid,
        notes: "",
        aliases: Array.isArray(req.new_driver?.aliases) ? req.new_driver.aliases : (req.aliases || []),
        created_at: new Date().toISOString(),
        created_by: admin.uid,
        created_from_signup: id,
        ...(req.league_id ? { league_id: req.league_id } : {}),
      };
      const ref = await db().collection("drivers").add(driverDoc);
      driverId = ref.id;
      driverName = name;
      created_driver = true;
    }
  } else if (Array.isArray(req.aliases) && req.aliases.length) {
    // Keep the profile's connected accounts current with what they submitted.
    await db().collection("drivers").doc(driverId).update({ aliases: req.aliases });
  }

  // ── The roster entry ─────────────────────────────────────────────────────
  const rosterSnap = await db().collection("entries").where("season_id", "==", req.season_id).get();
  const existing = rosterSnap.docs.find(d => {
    const e = d.data();
    return e.driver_id === driverId || (e.user_id && e.user_id === req.uid);
  });
  if (existing) {
    await reqRef.update({ status: APPROVED, ...stamp, entry_id: existing.id, driver_id: driverId });
    return NextResponse.json({
      ok: true, id, status: APPROVED, driver_id: driverId, driver_name: driverName,
      entry_id: existing.id, created_driver,
      note: "They were already on this season's roster, so no second entry was created.",
    });
  }

  // Their number may have gone while the request waited. Better to seat them
  // without one — and say so — than to refuse the approval outright.
  let number = String(req.number ?? "").trim().slice(0, 3);
  let note = "";
  if (number && carNumberTaken(rosterSnap.docs.map(d => d.data().number), number)) {
    note = `#${number} was taken while this sign-up was waiting, so they were added without a number.`;
    number = "";
  }

  const classSnap = await db().collection("classes").where("season_id", "==", req.season_id).get();
  const valid = new Set(classSnap.docs.map(d => d.id));
  const classIds = normalizeClassIds(req.class_ids).filter(c => valid.has(c));

  const entryDoc = {
    season_id: req.season_id,
    name: String(req.name || driverName || "Driver").trim().slice(0, 60),
    driver_id: driverId,
    user_id: req.uid,
    team_id: "",
    number,
    class_ids: classIds,
    class_id: classIds[0] || "",
    // The car they locked in at sign-up carries straight onto the entry, in the
    // same fields the lock-in screen writes — so an approved sign-up needs no
    // second trip to choose what they already chose.
    ...(req.car ? { selected_car: req.car, selected_car_at: new Date().toISOString() } : {}),
    ...(req.manufacturer ? { selected_manufacturer: req.manufacturer } : {}),
    created_at: new Date().toISOString(),
    created_by: admin.uid,
    self_signup: true,
    approved_from_signup: id,
    ...(season.league_id ? { league_id: season.league_id } : {}),
  };
  const entryRef = await db().collection("entries").add(entryDoc);

  await reqRef.update({ status: APPROVED, ...stamp, entry_id: entryRef.id, driver_id: driverId });

  return NextResponse.json({
    ok: true, id, status: APPROVED,
    driver_id: driverId, driver_name: driverName, created_driver,
    entry_id: entryRef.id, number, note,
  });
});
