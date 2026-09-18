// A pasted results table that counted its own points, and what the app does
// with them.
//
// The problem this answers is the same one the SimRacerHub season importer
// answers, arriving through a different door. A league scored somewhere else —
// in a spreadsheet, in another game's results screen — has a championship table
// already, and the numbers in it were produced by a scale, a set of bonuses and
// a set of penalties this app has no copy of. Re-deriving points from a
// finishing position is therefore guaranteed to disagree with the table the
// results were copied out of, and the disagreement has to be typed away race by
// race. So when the pasted text carries a Points column, that column is what
// the rows are scored on.
//
// What is checked here:
//
//   1. A Points column is READ — under every spelling a spreadsheet uses, out
//      of tab-, comma- and space-separated text, and whether or not the figure
//      is written with a decimal or a sign.
//   2. A row carrying that figure is PAID it, exactly, whatever the season's
//      own structure would have paid the same finishing position — and the
//      itemised breakdown says so rather than reciting a scale nobody used.
//   3. Clearing the figure hands the row straight back to the league's own
//      structure, which is what makes "import it, then edit it" true.
//   4. The double-count guard: a source's total already contains its own
//      penalties and bonuses, so nothing may be carried into the Adj column on
//      top of it. Adj remains available for a correction made afterwards.
//   5. A table with no points at all changes nothing: those rows are scored by
//      the structure, exactly as they always were.
//   6. The wiring, read off the components: one switch decides it, it is shown
//      only where there are points to take, and Apply still writes nothing.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { buildRows, mapHeaders, parseTable } from "../resultsImport.js";
import { explainPoints, pointsFor, resolveSeasonConfig } from "../standings.js";
import { resultDoc } from "../resultsWrite.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

// A season whose own structure pays nothing like the numbers in the pasted
// tables below — so a row scored by the structure and a row scored by the paste
// can never be confused for one another.
const config = resolveSeasonConfig({
  race_points: JSON.stringify({ 1: 100, 2: 90, 3: 80, 4: 70, 5: 60 }),
  qual_points: JSON.stringify({ 1: 10, 2: 8, 3: 6 }),
  bonus_points: { best_lap: 5, most_laps_led: 5, lead_a_lap: 1, halfway_point: 0, hard_charger: 0 },
}, null);

const roster = [
  { id: "e1", name: "Ana Reyes" },
  { id: "e2", name: "Bo Tanaka" },
  { id: "e3", name: "Cass Liu" },
];

// What the review table does with one parsed row: the figure the source paid,
// and whether it is taken as the row's own points. Mirrors apply() in
// components/ImportResultsModal.jsx, which is asserted against at the bottom.
const importedRow = (row, entryId, { takePoints = true } = {}) => {
  const paid = row.values.points ?? null;
  const override = takePoints && paid != null ? paid : null;
  return {
    entry_id: entryId,
    finish_pos: row.values.finish_pos,
    laps_led: row.values.laps_led,
    fastest_lap: row.values.fastest_lap,
    manual_points: override,
    points_adjustment: override != null ? 0 : null,
  };
};

// ── 1. Reading the column ─────────────────────────────────────────────────
//
// A spreadsheet's Points column arrives under whatever heading whoever built it
// typed. Every one of these has to land on the same field, because a heading
// that isn't recognised leaves the figures out of the import entirely and the
// standings quietly go back to disagreeing.
for (const heading of ["Points", "points", "PTS", "Pts.", "Champ Points", "Championship Points"]) {
  const text = `Pos\tDriver\t${heading}\n1\tAna Reyes\t47\n2\tBo Tanaka\t42\n`;
  const table = parseTable(text);
  const mapping = mapHeaders(table.headers);
  const { rows } = buildRows(table, mapping, roster);
  check(`"${heading}" is a points column`, rows.map(r => r.values.points), [47, 42]);
}

// The same table pasted the three ways a spreadsheet leaves it on the clipboard.
for (const [label, text] of [
  ["tab-separated", "Pos\tDriver\tPoints\n1\tAna Reyes\t47\n2\tBo Tanaka\t42\n"],
  ["comma-separated", "Pos,Driver,Points\n1,Ana Reyes,47\n2,Bo Tanaka,42\n"],
  ["space-aligned", "Pos   Driver       Points\n1     Ana Reyes    47\n2     Bo Tanaka    42\n"],
]) {
  const table = parseTable(text);
  const { rows } = buildRows(table, mapHeaders(table.headers), roster);
  check(`${label} text still carries the points`, rows.map(r => r.values.points), [47, 42]);
  check(`…on the right drivers`, rows.map(r => r.match.entry_id), ["e1", "e2"]);
}

