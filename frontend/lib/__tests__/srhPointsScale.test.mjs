// Does SimRacerHub score this season the way we do?
//
// The season importer never brings finishing points across: this app's own
// points structure pays for every position, which is what keeps one scorer.
// That rule is right and it is silent, and silence is the problem. A league
// whose SimRacerHub season pays 75 for a win while their structure here pays
// 100 imports twelve rounds that all look fine, and the championship it
// produces is one nobody recognises — discovered weeks later by a driver
// asking why the table disagrees with the site they raced on.
//
// So the two scales are compared and the disagreement is flagged with the
// decision attached. That comparison has to be right about four things, and a
// FALSE flag is nearly as bad as a missed one — an importer that cries wolf on
// every round teaches an admin to click past the one round that mattered:
//
//   1. WHAT IS COMPARED. SimRacerHub's `rpts` is what the POSITION paid, before
//      its bonuses, penalties and stage points. Comparing totals would flag
//      every driver who took a fastest lap, whatever the scales say.
//   2. WHICH ROWS COUNT. A provisional entry holds no position, a DNS scores
//      nothing here whatever the scale pays, and a row with no position is not
//      evidence. None of the three says anything about a scale.
//   3. WHICH POSITIONS. Only the ones SimRacerHub actually paid. A 30-deep
//      scale here and an 18-car field there is not a disagreement.
//   4. WHAT KIND OF DISAGREEMENT. A round that paid nothing at all ran for no
//      championship points — a real thing, and NOT the same statement as "our
//      scales differ". This app expresses it by scoring the session on nothing,
//      not by picking a different scale.
//
// And the season's verdict: one round differing is that round's business, most
// of them differing is the league's scale and should be one question.
import assert from "node:assert";
import { appScale, compareScales, scaleReport, scaleSummary, scaleToTemplate, srhScale } from "../srhPointsScale.js";
import { resolveSeasonConfig } from "../standings.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// A SimRacerHub row, with only the fields the comparison reads.
const row = (finish_pos, rpts, extra = {}) => ({ finish_pos: String(finish_pos), rpts, provisional: "N", status: "Running", ...extra });

// ── 1. What is compared ───────────────────────────────────────────────────

// `rpts` is the position's own points. The total a driver took home (`tpts`)
// includes bonuses and penalties, which say nothing about the scale — reading
// the total here would flag the fastest-lap winner's round every time.
check("the position's points are read, not the driver's total",
  srhScale({ results: [
    row(1, 100, { tpts: 105, bpts: 5 }),
    row(2, 90, { tpts: 85, ppts: 5 }),
    row(3, 80, { tpts: 90, spts: 10 }),
  ] }),
  { 1: 100, 2: 90, 3: 80 });

// ── 2. Which rows count ───────────────────────────────────────────────────

check("a provisional entry is not evidence about a scale",
  srhScale({ results: [row(1, 100), row(2, 0, { provisional: "Y" })] }), { 1: 100 });
check("nor is a DNS, which scores nothing here whatever the scale pays",
  srhScale({ results: [row(1, 100), row(2, 0, { status: "DNS" })] }), { 1: 100 });
check("a DNF raced, so it counts",
  srhScale({ results: [row(1, 100), row(2, 90, { status: "DNF" })] }), { 1: 100, 2: 90 });
check("a row with no position says nothing",
  srhScale({ results: [row(1, 100), { finish_pos: "", rpts: 50 }, { rpts: 50 }] }), { 1: 100 });
check("a page with no rows at all gives no scale", srhScale({ results: [] }), {});
check("and neither does nothing", srhScale(null), {});
// Two rows at one position can't happen in a scored session, but a page that
// somehow shows one must not have the later row quietly redefine the scale.
check("the first row at a position wins", srhScale({ results: [row(1, 100), row(1, 7)] }), { 1: 100 });

// ── 3. Which positions, and the verdict ───────────────────────────────────

const ours = resolveSeasonConfig({
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70 }),
  qual_points: JSON.stringify({ 1: 10, 2: 5 }),
  bonus_points: {},
}, null);

