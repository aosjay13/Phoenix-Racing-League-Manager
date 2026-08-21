import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { emailForUser, postMessage } from "@/lib/messagesServer";
import { docInLeague, withAdmin } from "@/lib/serverAuth";
import { linkedDriver } from "@/lib/carSelectionServer";
import { NEW_DRIVER_KIND, requestKind } from "@/lib/signupRequest";
import { carNumberTaken, seasonAcceptsSignups } from "@/lib/carSelection";
import { normalizeClassIds } from "@/lib/classFilter";
import { withStatsRefresh } from "@/lib/statsCache";

// Admin-only: resolve a pending driver-profile request. This route is the ONLY
// place a user-requested driver profile is ever created or linked — nothing in
// the player-facing flow writes a driver, which is what makes adding one to the
// league an admin decision rather than an automatic one.
//
//   body.action = "approve" → applies the request (see the two kinds below),
//                             then auto-denies siblings competing for the same
//                             driver.
//   body.action = "deny"    → just marks the request denied.
//
// The two kinds (see lib/signupRequest.js):
//
//   "claim"      — an existing driver profile is this account's. Approval
//                  writes drivers.user_id, detaching any driver the user held
//                  before (one profile per account).
//   "new_driver" — the league has never seen this person. Approval creates the
//                  driver profile from the information they submitted (name +
//                  aliases / connected accounts) and, when the request carried
//                  a series sign-up, the season roster entry as well — so an
//                  approval is the single click that gets them racing.
const handlePATCH = withAdmin(async (request, { params }, admin, role, leagueId) => {
  const { id } = params;
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  const reqRef = db().collection("claim_requests").doc(id);
  const reqDoc = await reqRef.get();
  if (!reqDoc.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const req = reqDoc.data();
  // Only this league's admins answer this league's queue. Addressed by id, so
  // the check has to be here as well as on the listing.
  if (!docInLeague(req, leagueId)) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (req.status !== "pending") {
    return NextResponse.json({ error: "This request has already been resolved." }, { status: 400 });
  }

  const stamp = { resolved_at: new Date().toISOString(), resolved_by: admin.uid };

  // Announce whichever way it went, on the board the player actually reads.
  const announce = async (kind, driverName, adminNote = "") => postMessage({
    uid: req.uid,
    leagueId: req.league_id || null,
    kind,
    adminNote,
    admin: { uid: admin?.uid || null, name: admin?.name || admin?.email || null },
    email: await emailForUser(req.uid),
    context: { driver_name: driverName || req.driver_name || "" },
  });

  if (action === "deny") {
    const reason = String(body.reason ?? "").trim().slice(0, 300) || "";
    await reqRef.update({ status: "denied", ...stamp, deny_reason: reason || null });
    await announce("claim_denied", req.driver_name, reason);
    return NextResponse.json({ ok: true, id, status: "denied" });
  }

  if (action !== "approve") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // A profile may have been linked (or the request's own account given one)
  // between the request being filed and this click — IN THIS LEAGUE. The same
  // account holding a profile in another league is normal and none of this
  // decision's business.
  const requestLeagueId = req.league_id || leagueId;
  const alreadyOwned = await linkedDriver(req.uid, requestLeagueId);

  if (requestKind(req) === NEW_DRIVER_KIND) {
    return approveNewDriver({ id, req, reqRef, stamp, admin, alreadyOwned, leagueId: requestLeagueId });
  }

  const targetRef = db().collection("drivers").doc(req.driver_id);
  const targetDoc = await targetRef.get();
  if (!targetDoc.exists) {
    return NextResponse.json({ error: "The requested driver profile no longer exists." }, { status: 404 });
  }
  if (!docInLeague(targetDoc.data(), requestLeagueId)) {
    return NextResponse.json({ error: "The requested driver profile is not in this league." }, { status: 404 });
  }

  const batch = db().batch();

  // Detach the driver this user held in THIS league (one link per user per
  // league); their profile in any other league is left exactly as it is.
  if (alreadyOwned && alreadyOwned.id !== req.driver_id) {
    batch.update(db().collection("drivers").doc(alreadyOwned.id), { user_id: null });
  }

  // Apply the requested link.
  batch.update(targetRef, { user_id: req.uid });

  // Resolve this request, and auto-deny any other pending requests for the same
  // driver (it can only belong to one account).
  const siblings = await db().collection("claim_requests")
    .where("driver_id", "==", req.driver_id)
    .where("status", "==", "pending").get();
  siblings.docs.forEach(s => {
    if (s.id === id) batch.update(s.ref, { status: "approved", ...stamp });
    else batch.update(s.ref, { status: "denied", ...stamp, note: "Auto-denied: profile claimed by another account." });
  });

  await batch.commit();
  await announce("claim_approved", req.driver_name);
  return NextResponse.json({ ok: true, id, status: "approved", driver_id: req.driver_id, uid: req.uid });
});

// Create the driver this player asked for, and put them on the season they
// wanted to join. Written as two independent steps on purpose: if the season
// has closed or their number has gone since they asked, the driver profile is
// still created and the admin is told what didn't carry over, rather than the
// whole approval failing.
async function approveNewDriver({ id, req, reqRef, stamp, admin, alreadyOwned, leagueId }) {
  const name = String(req.driver_name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "This request has no driver name to create." }, { status: 400 });
  }
  if (alreadyOwned) {
    return NextResponse.json({
      error: `${req.user_name || "That account"} already has a driver profile in this league (“${alreadyOwned.name}”). Deny this request, or unlink that profile first.`,
    }, { status: 409 });
  }

  const driverDoc = {
    name,
    user_id: req.uid,
    notes: "",
    aliases: Array.isArray(req.aliases) ? req.aliases : [],
    created_at: new Date().toISOString(),
    created_by: admin.uid,
    // Records that this profile came from a player's request an admin approved,
    // rather than being typed in by an admin directly.
    created_from_request: id,
    // The league the request was filed in. A driver belongs to one league, and
    // this is the one the player asked to race in.
    ...(leagueId ? { league_id: leagueId } : {}),
  };
  const driverRef = await db().collection("drivers").add(driverDoc);

  // The season sign-up that rode along with the request, if any.
  let entry_id = null;
  let signup_note = "";
  // Kept for the message this approval sends: what they were actually put on,
  // named as it was at the moment of the decision.
  let joined = null;
  const signup = req.signup;
  if (signup?.season_id) {
    const seasonDoc = await db().collection("seasons").doc(signup.season_id).get();
    const raw = seasonDoc.exists ? { id: seasonDoc.id, ...seasonDoc.data() } : null;
    // A season that has since been moved to (or was always in) another league is
    // treated as gone rather than joined — the driver profile is still created.
    const season = raw && docInLeague(raw, leagueId) ? raw : null;
    if (!season) {
      signup_note = "The season they asked to join no longer exists, so no roster entry was created.";
    } else if (!seasonAcceptsSignups(season)) {
      signup_note = `${season.name || "That season"} has been marked complete since they asked, so no roster entry was created.`;
    } else {
      const rosterSnap = await db().collection("entries").where("season_id", "==", season.id).get();
      const alreadyEntered = rosterSnap.docs.some(d => {
        const e = d.data();
        return e.driver_id === driverRef.id || (e.user_id && e.user_id === req.uid);
      });
      if (alreadyEntered) {
        signup_note = "They were already on that season's roster, so no second entry was created.";
      } else {
        // Their number may have been taken while the request sat in the queue.
        // Better to enter them without one than to refuse the approval.
        let number = String(signup.number ?? "").trim().slice(0, 3);
        if (number && carNumberTaken(rosterSnap.docs.map(d => d.data().number), number)) {
          signup_note = `#${number} was taken while this request was waiting, so they were added without a number.`;
          number = "";
        }
        // Only classes that still belong to that season.
        const classSnap = await db().collection("classes").where("season_id", "==", season.id).get();
        const valid = new Set(classSnap.docs.map(d => d.id));
        const classIds = normalizeClassIds(signup.class_ids).filter(c => valid.has(c));

        const entryDoc = {
          season_id: season.id,
          name: String(signup.name || name).trim().slice(0, 60) || name,
          driver_id: driverRef.id,
          user_id: req.uid,
          team_id: "",
          number,
          class_ids: classIds,
          class_id: classIds[0] || "",
          created_at: new Date().toISOString(),
          created_by: admin.uid,
          self_signup: true,
          approved_from_request: id,
          ...(season.league_id ? { league_id: season.league_id } : {}),
        };
        const entryRef = await db().collection("entries").add(entryDoc);
        entry_id = entryRef.id;
        joined = { season, number, car: String(signup.car ?? "").trim() };
      }
    }
  }

  await reqRef.update({ status: "approved", ...stamp, created_driver_id: driverRef.id });

  // Say so on the board. One card, not two: when this approval also put them on
  // a roster that's the bigger news by far — it's their first minute in the
  // league — so it gets the welcome treatment and mentions the profile in
  // passing. When it didn't, the profile IS the news.
  const by = { uid: admin?.uid || null, name: admin?.name || admin?.email || null };
  const email = await emailForUser(req.uid);
  if (joined) {
    const seriesDoc = joined.season.series_id
      ? await db().collection("series").doc(joined.season.series_id).get()
      : null;
    await postMessage({
      uid: req.uid,
      leagueId: req.league_id || joined.season.league_id || null,
      kind: "signup_approved",
      admin: by,
      email,
      // The note only exists when something didn't carry over (their number was
      // taken while they waited). That's exactly what they need to be told.
      adminNote: signup_note,
      context: {
        series_name: seriesDoc?.exists ? (seriesDoc.data().name || "the series") : "the series",
        season_name: joined.season.name || "the season",
        season_id: joined.season.id,
        series_id: joined.season.series_id || "",
        number: joined.number,
        car: joined.car,
        driver_name: name,
      },
    });
  } else {
    await postMessage({
      uid: req.uid,
      leagueId: req.league_id || null,
      kind: "claim_approved",
      admin: by,
      email,
      adminNote: signup_note,
      context: { driver_name: name },
    });
  }

  return NextResponse.json({
    ok: true, id, status: "approved",
    driver_id: driverRef.id, driver_name: name, uid: req.uid,
    entry_id, signup_note,
  });
}

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const PATCH = withStatsRefresh(handlePATCH);
