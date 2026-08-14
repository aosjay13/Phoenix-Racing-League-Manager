// Who may put an image into the app.
//
// Every logo and avatar in this league lives in cloud storage, and cloud
// storage is billed by the byte for as long as the file exists. One admin
// uploading a 900 KB banner is nothing; four staff roles across a dozen
// leagues doing it on every game, series, season, track and team is a bill
// nobody agreed to. So uploading is the ONE league power that isn't shared by
// the four staff roles: it belongs to the Owner alone, the person whose
// storage it actually is.
//
// The rule lives here, once, and is read by both halves of the app:
//
//   • the browser, which hides the file pickers from everybody else
//     (components/ImageUpload.jsx), and
//   • the server, which is what actually enforces it — /api/upload refuses the
//     file, and the entity routes drop an image field out of a write from
//     anyone who isn't an Owner (lib/entityApi.js).
//
// The UI half is a courtesy; a hidden input is not a permission. Anything that
// posts straight at the API — a stale tab, a script, a screen that forgets to
// check — meets the same answer.
//
// What is NOT restricted, deliberately: DISPLAYING images. Every <img>, avatar
// and logo across the public pages keeps rendering whatever is stored, because
// the Owner is still uploading them and everyone else still needs to see them.

import { normalizeRole } from "@/lib/roles";

// The one role allowed to upload.
export const IMAGE_UPLOAD_ROLE = "owner";

export function canUploadImages(role) {
  return normalizeRole(role) === IMAGE_UPLOAD_ROLE;
}

// What the API says when it won't take a file. Written for the person reading
// it — an Admin who has every other power and is about to wonder whether
// something is broken — so it names the reason rather than just refusing.
export const UPLOAD_DENIED_ERROR =
  "Owner access required to upload or change images.";

// Which fields of a written document hold an image. Read off the field spec
// (lib/entityApi.js marks them `image: true`) so a new image field is covered
// the moment it's declared, rather than the day somebody remembers to add it
// to a list over here.
export function imageFieldNames(fields = {}) {
  return Object.entries(fields)
    .filter(([, opts]) => opts && opts.image)
    .map(([name]) => name);
}

// Two image values are "the same picture" when they're the same string; blank,
// null and undefined are all "no picture".
function sameImage(a, b) {
  return String(a ?? "") === String(b ?? "");
}

// Drop the image fields a non-Owner is trying to CHANGE.
//
// Changing is the operative word. An edit form posts every field it renders,
// so an Admin renaming a game sends the logo it already had straight back —
// refusing that (or blanking it) would break ordinary editing and quietly
// destroy the Owner's work. So a value identical to what's stored passes
// through untouched, and only a genuinely new image is removed.
//
// Returns { updates, stripped }: the write to actually perform, and the fields
// that were taken out of it (so a route can say so).
export function stripImageFields(updates = {}, { fields = [], existing = null, allowed = false } = {}) {
  if (allowed) return { updates, stripped: [] };
  const out = { ...updates };
  const stripped = [];
  for (const field of fields) {
    if (!(field in out)) continue;
    const before = existing ? existing[field] : "";
    if (sameImage(out[field], before)) continue;   // unchanged — not a new image
    delete out[field];
    stripped.push(field);
  }
  return { updates: out, stripped };
}
