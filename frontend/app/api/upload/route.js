import { NextResponse } from "next/server";
import { bucket } from "@/lib/firebase";
import { withUser, getUserRole } from "@/lib/serverAuth";
import { UPLOAD_DENIED_ERROR, canUploadImages } from "@/lib/imagePermissions";

const MAX_BYTES = 1 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

// The only door into cloud storage this app has: the Firebase Storage rules
// (firebase/storage.rules) refuse every direct client write, so a file becomes
// a stored file HERE or not at all.
//
// Which makes this the place the Owner-only rule is actually enforced. Hiding
// the file pickers (components/ImageUpload.jsx) is a courtesy to the person
// using the app; this is the part that means it. Every kind of image goes
// through the same check — logos, and avatars too — because every one of them
// is a file the league pays to keep. See lib/imagePermissions.js.
export const POST = withUser(async (request, ctx, user, leagueId) => {
  // Checked BEFORE the body is read: there is no reason to pull a megabyte off
  // the wire for a request that cannot be allowed to store it. Resolved against
  // the ACTIVE LEAGUE: being the Owner of one league buys no storage in another.
  if (!canUploadImages(await getUserRole(user, leagueId))) {
    return NextResponse.json({ error: UPLOAD_DENIED_ERROR }, { status: 403 });
  }

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
    return NextResponse.json({ error: "Image must be under 1 MB" }, { status: 400 });
  }

  const ext = (file.name?.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${kind}/${user.uid}/${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const blob = bucket().file(path);
  await blob.save(buf, { contentType: file.type, resumable: false });
  await blob.makePublic();

  return NextResponse.json({ url: `https://storage.googleapis.com/${bucket().name}/${path}` }, { status: 201 });
});
