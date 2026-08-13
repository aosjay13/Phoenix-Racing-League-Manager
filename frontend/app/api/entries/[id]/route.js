import { NextResponse } from "next/server";
import { coerceField, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";
import { carNumberTaken, normalizeCarNumber } from "@/lib/carSelection";
import { syncLineupFromEntry } from "@/lib/teamsServer";
import { emailForUser, postMessage } from "@/lib/messagesServer";

// Edit one roster entry — the admin's side of "change someone's number".
//
// Mirrors the generic doc-update (the same field specs, the same coercion) and
// adds the one rule an entry has that no other collection does: a car number is
// unique within its season. The sign-up form enforces that as a player types,
// the approvals queue enforces it before granting a change, and this enforces it
// when an admin sets one by hand. Without the check here the one path that
// bypassed it was the one most likely to be used to FIX a clash, which is how
// two drivers end up sharing #24 and every grid that keys off a number goes
// wrong.
//
// Clearing a number (blank) is always allowed — racing without one is legal, and
// any number of entries can have none.
export const PATCH = withAdmin(async (request, { params }, user) => {
  const body = await request.json().catch(() => ({}));
  const updates = {};
  for (const [name, opts] of Object.entries(SPECS.entries.fields)) {
    if (body[name] !== undefined) {
      const coerced = coerceField(opts, body[name]);
      if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
      updates[name] = coerced.value;
    }
  }
  if (SPECS.entries.normalize) Object.assign(updates, SPECS.entries.normalize(updates) || {});
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const ref = db().collection("entries").doc(params.id);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wanted = normalizeCarNumber(updates.number);
  const seasonId = doc.data().season_id;
  if (wanted && seasonId) {
    const snap = await db().collection("entries").where("season_id", "==", seasonId).get();
    const others = snap.docs.filter(d => d.id !== params.id);
    if (carNumberTaken(others.map(d => d.data().number), wanted)) {
      const holder = others.find(d => normalizeCarNumber(d.data().number) === wanted);
      return NextResponse.json({
        error: `#${wanted} is already ${holder?.data().name || "another driver"}'s in this season. `
          + "Change or clear theirs first.",
        code: "number-taken",
        number: wanted,
      }, { status: 409 });
    }
  }

  await ref.update(updates);

  // Setting a driver's team here is the same statement as putting them on that
  // team's line-up for the season, so the line-up is updated to match (see
  // lib/teamsServer.js). Never fail the edit over it — the entry's own team tag
  // still resolves them either way.
  if (updates.team_id !== undefined) {
    const entry = { ...doc.data(), ...updates };
    try {
      await syncLineupFromEntry({
        seasonId: entry.season_id,
        driverId: entry.driver_id,
        teamId: updates.team_id,
        userId: user.uid,
      });
    } catch (err) {
      console.error("Team line-up sync failed", err);
    }
  }

  return NextResponse.json({ id: params.id, ...doc.data(), ...updates });
});

// Remove a driver from a season's roster.
//
// This cascades to their saved results across every race and session of the
// season, because an entry's results are meaningless without it — they'd be
// counted forever against a row nobody can see, or silently reattach if the id
// were ever reused.
//
// That is exactly why a removal with results behind it is REFUSED unless the
// caller says so explicitly (`?confirm=results`, which the roster's confirm
// dialog sets once it has told the admin how many there are). Dropping a driver
// who signed up and never raced is the common case and stays a single click;
// deleting eight races of somebody's history should never be one.
export const DELETE = withAdmin(async (request, { params }, admin) => {
  const resultsSnap = await db().collection("results").where("entry_id", "==", params.id).get();
  const docs = resultsSnap.docs;

  // Read before it's gone: who this was, and which season they're being taken
  // out of. Being removed was the most alarming of the silent admin actions —
  // a driver's entry simply vanished, which reads far more like the app losing
  // it than like a decision somebody made.
  const entrySnap = await db().collection("entries").doc(params.id).get();
  const entry = entrySnap.exists ? entrySnap.data() : null;

  const confirmed = new URL(request.url).searchParams.get("confirm") === "results";
  if (docs.length && !confirmed) {
    return NextResponse.json({
      error: `This driver has ${docs.length} recorded result${docs.length === 1 ? "" : "s"} in this season, `
        + "which would be deleted with them.",
      code: "has-results",
      results: docs.length,
    }, { status: 409 });
  }

  for (let i = 0; i < docs.length; i += 450) {
    const batch = db().batch();
    docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await db().collection("entries").doc(params.id).delete();

  // Tell them. An entry that just disappears is the admin action most likely to
  // be read as a fault in the app rather than as a decision — and the driver
  // has no other way to find out short of noticing they're missing from a
  // roster they may not think to check.
  //
  // Only where the entry was linked to an account: a hand-typed roster row for
  // somebody with no login has nobody to tell.
  await announceRemoval(entry, admin);

  return NextResponse.json({ ok: true, results_deleted: docs.length });
});

async function announceRemoval(entry, admin) {
  const uid = entry?.user_id
    || (entry?.driver_id ? await uidForDriver(entry.driver_id) : null);
  if (!uid) return;
  const season = entry.season_id
    ? await db().collection("seasons").doc(entry.season_id).get() : null;
  const seasonData = season?.exists ? season.data() : null;
  const series = seasonData?.series_id
    ? await db().collection("series").doc(seasonData.series_id).get() : null;
  await postMessage({
    uid,
    leagueId: entry.league_id || seasonData?.league_id || null,
    kind: "roster_removed",
    admin: { uid: admin?.uid || null, name: admin?.name || admin?.email || null },
    email: await emailForUser(uid),
    context: {
      season_id: entry.season_id || "",
      season_name: seasonData?.name || "that season",
      series_id: seasonData?.series_id || "",
      series_name: series?.exists ? (series.data().name || "Series") : "Series",
      game_id: seasonData?.game_id || "",
      number: String(entry.number ?? "").trim(),
      car: entry.selected_car || "",
      driver_name: entry.name || "",
    },
  });
}

// A roster entry usually names the driver rather than the account; the account
// is found through the driver profile it's linked to.
async function uidForDriver(driverId) {
  try {
    const doc = await db().collection("drivers").doc(driverId).get();
    return doc.exists ? (doc.data().user_id || null) : null;
  } catch {
    return null;
  }
}
