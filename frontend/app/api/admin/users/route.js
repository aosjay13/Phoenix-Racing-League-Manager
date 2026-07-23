import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, isEnvAdmin } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Admin-only: the full account roster — with emails, roles, and the linked
// driver profile for each user — powering the Admin ▸ User Accounts dashboard.
// (The public /api/users route deliberately strips email + role.)
export const GET = withAdmin(async () => {
  const [usersSnap, driversSnap] = await Promise.all([
    db().collection("users").get(),
    db().collection("drivers").get(),
  ]);

  // uid -> linked driver profile (first match wins; the link lives on the
  // driver doc as drivers.user_id — see /api/users/[uid] and the roster).
  const driverByUser = {};
  for (const d of driversSnap.docs) {
    const uid = d.data().user_id;
    if (uid && !driverByUser[uid]) driverByUser[uid] = { id: d.id, name: d.data().name || "Driver" };
  }

  const users = usersSnap.docs.map(doc => {
    const data = doc.data();
    const linked = driverByUser[doc.id] || null;
    const envAdmin = isEnvAdmin(data.email);
    return {
      uid: doc.id,
      display_name: data.display_name || null,
      email: data.email || null,
      photo_url: data.photo_url || null,
      // Env admins are effectively admin even if their doc hasn't been synced yet.
      role: envAdmin ? "admin" : (data.role || "player"),
      env_admin: envAdmin,
      created_at: data.created_at || null,
      driver_id: linked?.id || null,
      driver_name: linked?.name || null,
    };
  });

  users.sort((a, b) => String(a.display_name || a.email).localeCompare(String(b.display_name || b.email)));
  return NextResponse.json(users);
});