// Figures a scoring system actually prints: a half point, a negative total
// after a heavy penalty, and a zero that means zero rather than "no column".
{
  const text = "Pos\tDriver\tPoints\n1\tAna Reyes\t47.5\n2\tBo Tanaka\t-3\n3\tCass Liu\t0\n";
  const table = parseTable(text);
  const { rows } = buildRows(table, mapHeaders(table.headers), roster);
  check("a fractional total survives", rows[0].values.points, 47.5);
  check("…a negative one too", rows[1].values.points, -3);
  check("…and a zero is a figure, not a blank", rows[2].values.points, 0);
  ok("…which is not the same as no column at all", rows[2].values.points !== null);
}

// A table that never mentions points says so, rather than saying nothing.
{
  const text = "Pos\tDriver\tLaps\n1\tAna Reyes\t50\n2\tBo Tanaka\t50\n";
  const table = parseTable(text);
  const { rows } = buildRows(table, mapHeaders(table.headers), roster);
  check("no points column, no points", rows.map(r => r.values.points), [null, null]);
}

// ── 2. Scoring on what was pasted ─────────────────────────────────────────
{
  const text = "Pos\tDriver\tLed\tPoints\n1\tAna Reyes\t30\t47\n2\tBo Tanaka\t0\t42\n3\tCass Liu\t0\t38\n";
  const table = parseTable(text);
  const { rows } = buildRows(table, mapHeaders(table.headers), roster);
  const imported = rows.map((r, i) => importedRow(r, roster[i].id));

  check("every row is scored on the figure the table counted",
    imported.map(r => pointsFor({ ...r, session_type: "race" }, config)), [47, 42, 38]);
  // The point of the exercise, stated as the thing that was wrong before: this
  // season's own structure pays 100/90/80 for the same three positions, so a
  // row scored by it is off by more than half.
  check("…and not on this league's own structure",
    rows.map(r => pointsFor({ finish_pos: r.values.finish_pos, session_type: "race" }, config)), [100, 90, 80]);

  // A winner who led 30 laps would collect a lead-a-lap bonus and the most-laps
  // -led bonus from the structure. Neither may be added: the source's total
  // already decided what leading was worth, whatever this league pays for it.
  check("a bonus this league pays is not added on top of an imported total",
    pointsFor({ ...imported[0], laps_led: 30, most_laps_led: true, fastest_lap: true, session_type: "race" }, config), 47);

  // And the breakdown the grid shows on hover has to tell the same story, or
  // the driver checking their total is reading a different scorer's working.
  const parts = explainPoints({ ...imported[0], session_type: "race" }, config);
  check("the breakdown is the figure itself", parts.map(p => p.value), [47]);
  ok("…named as a figure set on the row", /set on this row/i.test(parts[0].label));
  check("…and adds up to the total", parts.reduce((a, p) => a + p.value, 0),
    pointsFor({ ...imported[0], session_type: "race" }, config));

  // ── 3. Handing a row back ───────────────────────────────────────────────
  //
  // Clearing the cell is the whole of "then I can edit them afterward": the row
  // returns to the structure, with nothing left behind to explain.
  // 100 for the win, plus the 1 this league pays for leading a lap — which the
  // imported total had been standing in place of.
  check("clearing the cell hands the row back to the structure",
    pointsFor({ ...imported[0], manual_points: "", session_type: "race" }, config), 101);
  check("…and a null does the same", pointsFor({ ...imported[1], manual_points: null, session_type: "race" }, config), 90);

  // Editing it is the other half: whatever is typed is what the row scores.
  check("editing the cell scores the edited figure",
    pointsFor({ ...imported[2], manual_points: "40", session_type: "race" }, config), 40);

  // ── 4. The double-count guard ───────────────────────────────────────────
  check("nothing is carried into Adj alongside an imported total",
    imported.map(r => r.points_adjustment), [0, 0, 0]);
  // Said as the failure it prevents: a source that docked a driver 10 has
  // already docked them in the total, so carrying -10 across as well pays the
  // penalty twice.
  check("…because carrying one would charge the penalty twice",
    pointsFor({ ...imported[0], points_adjustment: -10, session_type: "race" }, config), 37);
  // Adj is still there for a correction made AFTER the import, which is a
  // separate statement from what the source paid on the day.
  check("an adjustment typed afterwards still applies",
    pointsFor({ ...imported[1], points_adjustment: 5, session_type: "race" }, config), 47);

  // ── 5. Unticked, nothing changes ────────────────────────────────────────
  const untaken = rows.map((r, i) => importedRow(r, roster[i].id, { takePoints: false }));
  check("with the box unticked the structure scores every row",
    untaken.map(r => pointsFor({ ...r, session_type: "race" }, config)), [101, 90, 80]);
  check("…and no figure is written onto the rows", untaken.map(r => r.manual_points), [null, null, null]);
  check("…nor any adjustment", untaken.map(r => r.points_adjustment), [null, null, null]);
}

