// What SimRacerHub paid for a finishing position, against what this app will.
//
// The season results importer deliberately does NOT import finishing points:
// the league's own structure scores every position, which is what keeps one
// scorer (see lib/srhSeasonResults.js). That is right, and it is also silent.
// A league whose SimRacerHub season pays 75 for a win while this app's default
// pays 100 imports twelve rounds that all look fine and score a championship
// nobody recognises — and the first anyone notices is a driver asking why the
// table disagrees with the site they raced on.
//
// So the importer compares the two scales and says so. It still doesn't import
// the points: it flags the disagreement and lets an admin name the points
// structure that round (or every round like it) should score on, which is a
// choice this app already has a mechanism for — a session's points template
// (see resolveTemplateId in lib/standings.js).
//
// Everything here is pure, so the comparison can be tested without a database
// and reads the same whether it runs in the route or the dialog.

// A figure read as a number, never NaN — the same rule the scorer applies. See
// `num` in lib/standings.js.
const num = raw => {
  const n = Number(raw == null || raw === "" ? 0 : raw);
  return Number.isFinite(n) ? n : 0;
};

// Floats arrive from JSON on both sides and a league paying halves is normal,
// so compare to three decimals rather than exactly.
const same = (a, b) => Math.abs(num(a) - num(b)) < 0.0005;

// ── 1. SimRacerHub's scale ────────────────────────────────────────────────

// The position scale SimRacerHub actually paid in one session: finishing
// position -> the points it paid for that position, and nothing else.
//
// `rpts` is SimRacerHub's own split of a driver's total: what the POSITION was
// worth, before its bonuses (`bpts`), its penalties (`ppts`) and its stage
// points (`spts`). That split is what makes this comparable at all — a total
// would differ for a driver who took the fastest lap whatever the scales say.
//
// Three kinds of row are left out, because none of them is evidence about a
// scale:
//   • a PROVISIONAL entry, paid without racing and holding no position;
//   • a DNS, which this app scores as nothing whatever the scale pays;
//   • a row with no finishing position at all.
export function srhScale(segment) {
  const out = {};
  for (const row of segment?.results || []) {
    if (/^y/i.test(String(row?.provisional ?? ""))) continue;
    if (/dns|did not start/i.test(String(row?.status ?? ""))) continue;
    const pos = Number(row?.finish_pos);
    if (!Number.isInteger(pos) || pos < 1) continue;
    if (pos in out) continue;
    out[pos] = num(row?.rpts);
  }
  return out;
}

// ── 2. This app's scale ───────────────────────────────────────────────────

// The scale that will score a session here: a qualifying session is paid off
// the qualifying scale at its grid slot, everything else off the race scale at
// its finishing position — exactly as pointsFor reads them.
export function appScale(config, sessionType) {
  const table = sessionType === "qualifying" ? config?.qualPoints : config?.racePoints;
  return table || {};
}

// ── 3. The comparison ─────────────────────────────────────────────────────

// How the two scales compare over the positions SimRacerHub actually paid.
//
// Only those positions are checked. A 30-deep scale here and an 18-car field
// there is not a disagreement — the positions nobody finished in say nothing
// about how the season is scored, and flagging them would make every short
// field look wrong.
//
// Verdicts:
//   match     — every position compared agrees
//   differs   — at least one doesn't, and `differences` says which
//   unscored  — SimRacerHub paid nothing for any position. A round that ran
//               for no championship points is a real thing, and it is not the
//               same statement as "our scales disagree" — this app expresses it
//               by switching the session's points off, not by picking a scale.
//   not_scored_here
//             — the other way round, and the one worth the most: SimRacerHub
//               paid real points for this session and here it counts toward
//               nothing. A heat and a consolation score zero until somebody
//               names a points structure for them (see defaultSessionFlags in
//               lib/standings.js), so importing a heat night onto a season that
//               has never named one imports five sessions of which four pay
//               nobody anything. Comparing scales would report "P1 20 vs 100",
//               which is worse than useless: it names a number the session is
//               not going to pay either.
//   unknown   — nothing to compare: no rows, or none carrying a position
export function compareScales(srh = {}, app = {}, { countsPoints = true } = {}) {
  const positions = Object.keys(srh).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (!positions.length) return { verdict: "unknown", checked: 0, differences: [], srh_total: 0, app_total: 0 };

  const srhTotal = positions.reduce((a, p) => a + num(srh[p]), 0);
  const appTotal = positions.reduce((a, p) => a + num(app[p]), 0);
  if (srhTotal === 0) {
    return { verdict: "unscored", checked: positions.length, differences: [], srh_total: 0, app_total: appTotal };
  }
  if (!countsPoints) {
    return {
      verdict: "not_scored_here", checked: positions.length, differences: [],
      srh_total: srhTotal, app_total: 0,
    };
  }

  const differences = positions
    .filter(p => !same(srh[p], app[p]))
    .map(p => ({ pos: p, srh: num(srh[p]), app: num(app[p]) }));

  return {
    verdict: differences.length ? "differs" : "match",
    checked: positions.length,
    differences,
    srh_total: srhTotal,
    app_total: appTotal,
  };
}