check("the race scale is what scores a race", appScale(ours, "race")[1], 100);
check("…and a feature", appScale(ours, "feature")[1], 100);
check("…and a heat", appScale(ours, "heat")[1], 100);
check("the qualifying scale is what scores qualifying", appScale(ours, "qualifying")[1], 10);

{
  const agreed = compareScales({ 1: 100, 2: 90 }, appScale(ours, "race"));
  check("scales that agree are a match", agreed.verdict, "match");
  check("…over the positions that were paid", agreed.checked, 2);
  check("…with nothing to report", agreed.differences, []);
  check("…and the summary stays quiet", scaleSummary(agreed), "");
}

{
  const differs = compareScales({ 1: 75, 2: 70, 3: 80 }, appScale(ours, "race"));
  check("a different scale is flagged", differs.verdict, "differs");
  check("…naming the positions that differ", differs.differences, [
    { pos: 1, srh: 75, app: 100 }, { pos: 2, srh: 70, app: 90 },
  ]);
  check("…and the position that agreed is left out", differs.differences.some(d => d.pos === 3), false);
  ok("…in one readable line", scaleSummary(differs) === "SimRacerHub paid P1 75 vs 100 · P2 70 vs 90");
}

// THE false-flag case: a shorter field. Positions nobody finished in say
// nothing about how the season is scored, and flagging them would make every
// short grid look wrong.
check("a field shorter than the scale is not a disagreement",
  compareScales({ 1: 100, 2: 90 }, { 1: 100, 2: 90, 3: 80, 4: 70, 5: 60 }).verdict, "match");
// …and a field DEEPER than the scale is one: the app pays those positions
// nothing, which is a real difference in what the round is worth.
check("a field deeper than the scale is a disagreement",
  compareScales({ 1: 100, 2: 90, 3: 80 }, { 1: 100, 2: 90 }).differences, [{ pos: 3, srh: 80, app: 0 }]);

// Halves are normal, and both sides arrive through JSON, so the comparison is
// to three decimals rather than exact.
check("half points that agree are a match", compareScales({ 1: 12.5 }, { 1: 12.5 }).verdict, "match");
check("…and a float that is only nearly equal still agrees",
  compareScales({ 1: 0.1 + 0.2 }, { 1: 0.3 }).verdict, "match");
check("…while a real half-point difference is flagged",
  compareScales({ 1: 12.5 }, { 1: 12 }).verdict, "differs");

// ── 4. The other kinds of answer ──────────────────────────────────────────

{
  const unscored = compareScales({ 1: 0, 2: 0, 3: 0 }, appScale(ours, "race"));
  check("a round SimRacerHub paid nothing for is its own verdict", unscored.verdict, "unscored");
  ok("…said in words that name what it is", /no championship points/.test(scaleSummary(unscored)));
  check("…and is not reported as a scale disagreement", unscored.differences, []);
}
// The flag worth the most of all. A heat and a consolation score NOTHING here
// until a points structure is named for them, so a heat night imported onto a
// season that has never named one lands five sessions of which four pay nobody
// anything. Quoting a scale comparison there would name a number the session is
// not going to pay either — worse than useless.
{
  const none = compareScales({ 1: 20, 2: 18, 3: 16 }, appScale(ours, "race"), { countsPoints: false });
  check("a session that counts toward nothing here is its own verdict", none.verdict, "not_scored_here");
  check("…and is not dressed up as a scale disagreement", none.differences, []);
  check("…with what it pays here stated as the nothing it is", none.app_total, 0);
  ok("…and said in words that name the fix", /counts toward nothing/.test(scaleSummary(none)));
  // Turning the session's points on is what a structure does, so it shares the
  // picker with a scale disagreement rather than getting one of its own.
  const report = scaleReport([{
    race_id: "r1", label: "Race 1",
    sessions: [{ session: "Heat 1", scale: { verdict: "not_scored_here", differences: [] } }],
  }]);
  check("it is offered the same picker as a scale disagreement",
    [report.flagged[0].sessions.length, report.flagged[0].unscored.length], [1, 0]);
  // A session that already counts is compared on its scale as before.
  check("a session that does count is compared normally",
    compareScales({ 1: 100 }, appScale(ours, "race"), { countsPoints: true }).verdict, "match");
}

