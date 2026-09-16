// Matching an imported venue name against the tracks this league already has.
//
// The same job lib/driverMatch.js does for people, and for the same reason: an
// importer that doesn't do it fills the Tracks library with duplicates —
// "Charlotte Motor Speedway Roval 2025" arriving every season beside the
// "Charlotte Roval" an admin typed themselves.
//
// It is NOT the same algorithm, though, and the difference is the point. Two
// venue names that read almost identically are routinely different places to
// race:
//
//   Charlotte Motor Speedway Oval
//   Charlotte Motor Speedway Roval
//
// One character apart in thirty, which any general-purpose string similarity
// calls a match — and getting it wrong attaches a season of races to the wrong
// venue, with its lap records and its history. This app has no separate field
// for a layout, so those are two tracks, and telling them apart matters more
// than saving a click.
//
// So the rule here is deliberately strict:
//
//   • an AUTOMATIC match needs an exact name, once punctuation and case are
//     set aside — against the track's own name or any other name it answers to
//     (see trackNames). Nothing else matches by itself;
//   • everything close is a SUGGESTION the admin confirms, ranked with the
//     reason it's being offered;
//   • and the one case that looks like a match but never is — the same venue
//     written with a different layout — is called out as exactly that, so it's
//     offered as a layout to choose rather than a match to accept.
//
// What makes it quick the second time is the confirming. An import records the
// name the source used on the track the admin pointed it at (`merged_names`,
// which the track profile already prints as "Also raced as"), so next season
// the same name is an exact hit and there is nothing to review.

import { nameSimilarity } from "@/lib/resultsImport";
import { normalizeName } from "@/lib/nameKey";
import { TRACK_TYPES } from "@/lib/trackTypes";

// Every name a track answers to: the one it's called, plus the names it has
// been raced under before — venues folded into it by the merge tool, and the
// names other sites use for it, recorded by an import.
export function trackNames(track) {
  const names = [track?.name, ...(Array.isArray(track?.merged_names) ? track.merged_names : [])];
  return names.map(n => String(n ?? "").trim()).filter(Boolean);
}

const keysOf = track => new Set(trackNames(track).map(normalizeName).filter(Boolean));

// ── Base venue and layout ─────────────────────────────────────────────────

// Split a venue name into the place and the layout raced there.
//
// `baseNames` is the list of real venues to split against — iRacing's own, read
// off SimRacerHub's track directory, where "Lime Rock Park Grand Prix" is the
// Grand Prix layout of Lime Rock Park. The longest base name that starts the
// string wins, so "Indianapolis Motor Speedway Road Course" doesn't come apart
// at "Indianapolis".
//
// Without a list to split against — an app track an admin named themselves —
// the whole name is the base and there is no layout, which is the honest
// answer rather than a guess at where one venue's name stops.
export function splitTrackName(name, baseNames = []) {
  const full = String(name ?? "").trim();
  const key = normalizeName(full);
  if (!key) return { full, base: "", config: "" };

  let best = null;
  for (const candidate of baseNames) {
    const base = normalizeName(candidate);
    if (!base) continue;
    if (key !== base && !key.startsWith(`${base} `)) continue;
    if (!best || base.length > normalizeName(best).length) best = String(candidate).trim();
  }
  if (!best) return { full, base: full, config: "" };

  // The layout is whatever the base name left behind, taken off the ORIGINAL
  // string so it keeps its capitals and punctuation.
  const baseWords = normalizeName(best).split(" ").length;
  const words = full.split(/\s+/);
  return { full, base: best, config: words.slice(baseWords).join(" ").trim() };
}

// ── Track type, as far as a name can say ──────────────────────────────────

