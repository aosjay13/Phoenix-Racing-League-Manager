// "How many times is this one circuit in the pool?"
//
// The Tracks database is a shared library every race points at, and it is
// filled in by hand, by whoever is setting up that week's round. So the same
// circuit arrives under whatever the admin typed at the time:
//
//     Daytona · Daytona Intl Speedway · DAYTONA INTERNATIONAL SPEEDWAY
//     Talladega · Talladega Superspeedway · Talledega Superspeedway
//
// Each of those is a separate venue as far as the app is concerned, so the
// races held at the same place are split across three or four track profiles.
// That is not only untidy: a track's leaderboard, its past winners, its lap
// records and every driver's per-track stats are all derived from the races
// pointing at it (see lib/trackCompute.js), so a split venue reports four
// small, wrong histories instead of one right one. A driver who has won at
// Daytona six times shows up with two wins here and four there.
//
// /api/admin/tracks/merge already folds venues together without losing a race.
// What was missing is the part nobody does by hand: FINDING them. Reading
// three hundred track names and remembering which are the same circuit is the
// job this module does instead.
//
// Everything here is pure, so the scanner API and the review screen agree on
// what a duplicate is, and it can be checked without a database
// (lib/__tests__/trackMerge.test.mjs).

import { normalizeName } from "@/lib/nameKey";
import { nameSimilarity } from "@/lib/resultsImport";

// How alike two venue names have to be before this module says anything.
//
//   CONFIDENT  the same circuit typed differently — "Daytona Intl Speedway"
//              against "Daytona International Speedway".
//   POSSIBLE   close enough to be worth a look before they stay apart.
//
// Set higher than the driver thresholds on purpose. Two people with similar
// names is ordinary in a league; two DIFFERENT venues with near-identical names
// is rare, but when it happens ("Richmond Raceway" and "Richmond Dragway") a
// wrong merge is expensive — it welds two venues' histories together and only
// a hand-rebuild separates them again. So the bar to even ask is higher, and
// nothing is ever merged without an admin ticking it.
export const CONFIDENT_SCORE = 0.86;
export const POSSIBLE_SCORE = 0.7;

// Shorthand admins actually type, spelled out so "Daytona Intl Spdwy" and
// "Daytona International Speedway" reduce to the same words. Applied per token
// after normalizeName, so punctuation ("Int'l") is already gone.
const ABBREVIATIONS = {
  intl: "international", intnl: "international", int: "international",
  natl: "national",
  spdwy: "speedway", spdway: "speedway", spwy: "speedway", spway: "speedway", speedways: "speedway",
  swy: "speedway",
  rwy: "raceway", rcwy: "raceway", raceways: "raceway",
  mtr: "motor", motors: "motor",
  mtrsports: "motorsport", motorsports: "motorsport", mtrspt: "motorsport",
  circuits: "circuit", autodromo: "autodrome", autodrom: "autodrome",
  gp: "grand prix",
};

// Words that describe what a venue IS rather than which venue it is. Stripping
// them leaves the part that actually names the place: "Daytona International
// Speedway", "Daytona Speedway" and "Daytona" all come down to "daytona".
//
// Layout words are deliberately NOT in here — "Road Atlanta" and "Atlanta
// Motor Speedway" are two different circuits in the same city, and throwing
// "road" away would merge them. Layouts are compared separately, below.
const VENUE_WORDS = new Set([
  "international", "national", "speedway", "superspeedway", "raceway", "motorway",
  "motor", "motorsport", "motorplex", "autodrome", "autopista", "circuit", "circuito",
  "park", "track", "course", "complex", "arena", "raceplex", "speedplex",
  "the", "of", "at", "and", "de", "du", "des", "la", "le", "les", "el", "di", "do", "da",
]);

// Words that name a LAYOUT rather than a venue. One circuit often runs several,
// and each is a genuinely different track for the stats this app keeps — a lap
// record on Daytona's road course means nothing on the oval. So two names that
// disagree about the layout are held apart for the admin to judge rather than
// quietly folded together.
const LAYOUT_WORDS = new Set([
  "oval", "roval", "road", "grand", "prix", "short", "long", "club", "infield",
  "chicane", "dirt", "rallycross", "rx", "kart", "karting", "drag", "dragway", "dragstrip",
  "figure", "combined", "full", "reverse", "inner", "outer", "east", "west", "north", "south",
  "legends", "moto", "sprint", "indy", "alt", "alternate", "nascar", "gp",
]);

