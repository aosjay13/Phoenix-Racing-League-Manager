// Uploading images is Owner-only, because storage is billed by the byte and
// the Owner is the person paying for it. That rule is easy to state and easy
// to get subtly wrong, in two directions that both matter:
//
//   • too loose — a Statistician, or anything posting straight at the API,
//     quietly adds files nobody agreed to pay for;
//   • too tight — an Admin renaming a game sends back the logo the form showed
//     them, and a naive check reads that as "an image!" and either refuses the
//     rename or wipes the Owner's logo on save.
//
// So this pins both: who may upload, and the difference between SENDING an
// image and CHANGING one.
import assert from "node:assert";
import {
  IMAGE_UPLOAD_ROLE, canUploadImages, imageFieldNames, stripImageFields,
} from "../imagePermissions.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// ── Who ─────────────────────────────────────────────────────────────────────
check("owner may upload", canUploadImages("owner"), true);
check("the role is owner", IMAGE_UPLOAD_ROLE, "owner");
// The other three staff roles clear every other league gate and are refused
// here — that IS the feature, not an oversight.
for (const role of ["admin", "moderator", "statistician", "player"]) {
  check(`${role} may not upload`, canUploadImages(role), false);
}
// Anything unrecognised (a typo, a role from a future version, nothing at all)
// falls to "player" and is refused. Never fails open.
for (const role of ["Owner", "OWNER", "root", "", null, undefined]) {
  check(`${JSON.stringify(role)} may not upload`, canUploadImages(role), false);
}

// ── Which fields ────────────────────────────────────────────────────────────
// Image fields are read off the field spec rather than a hand-kept list, so a
// new one is covered the moment it's declared.
const gameFields = { name: { required: true }, logo_url: { image: true }, description: {} };
check("image fields come off the spec", imageFieldNames(gameFields), ["logo_url"]);
check("a spec with no images", imageFieldNames({ name: {} }), []);
check("empty spec", imageFieldNames(), []);

// ── Sending vs changing ─────────────────────────────────────────────────────
const stored = { name: "iRacing", logo_url: "https://cdn/old.png" };
const fields = ["logo_url"];

// The Owner's writes are never touched.
check("owner keeps a new logo",
  stripImageFields({ name: "iRacing", logo_url: "https://cdn/new.png" },
    { fields, existing: stored, allowed: true }),
  { updates: { name: "iRacing", logo_url: "https://cdn/new.png" }, stripped: [] });

// An Admin renaming the game: the form posted the logo it was showing, which
// is the logo already stored. Nothing changed, so nothing is stripped and the
// rename goes through with the logo intact.
check("re-posting the same logo is not a change",
  stripImageFields({ name: "iRacing 26", logo_url: "https://cdn/old.png" },
    { fields, existing: stored }),
  { updates: { name: "iRacing 26", logo_url: "https://cdn/old.png" }, stripped: [] });

// An Admin actually setting a different logo: dropped, and the rest of their
// edit still lands. Refusing the whole write would block a rename over a field
// they were never allowed to set.
check("a different logo is dropped, the rest survives",
  stripImageFields({ name: "iRacing 26", logo_url: "https://cdn/new.png" },
    { fields, existing: stored }),
  { updates: { name: "iRacing 26" }, stripped: ["logo_url"] });

// Clearing somebody else's logo is a change too — deleting the Owner's image
// costs them exactly as much work as uploading one.
check("blanking a logo is a change",
  stripImageFields({ logo_url: "" }, { fields, existing: stored }),
  { updates: {}, stripped: ["logo_url"] });

// A create has nothing stored: any non-blank image is new, a blank one isn't.
check("a create with a logo",
  stripImageFields({ name: "F1 25", logo_url: "https://cdn/new.png" }, { fields }),
  { updates: { name: "F1 25" }, stripped: ["logo_url"] });
check("a create with no logo",
  stripImageFields({ name: "F1 25", logo_url: "" }, { fields }),
  { updates: { name: "F1 25", logo_url: "" }, stripped: [] });

// null / undefined / "" all mean "no picture", so swapping between them is not
// an upload and never trips the guard.
check("null vs blank is not a change",
  stripImageFields({ logo_url: "" }, { fields, existing: { logo_url: null } }),
  { updates: { logo_url: "" }, stripped: [] });

// A write that names no image field at all is untouched, whoever sends it.
check("untouched when no image field is sent",
  stripImageFields({ name: "GT7" }, { fields, existing: stored }),
  { updates: { name: "GT7" }, stripped: [] });

// The input is never mutated — the caller still holds what it built.
const original = { name: "GT7", logo_url: "https://cdn/new.png" };
stripImageFields(original, { fields, existing: stored });
check("input is not mutated", original, { name: "GT7", logo_url: "https://cdn/new.png" });

console.log(`imagePermissions: ${n} assertions passed`);