// The surface a venue's name implies, from this app's own Track Type list.
//
// Ordered most specific first: a "Dirt Oval" must not read as an "Oval", and a
// "Street Circuit" must not read as a "Road Course" just because it has
// corners. A name that implies nothing gets nothing — the field is optional,
// and a wrong surface on a venue is worse than a blank one an admin fills in.
const TYPE_HINTS = [
  // Surface first: a dirt track is a dirt track whatever shape it is.
  ["Dirt Road Course", /\bdirt\b[\s\S]*\b(road|rally)\b/],
  ["Dirt Oval", /\bdirt\b|\bclay\b/],
  ["Rallycross", /\brally\s*cross\b|\brallycross\b/],
  ["Drag Strip", /\bdrag\s*(strip|way)\b|\bdragstrip\b/],
  ["Kart", /\bkart(ing)?\b/],
  ["Superspeedway", /\bsuper\s*speedway\b|\bsuperspeedway\b/],
  ["Figure 8", /\bfigure\s*8\b|\bfigure\s*eight\b/],
  ["Street Circuit", /\bstreet\b/],
  // Then the LAYOUT the league named, which is the whole reason a venue
  // appears twice in this app: "Charlotte Motor Speedway Oval" and
  // "…Roval" are one place and two surfaces. A roval is a road course and
  // has to be read before "oval", which its own spelling contains.
  ["Road Course", /\broval\b/],
  ["Oval", /\boval\b/],
  ["Short Track", /\bshort\s*track\b/],
  ["Road Course", /\broad\b|\bgrand\s*prix\b|\bcircuit\b|\bmoto\b|\bsports\s*car\b/],
  // And last, what the venue calls itself. A "Speedway" with no layout named
  // is an oval; anything more specific has already been caught above, which is
  // what stops "Daytona International Speedway Oval" reading as a road course
  // on the strength of the word "International".
  ["Oval", /\bspeedway\b|\braceway\b|\bsuper\s*oval\b/],
];

export function trackTypeFromName(name) {
  const text = String(name ?? "").toLowerCase();
  if (!text) return "";
  for (const [type, re] of TYPE_HINTS) {
    if (re.test(text)) return TRACK_TYPES.includes(type) ? type : "";
  }
  return "";
}

// ── Matching ──────────────────────────────────────────────────────────────

// How a candidate came to be offered, worst to best:
//   close  — the names resemble each other
//   layout — the same venue, a different layout raced there
//   exact  — the same name, or one this track already answers to
export const MATCH_REASONS = ["close", "layout", "exact"];

const REASON_RANK = { exact: 3, layout: 2, close: 1 };

// Match one imported venue name against the league's tracks.
//
// Returns { raw, status, track_id, matched_name, candidates } where status is:
//   matched   — an exact hit on a name this track answers to; nothing to decide
//   suggested — a layout of the same venue, or a name close enough to offer
//   new       — nothing worth offering; this venue isn't in the app yet
//
// `candidates` is what the review table's dropdown puts at the top, each with
// the reason it's there, so an admin choosing between "…Oval" and "…Roval" can
// see which is which.
export function matchTrack(rawName, tracks = [], { weak = 0.74, limit = 5, baseNames = [] } = {}) {
  const raw = String(rawName ?? "").trim();
  const empty = { raw, status: "new", track_id: null, matched_name: "", candidates: [] };
  if (!raw) return empty;

  const key = normalizeName(raw);
  const mine = splitTrackName(raw, baseNames);
  const ranked = [];

  for (const track of tracks) {
    const id = track?.id;
    if (!id) continue;
    const names = keysOf(track);

    if (names.has(key)) {
      ranked.push({ id, name: track.name, reason: "exact", score: 1 });
      continue;
    }

    // The same venue, a different layout. Only ever a suggestion: this is the
    // Oval/Roval case, and the two are different places to race.
    const theirs = splitTrackName(track.name, baseNames);
    const sameVenue = mine.base && theirs.base && normalizeName(mine.base) === normalizeName(theirs.base);
    if (sameVenue) {
      ranked.push({
        id, name: track.name, reason: "layout", score: 0.9,
        layout: theirs.config || "the venue itself",
      });
      continue;
    }

    // Otherwise, how alike are the names? Compared against every name the
    // track answers to, so an alias recorded by an earlier import still pulls
    // its venue to the top even when it isn't an exact hit.
    let best = 0;
    for (const name of trackNames(track)) {
      const score = nameSimilarity(raw, name);
      if (score > best) best = score;
    }
    if (best >= weak) ranked.push({ id, name: track.name, reason: "close", score: best });
  }

  ranked.sort((a, b) => (REASON_RANK[b.reason] - REASON_RANK[a.reason]) || (b.score - a.score));
  const candidates = ranked.slice(0, limit);
  const top = ranked[0];

  if (top?.reason === "exact") {
    return { raw, status: "matched", track_id: top.id, matched_name: top.name, candidates };
  }
  if (top) return { raw, status: "suggested", track_id: top.id, matched_name: top.name, candidates };
  return { ...empty, candidates };
}

