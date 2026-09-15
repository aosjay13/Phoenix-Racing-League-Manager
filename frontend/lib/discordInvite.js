// A league's Discord invite.
//
// It used to be one constant in components/DiscordCallout.jsx, on the reasoning
// that there was one league running this app and one invite. There isn't any
// more: leagues are separate environments with their own staff, rosters and
// seasons (see lib/leagueJoin.js), and a Discord server is exactly the kind of
// thing each one has its own of. A shared constant sent every league's players
// to the first league's server, under a banner reading "Discord is mandatory to
// race in this league" — pointing at somebody else's.
//
// So it lives on the league document, as `discord_url`, and the people who run
// that league set it. This file owns the rules: what counts as a usable invite,
// and which link a league actually shows.
//
// Kept pure so the settings form, the PATCH route and both places the invite is
// rendered apply one set of rules, and so they can be tested without Firestore.

import { ROLE_LEVEL } from "@/lib/roles";

// ── Who may change it ──────────────────────────────────────────────────────
//
// Admin and up, rather than Owner-only like the league's name and logo beside
// it. The difference is that this is operational rather than identity: a
// Discord invite expires, gets revoked, and is regenerated whenever a server is
// reorganised, and making the Owner the only person who can paste the new one
// means a league whose Owner is away has a mandatory link that goes nowhere.
// A name and a logo are what the league IS, and change about once.
export const DISCORD_EDIT_MIN_LEVEL = ROLE_LEVEL.admin;

export function canEditDiscordUrl(role) {
  return (ROLE_LEVEL[role] ?? 0) >= DISCORD_EDIT_MIN_LEVEL;
}

// ── The historical invite ──────────────────────────────────────────────────
//
// The value the constant held before this was a per-league field. It is still
// the right answer for ONE league — the oldest one, which is the league this
// app was written for and whose players have been following this link all
// along — so it stays as that league's default until somebody sets one.
//
// It is deliberately NOT the default for every league. A league created last
// week has no relationship to this server, and silently inviting its players
// into another league's Discord is worse than showing them no link at all.
// Same legacy rule as everything else here: the existing league keeps working
// exactly as it did, and a new one starts from nothing.
export const LEGACY_DISCORD_INVITE = "https://discord.gg/pra";

// ── What counts as an invite ───────────────────────────────────────────────
//
// Only Discord's own hosts. Two reasons, and the second is the one that matters:
//
//   • it catches the ordinary mistake — a server ID, a channel link, a
//     half-pasted address — at the moment it is typed rather than when a player
//     clicks it;
//   • the button it fills in is labelled "Open our Discord" under a banner
//     saying Discord is mandatory, which is about as trusting as a link gets.
//     A league admin is trusted with their league's data, but nothing about
//     that role needs the power to aim that particular sentence at a lookalike
//     domain, so the host is checked rather than assumed.
//
// `discord.gg` is the invite shortener; `discord.com/invite/…` is the long form
// the copy button produces now; `discordapp.com` is the old domain still in
// circulation. Anything else is refused with a sentence saying what was wrong.
const DISCORD_HOSTS = ["discord.gg", "discord.com", "discordapp.com"];

function hostAllowed(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  return DISCORD_HOSTS.includes(h);
}

// Clean up what somebody pasted into the shape that gets stored, or "" when it
// isn't usable. Accepts a bare "discord.gg/abc" (which is how an invite is
// written down and said out loud) and always stores https: discord.gg redirects
// to https anyway, and there is no reason to send a player through a plaintext
// hop first.
export function normalizeDiscordUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  // No scheme typed — assume the https the link resolves to rather than
  // rejecting the way every invite is actually written.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (!hostAllowed(url.hostname)) return "";
  // An invite needs a path — "discord.gg" on its own is the marketing site.
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return "";
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = path;
  url.hash = "";
  return url.toString();
}

// Why what they typed can't be saved, or "" when it's fine. Shown live under
// the field and repeated by the route, so the form and the server never
// disagree about what is acceptable. An EMPTY box is not an error — it is how a
// league says it has no Discord.
export function discordUrlProblem(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  return normalizeDiscordUrl(text)
    ? ""
    : "That doesn't look like a Discord invite. Paste the whole link — for example https://discord.gg/your-invite.";
}

// The invite one league shows, which is the only question the UI ever asks.
//
// A stored value wins. Failing that, the oldest league — and only the oldest
// league — falls back to the invite that used to be hard-coded. Everything else
// answers "", and the callout hides itself rather than pointing somewhere wrong.
export function leagueDiscordUrl(league, { legacyLeagueId = null } = {}) {
  if (!league) return "";
  const stored = normalizeDiscordUrl(league.discord_url);
  if (stored) return stored;
  // PRESENT BUT EMPTY is an answer: this league has no Discord. Only an ABSENT
  // field falls back, which is the difference between "nobody has been asked"
  // and "somebody cleared it" — a league that deliberately took the inherited
  // link down must not have it reappear on the next read. Checked on the key
  // rather than on the value so a stored null (an import, an older backup)
  // counts as cleared too, since that is the direction that can't surprise
  // anybody with a link they didn't choose.
  if (Object.prototype.hasOwnProperty.call(league, "discord_url")) return "";
  return legacyLeagueId && league.id === legacyLeagueId ? LEGACY_DISCORD_INVITE : "";
}

// How the link reads on screen: "discord.gg/pra" rather than the full URL, which
// is how anybody would say it out loud.
export function discordLabel(url) {
  const clean = normalizeDiscordUrl(url);
  if (!clean) return "";
  return clean.replace(/^https:\/\//, "").replace(/\/$/, "");
}