// The disagreement in one line, for the flag on a round. Written as the two
// scales side by side at the positions that differ, because "P1 75 vs 100" is
// the sentence that tells an admin which scale is which and what it will cost.
export function scaleSummary(comparison, { limit = 4 } = {}) {
  if (!comparison || comparison.verdict === "match") return "";
  if (comparison.verdict === "unknown") return "SimRacerHub printed no points for this session.";
  if (comparison.verdict === "unscored") {
    return "SimRacerHub paid nothing for any position here — this round ran for no championship points.";
  }
  if (comparison.verdict === "not_scored_here") {
    return `SimRacerHub paid points for this session (${trim(comparison.srh_total)} across the field) and here it counts toward nothing — name a points structure and it will.`;
  }
  const shown = comparison.differences.slice(0, limit)
    .map(d => `P${d.pos} ${trim(d.srh)} vs ${trim(d.app)}`)
    .join(" · ");
  const rest = comparison.differences.length - limit;
  return `SimRacerHub paid ${shown}${rest > 0 ? ` and ${rest} more` : ""}`;
}

const trim = v => (Number.isInteger(v) ? String(v) : String(Number(Number(v).toFixed(3))));

// ── 4. The season's verdict ───────────────────────────────────────────────

// One round's scales differing is a round scored differently. Most of them
// differing is a season scored differently, and the admin should be offered one
// choice rather than the same choice twelve times — which is the whole
// difference between "flag it for that race" and "for those races".
//
// `sessions` are every session read so far, each carrying its comparison.
// Returns the rounds that differ, what they differ on, and whether this looks
// like a season-wide disagreement.
export function scaleReport(rounds = []) {
  const flagged = [];
  for (const round of rounds) {
    // A session that pays a different scale and one that pays nothing here are
    // both answered the same way — by naming a points structure for it, which
    // sets the scale AND turns the session's championship points on (see
    // defaultSessionFlags). So they share the one picker.
    const differing = (round?.sessions || [])
      .filter(s => s?.scale?.verdict === "differs" || s?.scale?.verdict === "not_scored_here");
    const unscored = (round?.sessions || []).filter(s => s?.scale?.verdict === "unscored");
    if (!differing.length && !unscored.length) continue;
    flagged.push({
      race_id: round.race_id,
      label: round.label || "",
      sessions: differing,
      unscored,
    });
  }
  const read = rounds.filter(r => (r?.sessions || []).length).length;
  return {
    flagged,
    read,
    // "Most races" — more than half of what has actually been read. A season
    // where one round pays differently is an exception to fix on that round; a
    // season where eight of twelve do is the league's scale, and offering the
    // same dropdown eight times is the wrong shape of question.
    season_wide: read > 1 && flagged.length * 2 > read,
  };
}

// ── 5. SimRacerHub's scale as a points structure ──────────────────────────

// A points template built from what SimRacerHub actually paid.
//
// Without this the flag is a dead end for the league it matters most to: the
// one whose SimRacerHub scale this app has never been told about. They would be
// told their scales disagree and offered a list of structures, none of which is
// the right one, and sent off to type thirty positions in by hand from the
// site they are importing from.
//
// Only the position scale is taken. Bonuses are deliberately left empty:
// SimRacerHub itemises those per driver rather than as a structure (see
// srhRowPoints), the importer already carries the ones this app cannot derive
// into the Adj column, and inventing a bonus rate from one night's rows would
// pay it to everybody in every round afterwards.
export function scaleToTemplate(srh = {}, name = "SimRacerHub scale", { sessionType = "race" } = {}) {
  const table = {};
  for (const pos of Object.keys(srh).map(Number).filter(Number.isInteger).sort((a, b) => a - b)) {
    table[pos] = num(srh[pos]);
  }
  const qualifying = sessionType === "qualifying";
  return {
    name,
    race_points: qualifying ? {} : table,
    qual_points: qualifying ? table : {},
    bonus_points: {},
  };
}
