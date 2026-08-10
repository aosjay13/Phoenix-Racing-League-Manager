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
export function rosterWithPending(roster = [], pending = []) {
  return sortRosterByNumber([
    ...roster.map(r => ({ ...r, pending: false })),
    ...pending.map(pendingAsRosterRow),
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

// Has this account already got a request in for this season? One at a time —
// a second would only be denied.
export function pendingForSeason(pending = [], { uid, driverId }) {
  return pending.find(p =>
    (uid && p.uid === uid) || (driverId && p.driver_id === driverId)) ?? null;
}

// A one-line summary of what a pending player asked for, for the admin queue.
export function requestSummary(req) {
  const bits = [];
  if (normalizeCarNumber(req?.number)) bits.push(`#${normalizeCarNumber(req.number)}`);
  if (req?.car) bits.push(req.car);
  if (req?.manufacturer && req.manufacturer !== req.car) bits.push(req.manufacturer);
  if (req?.class_names?.length) bits.push(req.class_names.join(" · "));
  return bits.join(" · ");
}
