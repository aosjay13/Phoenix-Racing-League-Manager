// A league's Discord invite.
//
// It was one constant in the code, which meant every league on the
// installation invited its players into the FIRST league's server under a
// banner reading "Discord is mandatory to race in this league". It is a
// per-league setting now, and two promises hold it together:
//
//   1. A LEAGUE NEVER SHOWS SOMEBODY ELSE'S SERVER. The fallback to the old
//      hard-coded invite belongs to exactly one league — the oldest, the one it
//      was always for. Every other league shows its own link or none at all.
//      This is the case that fails silently and embarrassingly, so it gets the
//      most cases below.
//   2. THE LINK IS A DISCORD LINK. The button it fills in is labelled "Open our
//      Discord" beneath a sentence calling it mandatory, which is about as
//      trusting as a link gets — so the host is checked rather than assumed.

import assert from "node:assert/strict";
import {
  DISCORD_EDIT_MIN_LEVEL, LEGACY_DISCORD_INVITE,
  canEditDiscordUrl, discordLabel, discordUrlProblem, leagueDiscordUrl, normalizeDiscordUrl,
} from "@/lib/discordInvite";
import { ROLE_LEVEL } from "@/lib/roles";

let n = 0;
function check(label, actual, expected) {
  n += 1;
  assert.deepEqual(actual, expected, label);
}
function ok(label, cond) {
  n += 1;
  assert.ok(cond, label);
}

// ── 1. What counts as an invite ────────────────────────────────────────────

check("a plain invite survives",
  normalizeDiscordUrl("https://discord.gg/pra"), "https://discord.gg/pra");
// How an invite is actually written down and said out loud — no scheme at all.
check("a bare host/path is read as https",
  normalizeDiscordUrl("discord.gg/apex"), "https://discord.gg/apex");
// discord.gg redirects to https anyway; no reason to send a player through a
// plaintext hop first.
check("http is upgraded to https",
  normalizeDiscordUrl("http://discord.gg/pra"), "https://discord.gg/pra");
check("the long form Discord's copy button produces works",
  normalizeDiscordUrl("https://discord.com/invite/abc123"), "https://discord.com/invite/abc123");
check("the old domain still works",
  normalizeDiscordUrl("https://discordapp.com/invite/abc123"),
  "https://discordapp.com/invite/abc123");
check("www is accepted", normalizeDiscordUrl("https://www.discord.gg/pra"),
  "https://www.discord.gg/pra");
check("a mixed-case host is lowercased",
  normalizeDiscordUrl("HTTPS://Discord.GG/Pra"), "https://discord.gg/Pra");
// The invite CODE is case-sensitive, so only the host may be folded.
ok("the invite code keeps its case",
  normalizeDiscordUrl("discord.gg/AbCdEf").endsWith("/AbCdEf"));
check("a trailing slash is trimmed",
  normalizeDiscordUrl("https://discord.gg/pra/"), "https://discord.gg/pra");
check("surrounding whitespace is trimmed",
  normalizeDiscordUrl("  discord.gg/pra  "), "https://discord.gg/pra");

// Refused, each for its own reason.
check("empty is empty", normalizeDiscordUrl(""), "");
check("whitespace is empty", normalizeDiscordUrl("   "), "");
check("null is empty", normalizeDiscordUrl(null), "");
// The mistakes people actually make: a server ID, a channel link, a name.
check("a bare code is not a link", normalizeDiscordUrl("pra"), "");
check("the marketing site is not an invite", normalizeDiscordUrl("https://discord.gg"), "");
check("…nor with just a slash", normalizeDiscordUrl("https://discord.gg/"), "");
// Promise 2: another host, however plausible it looks.
check("another host is refused", normalizeDiscordUrl("https://example.com/invite/abc"), "");
check("a lookalike domain is refused", normalizeDiscordUrl("https://discord.gg.evil.com/pra"), "");
check("a host merely CONTAINING discord.gg is refused",
  normalizeDiscordUrl("https://notdiscord.gg/pra"), "");
