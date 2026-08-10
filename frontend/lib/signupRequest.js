// Rules for a player-submitted series sign-up: what driver information has to
// come with it, and which of it a given game insists on.
//
// The shape of the thing being submitted depends on whether the league already
// knows this person:
//
//   • Linked to a driver profile → the sign-up is applied straight away. Their
//     account was already vouched for when an admin approved the link.
//   • Not linked → NOTHING is created. The whole submission (the name they race
//     under, their aliases, and the season they want to join) is filed as a
//     pending request in `claim_requests`, and only an admin approving it makes
//     a driver profile or a roster entry exist. Adding a driver is never
//     automated — see /api/claim-requests and /api/admin/claim-requests/[id].
//
// Kept pure so the dialog, the API route and the admin approval all apply one
// set of rules.

import { normalizeAliases } from "@/lib/aliases";

// The two kinds of thing that can sit in the approval queue.
export const CLAIM_KIND = "claim";            // "that existing driver is me"
export const NEW_DRIVER_KIND = "new_driver";  // "please add me as a new driver"

export function requestKind(req) {
  return req?.kind === NEW_DRIVER_KIND ? NEW_DRIVER_KIND : CLAIM_KIND;
}

// ── Per-game required information ──────────────────────────────────────────
//
// iRacing is invite-only at the league level: an organiser can't send someone a
// league invite without their numeric customer id, so a sign-up for an iRacing
// season is incomplete without it and the form refuses to submit.
//
// Which game that is, is decided by the game's NAME rather than a flag on the
// game doc — leagues name it "iRacing" (and the app ships no per-game settings
// screen), so keying off the name is what makes this work with no extra setup.
// Punctuation and spacing are ignored, so "i-Racing" and "iracing" both count.
export const IRACING_ID_LABEL = "iRacing ID#";
export const IRACING_NAME_LABEL = "iRacing Name";

export function isIracingGame(gameName) {
  return /iracing/.test(String(gameName ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
}

// The alias rows this game insists on before a sign-up can go in, as
// [{ label, why }] so the form can say why it's asking.
export function requiredAliases(gameName) {
  if (!isIracingGame(gameName)) return [];
  return [{
    label: IRACING_ID_LABEL,
    why: "iRacing leagues are invite-only, so the organiser needs your customer ID to send you an invite.",
  }];
}

// The aliases this game asks for but doesn't insist on — prompted in the form
// so the useful ones get filled in without blocking anyone.
export function suggestedAliases(gameName) {
  return isIracingGame(gameName) ? [IRACING_NAME_LABEL] : [];
}

// Which required aliases are still blank. Empty array = good to submit.
export function missingRequiredAliases(aliases, gameName) {
  const filled = new Map(
    normalizeAliases(aliases).map(a => [a.label.trim().toLowerCase(), a.value.trim()]));
  return requiredAliases(gameName).filter(r => !filled.get(r.label.toLowerCase()));
}

// One sentence naming what's still missing, for the form and for the API's
// rejection — worded the same either way.
export function missingAliasMessage(missing = []) {
  if (!missing.length) return "";
  const names = missing.map(m => m.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} required to sign up for this series. ${missing[0].why}`;
}

// ── The driver information a sign-up carries ───────────────────────────────

// Trim a submitted sign-up into what actually gets stored, so the dialog, the
// route and the approval step never disagree about the shape. Free text is
// capped at the same lengths the entry/driver routes use.
export function cleanSignupDriverInfo({ name = "", aliases = [], number = "", class_ids = [] } = {}) {
  return {
    name: String(name).trim().slice(0, 60),
    aliases: normalizeAliases(aliases).filter(a => a.value || a.game_id),
    number: String(number).trim().slice(0, 3),
    class_ids: Array.isArray(class_ids) ? class_ids.map(String).filter(Boolean) : [],
  };
}

// Is this submission complete enough to send? Returns the blocking reason, or
// "" when it's good. The dialog shows it live; the route repeats the check.
export function signupProblem({ name, aliases, gameName }) {
  if (!String(name ?? "").trim()) return "Enter the name you race under.";
  const missing = missingRequiredAliases(aliases, gameName);
  if (missing.length) return missingAliasMessage(missing);
  return "";
}