check("nothing to compare is not a disagreement", compareScales({}, appScale(ours, "race")).verdict, "unknown");
ok("…and says so", /printed no points/.test(scaleSummary(compareScales({}, {}))));
check("a match needs no summary", scaleSummary({ verdict: "match" }), "");
check("and neither does nothing at all", scaleSummary(null), "");

// ── 5. The season's verdict ───────────────────────────────────────────────

const round = (id, verdicts) => ({
  race_id: id,
  label: `Race ${id}`,
  sessions: verdicts.map((v, i) => ({ session: `S${i + 1}`, scale: { verdict: v, differences: [] } })),
});

{
  // One round out of four: that round's business, not the season's.
  const one = scaleReport([round("r1", ["differs"]), round("r2", ["match"]), round("r3", ["match"]), round("r4", ["match"])]);
  check("one round differing is flagged", one.flagged.map(f => f.race_id), ["r1"]);
  check("…but is not a season-wide question", one.season_wide, false);
  check("…and the flag names the session", one.flagged[0].sessions.map(s => s.session), ["S1"]);

  // Three out of four: the league's scale, and one question should answer it.
  const most = scaleReport([round("r1", ["differs"]), round("r2", ["differs"]), round("r3", ["differs"]), round("r4", ["match"])]);
  check("most rounds differing is a season-wide question", most.season_wide, true);
  check("…listing every round it covers", most.flagged.length, 3);

  // Exactly half is not "most" — the season is split, and one answer for all of
  // it would be a guess.
  check("half is not most", scaleReport([round("r1", ["differs"]), round("r2", ["match"])]).season_wide, false);
  // Nor is a single round read so far, however it came out: one round is not a
  // season, and offering to re-point the whole calendar off it is overreach.
  check("a single round read is never season-wide",
    scaleReport([round("r1", ["differs"])]).season_wide, false);

  check("a season that agrees throughout is not flagged at all",
    scaleReport([round("r1", ["match"]), round("r2", ["match"])]).flagged, []);
  check("…and rounds not yet read don't count toward the verdict",
    scaleReport([round("r1", ["differs"]), { race_id: "r2", sessions: [] }]).read, 1);

  // A round that paid nothing is flagged too, but kept apart: the answer to it
  // is "score this on nothing", not "score it on another scale".
  const none = scaleReport([round("r1", ["unscored"])]);
  check("an unscored round is flagged", none.flagged.length, 1);
  check("…and kept apart from the scale disagreements",
    [none.flagged[0].sessions.length, none.flagged[0].unscored.length], [0, 1]);
}

// ── 6. SimRacerHub's scale as a points structure ──────────────────────────
//
// The league this matters most to is the one whose scale this app has never
// been told about: without this they are told the scales disagree, offered a
// list that doesn't contain the right one, and sent off to type thirty
// positions in by hand from the site they are importing from.
{
  const built = scaleToTemplate({ 3: 80, 1: 100, 2: 90 }, "SimRacerHub · 2026");
  check("the scale becomes a points structure", built.race_points, { 1: 100, 2: 90, 3: 80 });
  check("…in position order", Object.keys(built.race_points), ["1", "2", "3"]);
  check("…under the name it was given", built.name, "SimRacerHub · 2026");
  check("…scoring a race, not qualifying", built.qual_points, {});
  // Bonuses are deliberately NOT invented from one night's rows: SimRacerHub
  // itemises those per driver rather than as a structure, and a rate guessed
  // from one round would be paid to everybody in every round afterwards.
  check("no bonus rate is invented from one night", built.bonus_points, {});

  const qual = scaleToTemplate({ 1: 10, 2: 5 }, "Q", { sessionType: "qualifying" });
  check("a qualifying scale fills the qualifying table", qual.qual_points, { 1: 10, 2: 5 });
  check("…and leaves the race table alone", qual.race_points, {});

  // What it builds has to be readable by the scorer it will be handed to.
  const config = resolveSeasonConfig({ race_points: "{}", qual_points: "{}", bonus_points: {} }, null);
  check("and the structure it builds is the scale it was built from",
    compareScales({ 1: 100, 2: 90, 3: 80 }, built.race_points).verdict, "match");
  ok("…which the config resolver can read", !!config);
}

console.log(`srhPointsScale: ${n} checks passed`);