// ── The plan ──────────────────────────────────────────────────────────────

// Every venue a schedule races at, checked against the league's tracks.
//
// `info` is what the source knows about each name — its base venue and a logo —
// keyed by the raw name. `baseNames` is the venue list to split layouts
// against. Neither is required: without them the matching still works on names
// alone, and a new track is simply created with less filled in.
//
// Each row carries what the review table needs AND what creating the venue
// would use, so the UI has nothing to work out for itself:
//   suggested_name  what to call it here, which the admin can change
//   suggested_type  the surface its name implies
//   logo_url        the venue's own logo, where the source had one
export function planTrackImport(names, tracks = [], { info = {}, baseNames = [] } = {}) {
  const seen = new Set();
  const rows = [];
  for (const name of names || []) {
    const raw = String(name ?? "").trim();
    const key = normalizeName(raw);
    if (!raw || seen.has(key)) continue;
    seen.add(key);

    const found = matchTrack(raw, tracks, { baseNames });
    const detail = info[raw] || {};
    const split = splitTrackName(raw, baseNames);
    rows.push({
      ...found,
      base: detail.base || split.base,
      config: split.config,
      // A new venue is named as the source calls it by default — that is what
      // the league picked when they built the season, and an admin who wants
      // their own name types it over. Whatever they settle on, the source's
      // name is recorded on the track so the next import is an exact hit.
      suggested_name: raw,
      suggested_type: trackTypeFromName(raw),
      logo_url: detail.logo_url || "",
    });
  }

  const summary = {
    total: rows.length,
    matched: rows.filter(r => r.status === "matched").length,
    suggested: rows.filter(r => r.status === "suggested").length,
    new: rows.filter(r => r.status === "new").length,
  };
  return { rows, summary };
}

// ── Decisions ─────────────────────────────────────────────────────────────

// The admin's answers applied to the plan, as the two lists a writer needs.
//
// A decision is { action: "use", track_id } or { action: "create", name, track_type }.
// A row with no decision falls back to what the plan proposed, EXCEPT that a
// suggestion is never taken as an answer — an unanswered "is this the same
// venue?" creates the venue rather than quietly pointing a season's races at a
// layout nobody confirmed. That is the same rule the roster importer follows
// for a driver who merely resembles one already in the app.
export function applyTrackDecisions(rows, decisions = {}) {
  const use = [];   // { raw, track_id, record_alias }
  const create = []; // { raw, name, track_type, logo_url }
  const errors = [];

  for (const row of rows || []) {
    const decision = decisions[row.raw] || {};
    const action = decision.action
      || (row.status === "matched" ? "use" : "create");

    if (action === "use") {
      const trackId = decision.track_id || (row.status === "matched" ? row.track_id : null);
      if (!trackId) {
        errors.push(`${row.raw}: no track chosen`);
        continue;
      }
      use.push({ raw: row.raw, track_id: trackId });
      continue;
    }

    const name = String(decision.name ?? row.suggested_name ?? row.raw).trim();
    if (!name) { errors.push(`${row.raw}: a new track needs a name`); continue; }
    create.push({
      raw: row.raw,
      name,
      track_type: decision.track_type !== undefined ? String(decision.track_type || "") : row.suggested_type,
      logo_url: row.logo_url || "",
    });
  }

  // Two venues can't be created under one name — that is the duplicate this
  // whole module exists to stop, arriving from the review table instead.
  const byName = new Map();
  for (const row of create) {
    const key = normalizeName(row.name);
    if (byName.has(key)) errors.push(`Two of these would both be created as "${row.name}" — give one a different name.`);
    else byName.set(key, row);
  }

  return { use, create, errors };
}