// A qualifying sheet pasted with its own points is scored the same way — the
// qualifying scale is a structure like any other, and an imported figure wins
// over it too.
{
  const text = "Pos\tDriver\tTime\tPoints\n1\tAna Reyes\t1:02.115\t12\n2\tBo Tanaka\t1:02.400\t9\n";
  const table = parseTable(text);
  const { rows } = buildRows(table, mapHeaders(table.headers), roster, { sessionType: "qualifying" });
  const imported = rows.map((r, i) => importedRow(r, roster[i].id));
  check("a pasted qualifying sheet scores on its own points",
    imported.map(r => pointsFor({ ...r, session_type: "qualifying" }, config)), [12, 9]);
  check("…where the league's own qualifying scale would have paid otherwise",
    rows.map(r => pointsFor({ finish_pos: r.values.finish_pos, session_type: "qualifying" }, config)), [10, 8]);
}

// ── The writer ────────────────────────────────────────────────────────────
//
// What the grid sends on Save goes through one writer, and an imported figure
// has to survive it as a number — a string "47" stored in Firestore would sort
// and sum as text everywhere it is read back.
{
  const ctx = { race_id: "r1", season_id: "s1", session: "Race", sessionType: "race", classByEntry: {}, now: "now", uid: "u1" };
  const stored = row => resultDoc({ entry_id: "e1", finish_pos: 1, ...row }, ctx);
  check("an imported figure is stored as a number", stored({ manual_points: "47" }).manual_points, 47);
  check("…a fractional one keeps its fraction", stored({ manual_points: "47.5" }).manual_points, 47.5);
  check("…a negative total survives the trip", stored({ manual_points: "-3" }).manual_points, -3);
  check("…a cleared cell stores nothing at all", stored({ manual_points: "" }).manual_points, null);
  check("…and a row that never had one is untouched", stored({}).manual_points, null);
  check("…while a zero is a real figure, not a blank", stored({ manual_points: 0 }).manual_points, 0);
  // A row taken at the source's total carries no adjustment, and the writer has
  // to store that zero rather than reading it as "nothing said".
  check("the zeroed Adj is stored as a zero", stored({ manual_points: 47, points_adjustment: 0 }).points_adjustment, 0);
  check("…so the stored row scores exactly what the table paid",
    pointsFor({ ...stored({ manual_points: 47, points_adjustment: 0 }), session_type: "race" }, config), 47);
}

// ── 6. The wiring ─────────────────────────────────────────────────────────
//
// The rules above are only true if the components actually follow them, and
// the two that could silently stop being true are the switch (which decides
// whether anything is taken at all) and Apply (which must still write nothing).
const modal = read("components/ImportResultsModal.jsx");
const editor = read("components/SessionEditor.jsx");

ok("the plain-text importer offers the same bargain as the season importer",
  /Score every driver on the points in this table/.test(modal));
ok("…on by default, because a table that printed points meant them",
  /useState\(true\)/.test(modal.slice(modal.indexOf("takePoints"), modal.indexOf("takePoints") + 120)));
ok("…and only offered where the table carried some", /\{showPoints && \(/.test(modal));
ok("…which a pasted Points column is", /r\.values\.points != null/.test(modal));

const apply = modal.slice(modal.indexOf("function apply()"), modal.indexOf("onApply(rows"));
ok("Apply reads whatever the source paid, SimRacerHub or spreadsheet",
  /srhPointsFor\(idx\)\?\.total \?\? row\.values\.points/.test(modal));
ok("…hands it over as the row's own points", /manual_points: override/.test(apply));
ok("…and zeroes Adj when it does", /points_adjustment: override != null \? 0 :/.test(apply));

const applyImport = editor.slice(editor.indexOf("function applyImport("), editor.indexOf("setImportOpen(false)"));
ok("the grid puts it on the row", /manual_points: im\.manual_points != null/.test(applyImport));
ok("…and leaves the cell empty when the import carried none", /: row\.manual_points,/.test(applyImport));
// Apply fills the grid; Save writes. An import that wrote to Firestore on Apply
// would take the review step away from the statistician.
ok("applying still writes nothing", !/api\(/.test(applyImport));
ok("…including the session's own points switch", !/onSessionPointsEnabledChange\(/.test(applyImport));
ok("…which Save writes instead", /await onSessionPointsEnabledChange\(session, true\)/.test(editor));

console.log(`pastedPoints: ${n} checks passed`);
