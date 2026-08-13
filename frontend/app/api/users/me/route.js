import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser, getUserRole, isEnvAdmin } from "@/lib/serverAuth";
import { isStaffRole, roleLevel } from "@/lib/roles";
import { UPLOAD_DENIED_ERROR, canUploadImages, stripImageFields } from "@/lib/imagePermissions";

// Called after sign-in: creates/refreshes the user doc and returns it. Also
// reports the single driver profile linked to this account (driver_id/name) —
// each account may hold at most one, which the claim flow enforces.
export const GET = withUser(async (request, ctx, user) => {
  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  const role = await getUserRole(user);         // "owner" for env admins, else stored role
  const envAdmin = isEnvAdmin(user.email);

  const poolSnap = await db().collection("drivers").where("user_id", "==", user.uid).limit(1).get();
  const driver_id = poolSnap.empty ? null : poolSnap.docs[0].id;
  const driver_name = poolSnap.empty ? null : (poolSnap.docs[0].data().name || null);

  if (!doc.exists) {
    const profile = {
      display_name: user.name || user.email?.split("@")[0] || "Driver",
      email: user.email || null,
      photo_url: user.picture || null,
      bio: "",
      country: "",
      number: null,
      role,
      created_at: new Date().toISOString(),
    };
    await ref.set(profile);
    return NextResponse.json({ uid: user.uid, ...profile, role, role_level: roleLevel(role), is_admin: isStaffRole(role), env_admin: envAdmin, driver_id, driver_name });
  }
  // Keep permanent env-var owners' stored role in sync so listings agree.
  if (envAdmin && doc.data().role !== "owner") await ref.update({ role: "owner" });
  return NextResponse.json({ uid: user.uid, ...doc.data(), role, role_level: roleLevel(role), is_admin: isStaffRole(role), env_admin: envAdmin, driver_id, driver_name });
});

const EDITABLE = ["display_name", "photo_url", "bio", "country", "number", "favorite_car", "socials"];
// `photo_url` is an image, and images cost storage — only the Owner may put a
// new one in (see lib/imagePermissions.js). The picture a player already has,
// including the one their sign-in account came with, keeps showing everywhere;
// what they can't do is upload another. Saving the rest of the profile with
// the same photo_url they were shown is not a change and passes through.
const IMAGE_EDITABLE = ["photo_url"];

export const PATCH = withUser(async (request, ctx, user) => {
  const body = await request.json();
  const ref = db().collection("users").doc(user.uid);
  const updates = {};
  for (const f of EDITABLE) if (body[f] !== undefined) updates[f] = body[f];

  let write = updates;
  if (IMAGE_EDITABLE.some(f => f in updates) && !canUploadImages(await getUserRole(user))) {
    const guarded = stripImageFields(updates, {
      fields: IMAGE_EDITABLE,
      existing: (await ref.get()).data() || {},
    });
    if (guarded.stripped.length && !Object.keys(guarded.updates).length) {
      return NextResponse.json({ error: UPLOAD_DENIED_ERROR }, { status: 403 });
    }
    write = guarded.updates;
  }

  if (!Object.keys(write).length) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  await ref.set(write, { merge: true });
  return NextResponse.json({ ok: true });
});
