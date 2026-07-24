import { db } from "@/lib/firebase";

// The canonical display name for a pool driver: a linked player account's
// display_name wins (that's what the public profile shows), otherwise the
// driver-pool doc's own `name`. Kept in one place so the cascade and the
// backfill always agree on "the current name".
export async function canonicalNameForDriver(driverId, driverData = null) {
  const data = driverData || (await db().collection("drivers").doc(driverId).get()).data();
  if (!data) return null;
  if (data.user_id) {
    const u = await db().collection("users").doc(data.user_id).get();
    const dn = u.exists ? String(u.data().display_name || "").trim() : "";
    if (dn) return dn;
  }
  const name = String(data.name || "").trim();
  return name || null;
}

// Cascade a driver's current name onto every roster entry that resolves to
// them — by `driver_id`, or by `user_id` for legacy entries written before
// driver_id existed. ONLY the denormalized `name` string on those entries is
// touched: results, stats, standings history and driver profiles are never
// read for mutation here, so all historical data stays perfectly intact. This
// is what makes a Driver Profile rename show up in old race results, event
// pages, the results editor, and standings (all of which display entry.name).
//
// Scoped to the driver's own league so a rename never bleeds into another
// league where the same person races under a separate pool driver.
export async function syncEntryNamesForDriver(driverId, driverData = null) {
  const data = driverData || (await db().collection("drivers").doc(driverId).get()).data();
  if (!data) return 0;
  const name = await canonicalNameForDriver(driverId, data);
  if (!name) return 0;

  const scope = q => (data.league_id ? q.where("league_id", "==", data.league_id) : q);
  const byId = await scope(db().collection("entries").where("driver_id", "==", driverId)).get();
  const seen = new Set(byId.docs.map(d => d.id));

  let byUserDocs = [];
  if (data.user_id) {
    const byUser = await scope(db().collection("entries").where("user_id", "==", data.user_id)).get();
    byUserDocs = byUser.docs.filter(d => !seen.has(d.id));
  }

  // Only rewrite entries whose stored name actually differs.
  const targets = [...byId.docs, ...byUserDocs].filter(d => String(d.data().name || "") !== name);
  for (let i = 0; i < targets.length; i += 450) {
    const batch = db().batch();
    for (const d of targets.slice(i, i + 450)) batch.update(d.ref, { name });
    await batch.commit();
  }
  return targets.length;
}
