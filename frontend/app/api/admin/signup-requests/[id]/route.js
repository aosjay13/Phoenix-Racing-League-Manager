import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import { carNumberTaken, seasonAcceptsSignups } from "@/lib/carSelection";
import { APPROVED, DENIED, NUMBER_CHANGE_KIND, PENDING, isNumberChange } from "@/lib/signupQueue";
import { mergeAliases, normalizeAliases } from "@/lib/aliases";
import { userAccountUpdatesFromSignup } from "@/lib/signupRequest";

// Admin-only: let a pending sign-up onto the roster, or turn it down.
//
//   body.action = "approve" → creates the roster entry with the number and car
//                             the player asked for. When the
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

  // ── A number change ──────────────────────────────────────────────────────
  // Nobody is added or removed: one roster entry's number moves. Everything
  // that could have shifted while it waited is re-checked, because a queue is
  // exactly where stale data comes from — the entry may have been deleted, the
  // driver may have been given the number by hand already, or somebody else may
  // have taken the number they asked for.
  if (isNumberChange(req)) {
    if (!seasonAcceptsSignups(season)) {
      return NextResponse.json({
        error: `${season.name || "That season"} has been marked complete, so its roster is final. Reopen the season first, or deny this request.`,
      }, { status: 400 });
    }
    const entryRef = db().collection("entries").doc(String(req.entry_id || ""));
    const entryDoc = req.entry_id ? await entryRef.get() : null;
    if (!entryDoc?.exists) {
      return NextResponse.json({
        error: "That driver is no longer on this season's roster, so there's no number to change. Deny this request.",
      }, { status: 404 });
    }
    const number = String(req.number ?? "").trim().slice(0, 3);
    const rosterSnap = await db().collection("entries").where("season_id", "==", req.season_id).get();
    const takenByOthers = rosterSnap.docs
      .filter(d => d.id !== entryDoc.id)
      .map(d => d.data().number);
    if (number && carNumberTaken(takenByOthers, number)) {
      return NextResponse.json({
        error: `#${number} was taken while this request was waiting, so it can't be granted. Deny it and ask them to pick another.`,
        code: "number-taken",
      }, { status: 409 });
    }
    const previous = String(entryDoc.data().number ?? "").trim();
    await entryRef.update({ number });
    await reqRef.update({ status: APPROVED, ...stamp, applied_number: number, previous_number: previous });
    return NextResponse.json({
      ok: true, id, status: APPROVED, kind: NUMBER_CHANGE_KIND,
      driver_id: req.driver_id ?? null,
      driver_name: req.driver_name || req.name || "Driver",
      entry_id: entryDoc.id, number, previous_number: previous,
    });
  }

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
        // Every platform username they gave at sign-up, so the profile this
        // creates already knows their Discord/Steam/PSN/Xbox/iRacing names and
        // never asks again.
        aliases: mergeAliases(req.new_driver?.aliases, normalizeAliases(req.aliases)),
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
    // MERGED, not replaced: the sign-up form only asks for what its game
    // requires, so overwriting would drop every platform it didn't ask about.
    // (The submission normally syncs at POST time; this covers a request filed
    // before that existed, and a profile that appeared while it waited.)
    const driverDoc = await db().collection("drivers").doc(driverId).get();
    await db().collection("drivers").doc(driverId)
      .update({ aliases: mergeAliases(driverDoc.data()?.aliases, req.aliases) });
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
    created_at: new Date().toISOString(),
    created_by: admin.uid,
    self_signup: true,
    approved_from_signup: id,
    ...(season.league_id ? { league_id: season.league_id } : {}),
  };
  const entryRef = await db().collection("entries").add(entryDoc);

  await reqRef.update({ status: APPROVED, ...stamp, entry_id: entryRef.id, driver_id: driverId });

  // Bring the player's own account up to date with what they told us, exactly
  // as the submission does. Filing the sign-up normally does this already; this
  // covers a request filed before that existed, and an account that had no
  // display name to improve at the time. Timid by the same rule — a name or
  // number the player has since set themselves is left alone — and never fails
  // an approval, which has already done the work that matters.
  try {
    const accountRef = db().collection("users").doc(req.uid);
    const accountDoc = await accountRef.get();
    const updates = userAccountUpdatesFromSignup({
      profile: accountDoc.exists ? accountDoc.data() : {},
      name: entryDoc.name,
      number,
    });
    if (accountDoc.exists && Object.keys(updates).length) await accountRef.update(updates);
  } catch (err) {
    console.error("Approval account sync failed", err);
  }

  return NextResponse.json({
    ok: true, id, status: APPROVED,
    driver_id: driverId, driver_name: driverName, created_driver,
    entry_id: entryRef.id, number, note,
  });
});
