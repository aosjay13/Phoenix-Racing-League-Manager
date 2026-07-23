import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withUser, isAdmin, isEnvAdmin } from "@/lib/serverAuth";

// Called after sign-in: creates/refreshes the user doc and returns it.
export const GET = withUser(async (request, ctx, user) => {
  const ref = db().collection("users").doc(user.uid);
  const doc = await ref.get();
  const admin = await isAdmin(user);
  if (!doc.exists) {
    const profile = {
      display_name: user.name || user.email?.split("@")[0] || "Driver",
      email: user.email || null,
      photo_url: user.picture || null,
      bio: "",
      country: "",
      number: null,
      role: admin ? "admin" : "player",
      created_at: new Date().toISOString(),
    };
    await ref.set(profile);
    return NextResponse.json({ uid: user.uid, ...profile, is_admin: admin, env_admin: isEnvAdmin(user.email) });
  }
  if (admin && doc.data().role !== "admin") await ref.update({ role: "admin" });
  return NextResponse.json({ uid: user.uid, ...doc.data(), is_admin: admin || doc.data().role === "admin", env_admin: isEnvAdmin(user.email) });
});

const EDITABLE = ["display_name", "photo_url", "bio", "country", "number", "favorite_car", "socials"];

export const PATCH = withUser(async (request, ctx, user) => {
  const body = await request.json();
  const updates = {};
  for (const f of EDITABLE) if (body[f] !== undefined) updates[f] = body[f];
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  await db().collection("users").doc(user.uid).set(updates, { merge: true });
  return NextResponse.json({ ok: true });
});
