import { NextResponse } from "next/server";
import { bucket } from "@/lib/firebase";
import { withUser, isAdmin } from "@/lib/serverAuth";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

export const POST = withUser(async (request, ctx, user) => {
  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "logo");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WebP, GIF or SVG images allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });
  }
  // Players can only upload their own avatar; league imagery is admin-only.
  if (kind !== "avatar" && !(await isAdmin(user))) {
    return NextResponse.json({ error: "Admin access required for league images" }, { status: 403 });
  }

  const ext = (file.name?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${kind}/${user.uid}/${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const blob = bucket().file(path);
  await blob.save(buf, { contentType: file.type, resumable: false });
  await blob.makePublic();

  return NextResponse.json({ url: `https://storage.googleapis.com/${bucket().name}/${path}` }, { status: 201 });
});
