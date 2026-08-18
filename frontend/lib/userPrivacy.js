// What must never leave the server on a user document.
//
// Four routes hand a `users/{uid}` document to a browser, and every one of them
// does it by SPREADING the stored object after destructuring a few fields away:
//
//   const { email, role, ...pub } = doc.data();
//
// That shape is a trapdoor. It publishes every field the document happens to
// carry, including ones added later by code that never looked at these routes —
// which is exactly how a secret gets published by a change that never mentions
// it. The recovery passphrase hash (lib/recoveryServer.js) is the first field
// where that would matter, and it must not be the reason we find out.
//
// So the list lives here, once, and the routes strip through publicUserFields()
// rather than each keeping their own idea of what is private.

// Fields never sent to any client, on any route.
export const PRIVATE_USER_FIELDS = [
  // The recovery passphrase's hash and salt. A hash is not a password, but it
  // is offline-crackable, and publishing one for every account in the league on
  // a route anybody can call would be handing out the guessing game for free.
  "recovery",
];

// Fields that are only for the account itself and its league's staff — the
// public directory and public profiles strip these too.
export const SELF_ONLY_USER_FIELDS = [
  "email",
  // Standing. `role` is the legacy global field and `league_roles` the real
  // map; neither is anybody else's business.
  "role",
  "league_roles",
  // Housekeeping the app writes about an account. Useful to staff, noise (and
  // needless detail about somebody's account history) to everyone else.
  "signup_pending",
  "signup_league_id",
  "verified_by_owner",
  "password_set_by_owner",
  "recovered_at",
];

function strip(data, fields) {
  const out = { ...(data || {}) };
  for (const field of fields) delete out[field];
  return out;
}

// Everything the ACCOUNT ITSELF may see about its own document — private fields
// removed, its own standing kept.
export function selfUserFields(data) {
  return strip(data, PRIVATE_USER_FIELDS);
}

// Everything ANYONE may see: the public directory, a public driver profile.
export function publicUserFields(data) {
  return strip(data, [...PRIVATE_USER_FIELDS, ...SELF_ONLY_USER_FIELDS]);
}