// A track's name plus every name it used to be listed under, which a merge
// keeps on the survivor (see /api/admin/tracks/merge). A venue cleaned up once
// must not be flagged against its own old name — and a NEW duplicate typed
// under that old name should still be found.
export function trackNames(track) {
  const out = [];
  const seen = new Set();
  const push = value => {
    const text = String(value ?? "").trim();
    const key = normalizeName(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  push(track?.name);
  for (const n of track?.merged_names || []) push(n);
  return out;
}

// The comparison form of a venue name: accents folded, case dropped,
// punctuation gone, shorthand spelled out. "Daytona Int'l Spdwy" →
// "daytona international speedway".
//
// Apostrophes go FIRST, before normalizeName turns them into spaces, because
// the abbreviations admins type carry them: "Int'l" has to become one token,
// "intl", or it spells out as "international l".
export function trackKey(name) {
  return normalizeName(String(name ?? "").replace(/['’ʼ`]/g, ""))
    .split(" ")
    .filter(Boolean)
    .map(t => ABBREVIATIONS[t] || t)
    .join(" ")
    .trim();
}

// What the venue is actually CALLED, with the generic venue words taken out:
// "daytona international speedway" → "daytona". This is what makes a bare
// "Daytona" recognisable as the same place as its full name.
//
// Falls back to the full key when a name is nothing but venue words (a track
// literally called "The Speedway"), so it never compares an empty string.
export function venueCore(name) {
  const key = trackKey(name);
  const core = key.split(" ").filter(t => t && !VENUE_WORDS.has(t)).join(" ");
  return core || key;
}

// The layout words a name carries, as a sorted list. "Charlotte - Roval" →
// ["roval"]; "Daytona International Speedway" → [].
export function layoutWords(name) {
  const found = trackKey(name).split(" ").filter(t => LAYOUT_WORDS.has(t));
  return [...new Set(found)].sort();
}

// Does one core name sit inside the other — "spa" inside "spa francorchamps",
// "daytona" inside "daytona beach"? That is the shape a hurried entry takes:
// the short name is not a misspelling of the long one, it is the first word of
// it, so edit distance never scores it well and the pair goes unnoticed.
//
// Capped BELOW the confident threshold whenever the two differ in length, and
// that cap is doing real work. "Spa" inside "Spa Francorchamps" is the same
// circuit; "Texas" inside "Texas World Speedway" is not — Texas Motor Speedway
// and Texas World Speedway are two places — and nothing in the names themselves
// tells the two cases apart. So a containment match is always offered and never
// pre-ticked: it is precisely the kind of call a human makes in a second and a
// string comparison cannot make at all.
const CONTAINMENT_CEILING = 0.84;

function containment(a, b) {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const [short, long] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (![...short].every(t => long.has(t))) return 0;
  // Same words in a different order is the same name.
  if (short.size === long.size) return 1;
  // Otherwise it tapers as the names diverge: one extra word is a plausible
  // long form, three extra words is probably a different venue.
  return Math.max(0.7, CONTAINMENT_CEILING - (long.size - short.size - 1) * 0.04);
}

// How alike two FULL names have to be before the full names are allowed to
// speak for themselves.
//
// This is the correction for the trap this whole module sits in: nearly every
// venue name ends in the same few words, so comparing them whole makes
// unrelated circuits look related. "Charlotte Motor Speedway" and "Atlanta
// Motor Speedway" share two thirds of their letters and are three hundred
// miles apart. So a full-name score only counts when it is near-identical —
// the "Speedwy" for "Speedway" case, where the typo is in the venue word
// itself and the cores no longer line up. Everything below that bar is decided
// on the cores, where the part that actually names the place lives.
const WHOLE_NAME_FLOOR = 0.9;

// 0..1, how much two venue names look like the same circuit.
export function trackSimilarity(a, b) {
  const ka = trackKey(a), kb = trackKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const whole = nameSimilarity(ka, kb);
  const ca = venueCore(a), cb = venueCore(b);
  return Math.max(
    whole >= WHOLE_NAME_FLOOR ? whole : 0,
    nameSimilarity(ca, cb) * 0.97,
    containment(ca, cb),
  );
}

// The best score between two tracks across every name each answers to, and the
// pair of names that produced it — so the screen can say "matched on its former
// name “Daytona”" rather than leaving an admin to guess.
export function bestNameMatch(a, b) {
  let best = { score: 0, a: a?.name || "", b: b?.name || "" };
  for (const na of trackNames(a)) {
    for (const nb of trackNames(b)) {
      const score = trackSimilarity(na, nb);
      if (score > best.score) best = { score, a: na, b: nb };
    }
  }
  return best;
}

// Plain-English "why these two are held apart", or "" when nothing disagrees.
//
// Two checks, and they are the whole safety net of this tool:
//
//   • the TYPES disagree — one is an Oval and the other a Road Course. Those
//     are two different circuits sharing a name, and merging them is exactly
//     the stat-skewing this feature exists to prevent, only worse.
//   • the LAYOUT words disagree — "Daytona Oval" against "Daytona Road
//     Course", or a bare "Indianapolis Motor Speedway" against "Indianapolis
//     Motor Speedway Road Course", where only one of them says which layout it
//     means.
//
// Neither blocks anything. They decide what is NOT ticked by default, so the
// obvious duplicates go through in one press and the judgement calls land in
// front of a human — which is the whole point of reviewing before merging.
const article = word => (/^[aeiou]/i.test(String(word)) ? "an" : "a");

export function conflictBetween(a, b) {
  const ta = String(a?.track_type ?? "").trim();
  const tb = String(b?.track_type ?? "").trim();
  if (ta && tb && ta.toLowerCase() !== tb.toLowerCase()) {
    return `“${a.name}” is ${article(ta)} ${ta} and “${b.name}” is ${article(tb)} ${tb} — different layouts of one circuit keep their own records, so check this is really the same track.`;
  }
  const la = layoutWords(a?.name), lb = layoutWords(b?.name);
  if (la.join(" ") !== lb.join(" ")) {
    const say = list => (list.length ? list.join(" / ") : "no layout");
    return `The names disagree about the layout (${say(la)} against ${say(lb)}). Same circuit, different course, is two sets of records — tick it only if these really are one track.`;
  }
  return "";
}

// How to describe a score in a list row.
export function confidenceOf(score, exact) {
  if (exact) return "exact";
  if (score >= CONFIDENT_SCORE) return "strong";
  return "possible";
}

// Why a track came up, for the row that offers it. `left` and `right` are the
// two names that actually met, which is not always the two names on show — a
// venue merged once before answers to its old name too.
function matchReason(left, right) {
  if (trackKey(left) === trackKey(right)) return "Exactly the same name";
  if (venueCore(left) === venueCore(right)) return "The same venue, written long or short";
  if (containment(venueCore(left), venueCore(right))) return "One name sits inside the other";
  return "The names are nearly the same";
}

// How much detail a track's profile carries — used to decide which copy of a
// venue is the one worth keeping when neither has more races than the other.
function detailScore(track) {
  return ["location", "length", "track_type", "logo_url", "notes"]
    .filter(f => String(track?.[f] ?? "").trim()).length;
}

// The name to give the merged venue.
//
// The fullest one wins: an admin who typed "Daytona" was being brief, not
// renaming the circuit, and "Daytona International Speedway" is the name that
// makes the schedule and the stats read properly afterwards. A SHOUTED name
// loses to an equally complete one in normal case, because it is going to sit
// in a page title.
export function suggestedMergeName(tracks = []) {
  const named = tracks.filter(t => String(t?.name ?? "").trim());
  if (!named.length) return "";
  const rank = t => {
    const name = String(t.name).trim();
    const words = trackKey(name).split(" ").filter(Boolean).length;
    const shouted = name === name.toUpperCase() && /[A-Z]{3}/.test(name) ? 1 : 0;
    return [words, -shouted, name.length];
  };
  return named.slice().sort((a, b) => {
    const [wa, sa, la] = rank(a), [wb, sb, lb] = rank(b);
    return (wb - wa) || (sb - sa) || (lb - la) || String(a.name).localeCompare(String(b.name));
  })[0].name;
}

// The copy of a venue that should survive a merge: the one already carrying the
// most races, because that is the profile most of the history is filed against
// and the one most links in the app already resolve to. Detail and then name
// length break a tie.
//
// It only decides what is OFFERED. The survivor keeps its id, so whichever is
// picked, every existing link still lands somewhere real.
export function suggestedSurvivor(tracks = [], raceCounts = {}) {
  return tracks.slice().sort((a, b) => {
    const ra = raceCounts[a.id] || 0, rb = raceCounts[b.id] || 0;
    if (ra !== rb) return rb - ra;
    const da = detailScore(a), db = detailScore(b);
    if (da !== db) return db - da;
    return String(b.name || "").length - String(a.name || "").length;
  })[0] || null;
}

// Races held at a venue, counted the same way the merge route MOVES them (see
// /api/admin/tracks/merge), so the number on a review row is the number of
// races that would actually travel:
//
//   • races linked to the track by id, plus
//   • legacy free-text races that only ever stored the venue NAME and were
//     never linked to anything — including a name the venue used to be listed
//     under, which an earlier merge kept.
//
// A race pinned to some OTHER venue's id is never counted here, however well
// the names line up: it belongs where it was put. Counting it twice would be
// the worse error, because these numbers are what an admin reads to decide
// which copy of a circuit is the real one.
//
// `tracks` and `races` are plain objects, so this is the rule rather than the
// database call — the route reads the collections and hands them over.
export function countTrackRaces(tracks = [], races = []) {
  const counts = Object.fromEntries(tracks.map(t => [t.id, 0]));
  const byId = new Map(tracks.map(t => [t.id, t]));
  const byName = new Map();          // a name a venue answers to -> track ids
  for (const t of tracks) {
    for (const name of trackNames(t)) {
      const key = normalizeName(name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(t.id);
    }
  }

  for (const race of races) {
    if (race.track_id) {
      if (counts[race.track_id] !== undefined) counts[race.track_id] += 1;
      continue;                      // linked, and linked is the last word
    }
    const hits = byName.get(normalizeName(race.track));
    if (!hits) continue;
    // A free-text name two venues in the pool both answer to is genuinely
    // ambiguous, and it would travel with whichever of them is merged. Counting
    // it for each is the honest answer: an undercount would read as "no history
    // at stake" on a venue that has some.
    for (const id of hits) {
      const owner = byId.get(id);
      if (race.league_id && owner?.league_id && race.league_id !== owner.league_id) continue;
      counts[id] += 1;
    }
  }
  return counts;
}

// ── The scan ────────────────────────────────────────────────────────────────

// Every venue in the pool checked against every other, and the ones that look
// like the same circuit collected into GROUPS rather than pairs.
//
// Groups, not pairs, because that is how the mistake actually happens: a
// circuit does not get entered twice, it gets entered every time somebody sets
// up a round there, so "Daytona" is in the pool four times. Offering six
// separate pairs to review would mean six merges to do one job, and after the
// first one the other five point at tracks that no longer exist. One group is
// one decision and one merge.
//
// Grouping is transitive on purpose — if A matches B and B matches C, all three
// are shown together even when A and C alone would not have matched (a bare
// "Daytona" and a misspelt "Daytona Intl Speedwy" meet through the correctly
// spelled one). Everything in the group is then scored against the survivor, so
// what the admin reads is "how close is this one to the track we are keeping",
// and anything that disagrees about the layout arrives unticked with the reason
// written out.
//
// Nothing here merges anything. It is a reading list, in the order worth
// reading: clean groups first, so the obvious ones are gone in a few presses
// and the judgement calls are what is left.
export function findDuplicateTrackGroups(tracks = [], { raceCounts = {}, floor = POSSIBLE_SCORE, limit = 50 } = {}) {
  const pool = (tracks || []).filter(t => t?.id && String(t.name ?? "").trim());

  // Union-find: each track starts alone, and every pair that scores above the
  // floor joins their two sets.
  const parent = new Map(pool.map(t => [t.id, t.id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) { const next = parent.get(id); parent.set(id, root); id = next; }
    return root;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      // Leagues are separate worlds and the merge route refuses to cross them,
      // so a scan must never offer a pair it could not carry out. A track with
      // no league_id is legacy and belongs to whoever is looking.
      if (a.league_id && b.league_id && a.league_id !== b.league_id) continue;
      if (bestNameMatch(a, b).score < floor) continue;
      union(a.id, b.id);
    }
  }

  const byRoot = new Map();
  for (const t of pool) {
    const root = find(t.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(t);
  }

  const groups = [];
  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    const survivor = suggestedSurvivor(members, raceCounts);
    const rows = members.map(t => {
      if (t.id === survivor.id) {
        return {
          ...t,
          races: raceCounts[t.id] || 0,
          score: 1,
          confidence: "survivor",
          reason: "The track everything else folds into",
          conflict: "",
          suggested: true,
        };
      }
      // Scored against the SURVIVOR even when the two met through a third
      // track, so the row answers the question the admin is actually asking:
      // how close is this to the venue we are keeping?
      const match = bestNameMatch(survivor, t);
      const conflict = conflictBetween(survivor, t);
      const confidence = confidenceOf(match.score, trackKey(match.a) === trackKey(match.b));
      return {
        ...t,
        races: raceCounts[t.id] || 0,
        score: match.score,
        confidence,
        reason: matchReason(match.b, match.a),
        // Filled in only when the two met through a name neither still shows —
        // "matched on its former name" is the difference between a suggestion
        // an admin can judge and one they have to take on trust.
        matched_on: match.a === survivor.name && match.b === t.name ? "" : `“${match.b}” ↔ “${match.a}”`,
        conflict,
        // Ticked by default only when nothing disagrees AND the names really
        // are the same name. Everything else is offered unticked: the admin
        // reads it, and one press adds it.
        suggested: !conflict && (confidence === "exact" || confidence === "strong"),
      };
    });
    rows.sort((a, b) => (b.id === survivor.id ? 1 : 0) - (a.id === survivor.id ? 1 : 0) || b.score - a.score);

    const ticked = rows.filter(r => r.suggested);
    groups.push({
      key: root,
      survivor_id: survivor.id,
      // The name offered for the merged venue, chosen from the copies that are
      // ticked — an unticked road course must not get to name the oval.
      suggested_name: suggestedMergeName(ticked),
      tracks: rows,
      races: rows.reduce((n, r) => n + r.races, 0),
      conflicts: rows.filter(r => r.conflict).length,
      // A group nothing disagrees about, where every copy is plainly the same
      // name. These are the ones that go through in a single press, so they are
      // offered first.
      clean: rows.every(r => r.suggested),
    });
  }

  // Clean groups first (they are the ones that go through in one press), then
  // the biggest, then the ones with the most race history riding on them.
  groups.sort((a, b) =>
    (b.clean ? 1 : 0) - (a.clean ? 1 : 0)
    || b.tracks.length - a.tracks.length
    || b.races - a.races
    || String(a.tracks[0]?.name).localeCompare(String(b.tracks[0]?.name)));
  return groups.slice(0, limit);
}

// What a group's review panel is about to ask the API for, given what the admin
// has ticked. Returns null when there is nothing left to merge — the admin has
// unticked everything, or decided the whole group is fine as it is.
export function planGroupMerge(group, { survivorId, checkedIds = [], name = "" } = {}) {
  const intoId = survivorId || group?.survivor_id;
  const fromIds = [...new Set(checkedIds)].filter(id => id && id !== intoId);
  if (!intoId || !fromIds.length) return null;
  const survivor = (group?.tracks || []).find(t => t.id === intoId);
  const finalName = String(name ?? "").trim()
    || suggestedMergeName((group?.tracks || []).filter(t => t.id === intoId || fromIds.includes(t.id)))
    || String(survivor?.name ?? "").trim();
  return { into_id: intoId, from_ids: fromIds, name: finalName };
}
