// The buttons on a message card have to open the season the card is ABOUT.
//
// Standings, Stats, the Schedule and the Calendar all read the Game ▸ Series ▸
// Season ▸ Class menus at the top of the page. A button that names no season
// opens whichever one the reader happened to have selected — so a card saying
// "Season 4 of Formula Phoenix is over" could show them Season 6 of a different
// series, which is the app contradicting the sentence directly above the button.
//
// The rules are unit-tested (messageScope in messages.test.mjs, scopeHref in
// scopeLink.js). What that can't catch is the button itself: the href is what a
// new tab, a copied link and a cold load all resolve from, and it is only ever
// right if the component actually puts the scope into it.
//
// Three cases, and each is a different way of arriving:
//   1. a scoped button carries the whole scope in its href;
//   2. an unscoped one — a list that isn't scoped at all — is left alone;
//   3. a card from ANOTHER league leaves the SPA, because switching league and
//      drilling into a season can only happen on a fresh mount.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageAction } from "@/components/MessageBoard";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };

function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

const STANDINGS = { href: "/standings", label: "🏆 Final standings", scoped: true };
const SIGNUPS = { href: "/signups", label: "📝 Go to Sign-ups" };
const scope = { game: "g1", series: "sr1", season: "se1", class: "Pro" };
const league = { leagueId: "L1", selectScope: () => {} };

// ── 1. A scoped button says which season ───────────────────────────────────
const scoped = render("scoped action",
  <MessageAction action={STANDINGS} scope={scope} leagueId="L1" league={league} />);
ok("it links to the right page", scoped.includes('href="/standings?'));
ok("naming the game", scoped.includes("game=g1"));
ok("the series", scoped.includes("series=sr1"));
ok("the season", scoped.includes("season=se1"));
ok("and the class", scoped.includes("class=Pro"));
ok("and it still reads as the same button", scoped.includes("Final standings"));

// A season-wide card ("All Classes") says so explicitly rather than leaving the
// key out, which would mean "not specified" and fall back to the reader's own.
const allClasses = render("all-classes action",
  <MessageAction action={STANDINGS} scope={{ ...scope, class: "" }} leagueId="L1" league={league} />);
ok("All Classes travels as an explicit choice", allClasses.includes("class=all"));

// ── 2. Left exactly as it was where there's nothing to scope ───────────────
const plain = render("unscoped action",
  <MessageAction action={SIGNUPS} scope={scope} leagueId="L1" league={league} />);
ok("an unscoped destination takes no scope", plain.includes('href="/signups"'));

// A card that names no season — one written before any of this, or whose season
// was deleted — keeps the plain link it always had rather than losing a button.
const unknown = render("scoped action with no scope",
  <MessageAction action={STANDINGS} scope={null} leagueId="L1" league={league} />);
ok("a card with no season named still gets its button", unknown.includes("Final standings"));
ok("pointing at the plain page", unknown.includes('href="/standings"'));

// ── 3. Another league's card leaves the SPA ────────────────────────────────
//
// A player's inbox is theirs, not one league's, so somebody racing in two of
// them reads both leagues' decisions on one board. A season id from the other
// league means nothing to the menus here, and only a fresh mount reads the
// league out of the link — which is why that case renders a plain <a> rather
// than a <Link>. Both render as an anchor in static markup, so what's asserted
// here is the half that IS visible: the link names the league to open in.
const other = render("another league's action",
  <MessageAction action={STANDINGS} scope={scope} leagueId="L2" league={league} />);
ok("it names the league to switch to", other.includes("league=L2"));
ok("along with the season", other.includes("season=se1"));

// The same card while that league IS the active one stays in-app.
const home = render("same league's action",
  <MessageAction action={STANDINGS} scope={scope} leagueId="L2"
    league={{ leagueId: "L2", selectScope: () => {} }} />);
ok("and carries the league either way", home.includes("league=L2"));

// Before the leagues are known, nothing is "elsewhere" — a link must not be
// downgraded to a full page load just because the provider hasn't settled.
const early = render("action before the league is known",
  <MessageAction action={STANDINGS} scope={scope} leagueId="L2" league={{}} />);
ok("an unresolved league still links to the right season", early.includes("season=se1"));

console.log(`messageLinks: ${n} assertions passed`);
