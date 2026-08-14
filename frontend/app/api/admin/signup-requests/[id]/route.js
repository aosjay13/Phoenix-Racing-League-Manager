import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import {
  carCapacity, carCounts, carNumberTaken, resolveSignupRules, seasonAcceptsSignups,
} from "@/lib/carSelection";
import {
  APPROVED, DENIED, NUMBER_CHANGE_KIND, OPEN_STATUSES,
  isAwaitingPlacement, isNumberChange, signupApprovalPlan,
} from "@/lib/signupQueue";
import { openRequestsForSeason, placementsRequiredFor } from "@/lib/carSelectionServer";
import { mergeAliases, normalizeAliases } from "@/lib/aliases";
import { userAccountUpdatesFromSignup } from "@/lib/signupRequest";
import { denialHtml, denialSubject, denialText } from "@/lib/denialNotice";
import { queueEmail } from "@/lib/mailer";
import { emailForUser, postMessage } from "@/lib/messagesServer";

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
// ── The exception: a tier that requires PLACEMENTS ──────────────────────────
//
// Approving a sign-up into a series, season or class marked "Placements
// Required" does NOT create a roster entry. That tier is earned in a placement
// session, so approving it means "registration acknowledged, now go and race
// for it" — the row moves to `approved_for_placements`, which takes it out of
// the queue and off the badge while leaving the driver on no grid at all. They
// join one when an admin places them in the Time Trials hub and builds the
// roster from that session.
//
// The driver PROFILE is still created and linked, exactly as it is for any
// other approval. That isn't the roster — it's the person — and without it the
// placement night has no profile to search for them by, and the entry the
// roster build eventually creates would carry no `driver_id` or `user_id`,
// leaving them racing a season their own Dashboard couldn't see (see
// planRosterBuild in lib/timeTrials.js, which copies both off the trial row).
//
// The gate is resolved LIVE, not read off the request: an admin who ticked the
// switch after these people signed up needs approval to respect it, and one who
// has since untucked it needs approval to seat them normally.
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
  // A registration approved for placements is NOT finished: nobody is on a
  // roster, and a driver who never turns up to a session would otherwise sit in
  // that state for ever with no way out. Denying is therefore still open to an
  // admin; approving is not, since it has already been approved.
  if (!OPEN_STATUSES.includes(req.status)) {
    return NextResponse.json({ error: "This sign-up has already been resolved." }, { status: 400 });
  }
  if (isAwaitingPlacement(req) && action !== "deny") {
    return NextResponse.json({
      error: "This registration is already approved and waiting on a placement session."
        + " Place the driver from Time Trials & Placements to put them on a roster.",
      code: "awaiting-placement",
    }, { status: 400 });
  }

  const stamp = { resolved_at: new Date().toISOString(), resolved_by: admin.uid };

  if (action === "deny") {
    const reason = String(body.reason ?? "").trim().slice(0, 300) || null;
    await reqRef.update({
      status: DENIED, ...stamp,
      deny_reason: reason,
      // Not read by the player yet. Until it is, the notice sits at the top of
      // their Sign-ups screen and that season is held back from their join
      // list — see lib/denialNotice.js.
      player_seen_at: null,
    });

    // Tell them. A denial the player never hears about is the same to them as a
    // sign-up that vanished, and they'll re-submit the identical form.
    //
    // Queued, not sent inline (lib/mailer.js): the admin's decision is already
    // recorded, and it must not depend on a mail server answering. The same
    // message is waiting in the app either way, which is what makes email the
    // nudge rather than the mechanism.
    const denied = { id, ...req, deny_reason: reason };
    const to = req.user_email || null;
    const origin = new URL(request.url).origin;
    const mail_id = await queueEmail({
      to,
      subject: denialSubject(denied),
      text: denialText(denied, { signupUrl: `${origin}/signups` }),
      html: denialHtml(denied, { signupUrl: `${origin}/signups` }),
      kind: "signup-denied",
      meta: { uid: req.uid || null, request_id: id, season_id: req.season_id || null },
    });

    // And onto the board, where they can answer it. A number change refused is
    // a different sentence from a sign-up refused — the driver is still racing,
    // just not under the number they wanted.
    await announce(req, isNumberChange(req) ? "number_denied" : "signup_denied",
      { adminNote: reason || "", admin, emailed: !!mail_id,
        extra: { previous_number: String(req.current_number ?? "").trim() } });

    return NextResponse.json({ ok: true, id, status: DENIED, reason, emailed: !!mail_id });
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
    await announce(req, "number_approved",
      { admin, extra: { number, previous_number: previous } });
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
    await announce(req, "signup_approved", { admin });
    return NextResponse.json({
      ok: true, id, status: APPROVED, driver_id: driverId, driver_name: driverName,
      entry_id: existing.id, created_driver,
      note: "They were already on this season's roster, so no second entry was created.",
    });
  }

  // ── The placements gate ──────────────────────────────────────────────────
  //
  // Checked HERE — after the driver profile exists, before any entry is made —
  // because those are exactly the two halves this outcome splits: the person is
  // acknowledged, the grid place is not given. Somebody already on the roster
  // was handled above and is unaffected: they're racing, so there is nothing
  // left to place them into.
  //
  // Resolved live against the series/season/class as they stand now. A failure
  // here would seat somebody the gate exists to keep off a grid, so it is the
  // one lookup in this route that is NOT allowed to fail quietly — if the gate
  // can't be read, the approval is refused and the admin is told to try again.
  let gated;
  try {
    const resolved = await placementsRequiredFor([{ ...req, id }], { strict: true });
    gated = !!resolved[id];
  } catch (err) {
    console.error("Placements gate check failed at approval", err);
    return NextResponse.json({
      error: "Couldn't check whether this series requires placements, so nothing was changed."
        + " Try again in a moment.",
      code: "gate-unreadable",
    }, { status: 503 });
  }

  // The rule itself lives in lib/signupQueue.js, named and tested, rather than
  // as a bare `if` here — see signupApprovalPlan.
  const plan = signupApprovalPlan({ placementsRequired: gated });
  if (!plan.creates_entry) {
    await reqRef.update({
      status: plan.status, ...stamp,
      driver_id: driverId,
      // Explicitly null rather than absent: this approval created no entry, and
      // a reader that finds a stale id here would think it had.
      entry_id: null,
    });
    await announce(req, "signup_placements", { admin });
    return NextResponse.json({
      ok: true, id, status: plan.status,
      awaiting_placement: true,
      driver_id: driverId, driver_name: driverName, created_driver,
      entry_id: null,
      note: `${driverName || req.name || "They"} are registered for placements — not on the roster.`
        + " Place them from Time Trials & Placements and build the roster from that session.",
    });
  }

  // Their number may have gone while the request waited. Better to seat them
  // without one — and say so — than to refuse the approval outright.
  let number = String(req.number ?? "").trim().slice(0, 3);
  const notes = [];
  if (number && carNumberTaken(rosterSnap.docs.map(d => d.data().number), number)) {
    notes.push(`#${number} was taken while this sign-up was waiting, so they were added without a number.`);
    number = "";
  }

  // Same for the car they picked: an admin can cap how many drivers run each
  // one, and the last seat can go while a request sits in the queue. Seating
  // them without a car and SAYING so beats refusing the approval outright —
  // they're on the roster, and the car is a question they can answer again on
  // the season's own screen.
  let car = req.car || "";
  if (car) {
    const cap = await carCapacityAtApproval(req, season, rosterSnap, car);
    if (cap?.full) {
      notes.push(`${cap.name} was full (${cap.taken} of ${cap.max}) by the time this was approved,`
        + " so they were added without a car and can pick another one.");
      car = "";
    }
  }
  const note = notes.join(" ");

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
    ...(car ? { selected_car: car, selected_car_at: new Date().toISOString() } : {}),
    created_at: new Date().toISOString(),
    created_by: admin.uid,
    self_signup: true,
    approved_from_signup: id,
    ...(season.league_id ? { league_id: season.league_id } : {}),
  };
  const entryRef = await db().collection("entries").add(entryDoc);

  await reqRef.update({ status: APPROVED, ...stamp, entry_id: entryRef.id, driver_id: driverId });

  // Onto the board: this is somebody's first minute in the series, and the
  // welcome card is what tells them where to go next. `note` carries anything
  // that had to change on the way in (a number or car that went while they
  // waited), so they're not left to notice it themselves.
  await announce(req, "signup_approved",
    { adminNote: note, admin, extra: { number, car } });

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

