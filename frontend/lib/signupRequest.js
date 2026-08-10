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

// ── Required contact & platform information ────────────────────────────────
//
// Two things decide what a sign-up must carry:
//
//   1. ONE GLOBAL RULE. Every sign-up, for every game, series, season and
//      class, needs the player's Discord name — it's how a league talks to its
//      drivers, so there is no game where it's optional and no toggle to turn
//      it off.
//   2. WHAT THE GAME ASKS FOR. Different games identify a player differently:
//      a Steam name for a PC title, a PSN ID for Gran Turismo, a gamertag for
//      Forza, an iRacing name + customer ID for iRacing. An admin turns these
//      on per game in League Setup ▸ Games, and they're stored as booleans on
//      the game doc (see SPECS.games in lib/entityApi.js).
//
// Labels match DEFAULT_ALIAS_LABELS in lib/aliases.js exactly, so an answer
// given here lands on the same row of the driver's profile that the admin's
// Driver Edit dialog writes — which is what lets a sign-up fill the profile in
// and a filled-in profile answer the next sign-up automatically.
export const DISCORD_LABEL = "Discord Name";
export const STEAM_LABEL = "Steam Username";
export const PSN_LABEL = "PSN Username";
export const XBOX_LABEL = "Xbox Gamertag";
export const IRACING_NAME_LABEL = "iRacing Name";
export const IRACING_ID_LABEL = "iRacing ID#";

// Discord, always, everywhere.
export const DISCORD_REQUIREMENT = {
  label: DISCORD_LABEL,
  why: "Every league sign-up needs a Discord name — it's how the league reaches you about races.",
};

// The per-game toggles, in the order they're rendered in League Setup and on
// the sign-up form. `field` is the boolean stored on the game doc.
export const GAME_PLATFORM_REQUIREMENTS = [
  {
    field: "requires_steam",
    label: STEAM_LABEL,
    title: "Requires Steam ID/Name",
    why: "This game is played on Steam, so the league needs your Steam name to find and invite you.",
  },
  {
    field: "requires_psn",
    label: PSN_LABEL,
    title: "Requires PlayStation Network (PSN) ID",
    why: "This game is played on PlayStation, so the league needs your PSN ID to add you to lobbies.",
  },
  {
    field: "requires_xbox",
    label: XBOX_LABEL,
    title: "Requires Xbox Gamertag",
    why: "This game is played on Xbox, so the league needs your gamertag to add you to lobbies.",
  },
  {
    field: "requires_iracing_name",
    label: IRACING_NAME_LABEL,
    title: "Requires iRacing Name",
    why: "Results import under your iRacing name, so the league needs it to match your results to this profile.",
  },
  {
    field: "requires_iracing_id",
    label: IRACING_ID_LABEL,
    title: "Requires iRacing Customer ID",
    why: "iRacing leagues are invite-only, so the organiser needs your customer ID to send you an invite.",
  },
];

// iRacing is invite-only at the league level: an organiser can't send someone a
// league invite without their numeric customer id. That was true before these
// toggles existed and stays true after — a game NAMED iRacing requires the
// customer ID and the iRacing name whether or not an admin has been back to
// League Setup to tick the boxes, so no league loses the rule by upgrading.
// Punctuation and spacing are ignored, so "i-Racing" and "iracing" both count.
export function isIracingGame(gameName) {
  return /iracing/.test(String(gameName ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
}

// Accepts either a game doc ({ name, requires_* }) or a bare game name, so the
// older callers that only ever had a name keep working.
function asGame(game) {
  return typeof game === "string" || game == null ? { name: game || "" } : game;
}

// The platform toggles in force for a game: what the admin ticked, plus the
// iRacing rules a game named "iRacing" carries implicitly.
export function gameRequirementFlags(game) {
  const g = asGame(game);
  const iracing = isIracingGame(g.name);
  return {
    requires_steam: !!g.requires_steam,
    requires_psn: !!g.requires_psn,
    requires_xbox: !!g.requires_xbox,
    requires_iracing_name: !!g.requires_iracing_name || iracing,
    requires_iracing_id: !!g.requires_iracing_id || iracing,
  };
}

// The alias rows a sign-up for this game can't go in without, as
// [{ label, why }] so the form can say why it's asking. Discord always leads.
export function requiredAliases(game) {
  const flags = gameRequirementFlags(game);
  return [
    DISCORD_REQUIREMENT,
    ...GAME_PLATFORM_REQUIREMENTS.filter(r => flags[r.field])
      .map(({ label, why }) => ({ label, why })),
  ];
}

// The aliases this game asks for but doesn't insist on — prompted in the form
// so the useful ones get filled in without blocking anyone.
export function suggestedAliases(game) {
  const flags = gameRequirementFlags(game);
  // Nothing is merely suggested once every platform field is either required or
  // irrelevant; the iRacing name is the one that used to be, and it's required
  // outright now.
  return flags.requires_iracing_id && !flags.requires_iracing_name ? [IRACING_NAME_LABEL] : [];
}

// Which required aliases are still blank. Empty array = good to submit.
export function missingRequiredAliases(aliases, game) {
  const filled = new Map(
    normalizeAliases(aliases).map(a => [a.label.trim().toLowerCase(), a.value.trim()]));
  return requiredAliases(game).filter(r => !filled.get(r.label.toLowerCase()));
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
export function signupProblem({ name, aliases, game, gameName }) {
  if (!String(name ?? "").trim()) return "Enter the name you race under.";
  const missing = missingRequiredAliases(aliases, game ?? gameName);
  if (missing.length) return missingAliasMessage(missing);
  return "";
}