// A third-party listing site is not Discord, however Discord-ish the name.
check("discord.me is not Discord", normalizeDiscordUrl("https://discord.me/pra"), "");
// javascript: is the one that would actually be dangerous in an href.
check("a javascript URL is refused", normalizeDiscordUrl("javascript:alert(1)"), "");
check("a data URL is refused", normalizeDiscordUrl("data:text/html,<b>hi</b>"), "");

// The message the form shows and the route repeats — one wording, one rule.
check("a clear box is not an error", discordUrlProblem(""), "");
check("a clear box of spaces is not an error", discordUrlProblem("  "), "");
check("a good link has no problem", discordUrlProblem("discord.gg/pra"), "");
ok("a bad link says what to paste instead",
  discordUrlProblem("https://example.com/x").includes("discord.gg"));

// ── 2. Which link a league shows ───────────────────────────────────────────

const LEGACY = "leagueAAA111";
const NEWER = "leagueBBB222";

// A stored value always wins, in either league.
check("a league shows its own invite",
  leagueDiscordUrl({ id: NEWER, discord_url: "discord.gg/apex" }, { legacyLeagueId: LEGACY }),
  "https://discord.gg/apex");
check("…even when it is the legacy league",
  leagueDiscordUrl({ id: LEGACY, discord_url: "discord.gg/something-new" }, { legacyLeagueId: LEGACY }),
  "https://discord.gg/something-new");

// Promise 1, both halves. The oldest league keeps the link its players have
// been following all along…
check("the legacy league inherits the old hard-coded invite",
  leagueDiscordUrl({ id: LEGACY }, { legacyLeagueId: LEGACY }), LEGACY_DISCORD_INVITE);
// …and nobody else does. This is the whole point: a league created last week
// has no relationship to that server.
check("a newer league inherits NOTHING",
  leagueDiscordUrl({ id: NEWER }, { legacyLeagueId: LEGACY }), "");
check("with no legacy league known, nothing is inherited",
  leagueDiscordUrl({ id: LEGACY }, {}), "");

// Clearing the box is a real answer. An empty string means "we have no
// Discord" and must NOT come back as the inherited link on the next read.
check("a deliberately cleared invite stays cleared",
  leagueDiscordUrl({ id: LEGACY, discord_url: "" }, { legacyLeagueId: LEGACY }), "");
check("a nulled invite stays cleared",
  leagueDiscordUrl({ id: LEGACY, discord_url: null }, { legacyLeagueId: LEGACY }), "");
// Only an ABSENT field falls back, which is the difference between "never asked"
// and "answered no".
ok("absent and empty are different answers",
  leagueDiscordUrl({ id: LEGACY }, { legacyLeagueId: LEGACY })
  !== leagueDiscordUrl({ id: LEGACY, discord_url: "" }, { legacyLeagueId: LEGACY }));

// Junk on the document doesn't become a link. A hand-edited or imported doc
// can hold anything, and it reaches an href.
check("a stored non-Discord URL is not shown",
  leagueDiscordUrl({ id: NEWER, discord_url: "https://example.com/x" }, { legacyLeagueId: LEGACY }),
  "");
check("no league at all shows nothing", leagueDiscordUrl(null, { legacyLeagueId: LEGACY }), "");

// ── 3. Who may change it ───────────────────────────────────────────────────

check("the floor is Admin", DISCORD_EDIT_MIN_LEVEL, ROLE_LEVEL.admin);
ok("an owner may set it", canEditDiscordUrl("owner"));
// The point of the lower floor: a dead invite shouldn't wait on one person.
ok("an admin may set it", canEditDiscordUrl("admin"));
ok("a moderator may not", !canEditDiscordUrl("moderator"));
ok("a statistician may not", !canEditDiscordUrl("statistician"));
ok("a player may not", !canEditDiscordUrl("player"));
ok("an unknown role may not", !canEditDiscordUrl("sysadmin"));
ok("no role at all may not", !canEditDiscordUrl(undefined));

// ── 4. How it reads on screen ──────────────────────────────────────────────

check("the label drops the scheme", discordLabel("https://discord.gg/pra"), "discord.gg/pra");
check("a bad link has no label", discordLabel("https://example.com/x"), "");
check("nothing has no label", discordLabel(""), "");

console.log(`discordInvite: ${n} assertions passed`);