// Is the car this sign-up asked for full, as of right now? Resolved against the
// season's own settings rather than anything stored on the request, because the
// admin may have added, removed or re-capped cars while it waited.
async function carCapacityAtApproval(req, season, rosterSnap, car) {
  try {
    const [seriesDoc, classSnap] = await Promise.all([
      season.series_id ? db().collection("series").doc(season.series_id).get() : null,
      db().collection("classes").where("season_id", "==", season.id).get(),
    ]);
    const series = seriesDoc?.exists ? { id: seriesDoc.id, ...seriesDoc.data() } : null;
    const gameId = season.game_id || series?.game_id;
    const gameDoc = gameId ? await db().collection("games").doc(gameId).get() : null;
    const game = gameDoc?.exists ? { id: gameDoc.id, ...gameDoc.data() } : null;
    const classes = classSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const cls = classes.find(c => (req.class_ids || []).includes(c.id)) || null;
    const rules = resolveSignupRules({ game, series, season, cls });

    // Everyone already seated, plus everyone else still queued — but NOT this
    // request, which is the one being seated.
    const others = (await openRequestsForSeason(season.id)).filter(r => r.id !== req.id);
    return carCapacity(
      rules.car_entries, carCounts([...rosterSnap.docs.map(d => d.data()), ...others]), car);
  } catch (err) {
    // Never fail an approval over the capacity check — the roster place is what
    // matters, and a car that slipped past a cap is a thing an admin can fix.
    console.error("Car capacity check failed at approval", err);
    return null;
  }
}

// Announce a decision on the league's message board, so it reaches the player's
// Dashboard rather than only changing a document they can't see. Never allowed
// to fail the decision itself — see postMessage.
async function announce(req, kind, { adminNote = "", admin, extra = {}, emailed = false } = {}) {
  return postMessage({
    uid: req.uid,
    leagueId: req.league_id || null,
    kind,
    adminNote,
    admin: { uid: admin?.uid || null, name: admin?.name || admin?.email || null },
    // `emailed` says a fuller message has already gone out for this decision —
    // the denial mail, which explains the reason properly. Two emails for one
    // decision is how people learn to filter a league's mail into the bin.
    email: emailed ? null : await emailForUser(req.uid),
    context: {
      season_id: req.season_id || "",
      season_name: req.season_name || "Season",
      series_id: req.series_id || "",
      series_name: req.series_name || "Series",
      game_id: req.game_id || "",
      game_name: req.game_name || "",
      number: String(req.number ?? "").trim(),
      car: req.car || "",
      driver_name: req.driver_name || req.name || "",
      ...extra,
    },
  });
}
