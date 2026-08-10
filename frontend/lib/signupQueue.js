// The pending sign-up queue: a player asking to join a season, waiting on an
// admin.
//
// Nothing a player submits from the Dashboard reaches the official roster on
// its own. A submission becomes a `signup_requests` document with status
// "pending", and an admin approving it on Drivers ▸ Roster & Teams is what
// creates the roster entry (and, for someone the league has never seen, the
// driver profile too). That is the whole point of the queue: who races is an
// admin's decision.
//
// Pure rules only — the Firestore reads live in lib/signupQueueServer.js, and
// the two are kept apart so the client can apply the same rules without pulling
// firebase-admin into the browser bundle.

import { carNumberTaken, normalizeCarNumber, sortRosterByNumber } from "@/lib/carSelection";

export const PENDING = "pending";
export const APPROVED = "approved";
export const DENIED = "denied";
// Taken back by the player before anyone decided — kept as a status rather than
// deleted, so "they asked and changed their mind" stays readable. Only PENDING
// rows count towards the queue and hold a car number, so a withdrawn one frees
// its number immediately.
export const WITHDRAWN = "withdrawn";

// ── The two kinds of thing in the queue ────────────────────────────────────
//
// Both live in `signup_requests` and both are resolved from the same Approvals
// screens, because they're the same job: a player has asked for something and
// an admin decides. Keeping them in one collection is what makes the badge, the
// queue and the approve/deny buttons cover both without a second of plumbing.
//
//   signup         "let me onto this season's roster"     → creates the entry
//   number_change  "change my car number to #12"          → edits the entry
//
// A document written before number changes existed carries no `kind` at all,
// which is why absent means "signup".
export const SIGNUP_KIND = "signup";
export const NUMBER_CHANGE_KIND = "number_change";

export function requestKind(req) {
  return req?.kind === NUMBER_CHANGE_KIND ? NUMBER_CHANGE_KIND : SIGNUP_KIND;
}

export function isNumberChange(req) {
  return requestKind(req) === NUMBER_CHANGE_KIND;
}

// A pending row rendered as a roster row, so the transparency grid can show
// "requested" sign-ups beside the drivers already on the roster — which is what
// stops two people asking for #24 an hour apart.
export function pendingAsRosterRow(req) {
  return {
    id: req.id,
    number: req.number ?? null,
    name: req.name || req.driver_name || "Driver",
    car: req.car || "",
    manufacturer: req.manufacturer || "",
    class_names: req.class_names || [],
    pending: true,
  };
}

// The roster a player should see while choosing a number: everyone already on
// it, plus everyone waiting on approval, in car-number order. Marked so the UI
// can tell the two apart — a pending number isn't taken yet, but asking for it
// anyway is a wasted trip.
//
// A pending NUMBER CHANGE is not a new person, so it never adds a row. It hangs
// off the row that driver already has, as "asked for #12" — which is what stops
// the same driver appearing twice and makes the number they want visible to
// whoever is choosing one.
export function rosterWithPending(roster = [], pending = []) {
  const changes = pending.filter(isNumberChange);
  const joins = pending.filter(p => !isNumberChange(p));
  const wantedFor = new Map();
  for (const c of changes) {
    const key = String(c.entry_id || c.driver_id || "");
    if (key) wantedFor.set(key, normalizeCarNumber(c.number));
  }
  return sortRosterByNumber([
    ...roster.map(r => {
      const wants = wantedFor.get(String(r.entry_id || "")) || wantedFor.get(String(r.driver_id || ""));
      return { ...r, pending: false, wants_number: wants || null };
    }),
    ...joins.map(pendingAsRosterRow),
  ]);
}

// Every car number spoken for in a season — on the roster OR already requested.
// Both count: letting a second player request a number somebody is already
// waiting on just makes work for the admin resolving it.
export function claimedNumbers(roster = [], pending = []) {
  return [
    ...roster.map(r => normalizeCarNumber(r?.number)),
    ...pending.map(p => normalizeCarNumber(p?.number)),
  ].filter(Boolean);
}

// Is this number spoken for? Same text comparison as everywhere else, so a
// league running both a 1 and an 01 keeps them distinct.
export function numberClaimed(roster, pending, value) {
  return carNumberTaken(claimedNumbers(roster, pending), value);
}

// Has this account already got a SIGN-UP in for this season? One at a time — a
// second would only be denied. A number-change request is a different question
// and never blocks (or is blocked by) a sign-up, so it's filtered out here.
export function pendingForSeason(pending = [], { uid, driverId }) {
  return pending.find(p =>
    !isNumberChange(p) && ((uid && p.uid === uid) || (driverId && p.driver_id === driverId))) ?? null;
}

// This account's outstanding NUMBER-CHANGE request for a season, or null. One at
// a time for the same reason: a second is just another row for an admin to
// reconcile against the first.
export function numberRequestFor(pending = [], { uid, driverId, entryId } = {}) {
  return pending.find(p => isNumberChange(p) && (
    (entryId && p.entry_id === entryId)
    || (uid && p.uid === uid)
    || (driverId && p.driver_id === driverId))) ?? null;
}

// Is `value` the number this entry already runs? Asking for the number you
// already have is a no-op, not a clash — checked before "is it taken", which
// would otherwise reject a driver's own number as spoken for.
export function isOwnNumber(currentNumber, value) {
  const wanted = normalizeCarNumber(value);
  return !!wanted && wanted === normalizeCarNumber(currentNumber);
}

// A one-line summary of what a pending player asked for, for the admin queue.
export function requestSummary(req) {
  if (isNumberChange(req)) {
    const from = normalizeCarNumber(req?.current_number);
    const to = normalizeCarNumber(req?.number);
    return `Car number ${from ? `#${from}` : "(none)"} → ${to ? `#${to}` : "(none)"}`;
  }
  const bits = [];
  if (normalizeCarNumber(req?.number)) bits.push(`#${normalizeCarNumber(req.number)}`);
  if (req?.car) bits.push(req.car);
  if (req?.manufacturer && req.manufacturer !== req.car) bits.push(req.manufacturer);
  if (req?.class_names?.length) bits.push(req.class_names.join(" · "));
  return bits.join(" · ");
}
