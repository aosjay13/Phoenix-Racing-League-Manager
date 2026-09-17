// A points scale, pasted out of a spreadsheet.
//
// A league's points structure already exists in a sheet, and retyping forty
// numbers in order is where a transposed pair goes unnoticed for a season. The
// invariants that matter:
//
//   1. the shapes a spreadsheet actually produces all read — a column, a
//      position/points pair of columns, a scale written across a row, a CSV —
//      and the title and totals lines around them are left out;
//   2. a scale is read BY POSITION. A gap leaves that position paying 0 rather
//      than sliding the next one up into it, which would silently re-score
//      every place below the gap;
//   3. nothing is silently dropped or invented: every row left out is named
//      with a reason, and every decision the reader made for itself is a
//      warning;
//   4. text that is not a points scale reads as nothing at all, so a paste can
//      never blank a scale somebody had already typed.
import assert from "node:assert/strict";
import {
  MAX_POSITIONS, looksPasted, ordinal, parsePastedPoints, pointsHeaderField,
  pointsNumber, pointsPasteSummary,
} from "../pointsPaste.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const list = text => parsePastedPoints(text)?.list;

// ── 1. One cell → the number in it ────────────────────────────────────────

check("a plain number reads", pointsNumber("350"), 350);
check("an ordinal position reads", pointsNumber("1st"), 1);
check("…whichever ordinal it is", [pointsNumber("2nd"), pointsNumber("3rd"), pointsNumber("11th")], [2, 3, 11]);
check("a thousands separator that survived the split is put back", pointsNumber("1,200"), 1200);
check("units around a number are ignored", pointsNumber("350 pts"), 350);
check("a decimal reads", pointsNumber("0.5"), 0.5);
check("a negative reads", pointsNumber("-5"), -5);
check("an empty cell is nothing, not zero", pointsNumber(""), null);
check("…and so is a dash", pointsNumber("—"), null);
check("…and a word", pointsNumber("DNF"), null);
check("…and nothing at all", pointsNumber(null), null);

check("ordinals read correctly in the teens", [ordinal(1), ordinal(2), ordinal(3), ordinal(11), ordinal(12), ordinal(13), ordinal(21), ordinal(40)],
  ["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "40th"]);

// ── 2. Column headers use the importers' own vocabulary ───────────────────

check("Position names the position column", pointsHeaderField("Position"), "position");
check("…so does Pos", pointsHeaderField("Pos"), "position");
check("…and Place", pointsHeaderField("Place"), "position");
check("…and Finish", pointsHeaderField("Finish"), "position");
check("Points names the points column", pointsHeaderField("Points"), "points");
check("…so does Pts", pointsHeaderField("Pts"), "points");
check("…and the words a points table uses that a results table doesn't",
  [pointsHeaderField("Score"), pointsHeaderField("Award")], ["points", "points"]);
check("a column this doesn't read is simply not one of the two", pointsHeaderField("Driver"), null);
check("an empty header names nothing", pointsHeaderField(""), null);

// ── 3. The shapes a spreadsheet actually produces ─────────────────────────

check("a bare column of points, top place first", list("350\n320\n300\n280"), "350, 320, 300, 280");
check("…with a header over it", list("Points\n350\n320\n300"), "350, 320, 300");
check("a position/points pair of columns", list("Position\tPoints\n1\t350\n2\t320\n3\t300"), "350, 320, 300");
check("…with no header at all", list("1\t350\n2\t320\n3\t300"), "350, 320, 300");
check("…with a driver column between them", list("Finish\tDriver\tPoints\n1\tAna\t350\n2\tBo\t320"), "350, 320");
check("a CSV reads the same as a tabbed paste", list("Position,Points\n1,350\n2,320\n3,300"), "350, 320, 300");
check("space-aligned columns read too", list("1   350\n2   320\n3   300"), "350, 320, 300");
check("a scale written across one row", list("350\t320\t300\t280\t260"), "350, 320, 300, 280, 260");
check("…and one written as positions over points", list("1\t2\t3\t4\n350\t320\t300\t280"), "350, 320, 300, 280");
check("positions written as ordinals", list("1st\t350\n2nd\t320\n3rd\t300"), "350, 320, 300");
check("a sheet listing its places out of order still scores each one its own points",
  list("Pos\tPoints\n3\t300\n2\t320\n1\t350"), "350, 320, 300");
check("a thousands separator down a single column doesn't split it into two",
  list("1,200\n1,100\n950"), "1200, 1100, 950");
check("one position is a scale", list("Points\n350"), "350");

const titled = parsePastedPoints("2026 Points Structure\nPos\tPts\n1\t350\n2\t320\n3\t300\nTotal\t970");
check("a title line above the table and a total under it are both left out", titled.list, "350, 320, 300");
check("…and the total is named as one", titled.skipped.map(s => s.reason), ["a total, not a position"]);
check("the columns it used are reported back", [titled.columns.position, titled.columns.points], ["Pos", "Pts"]);

// ── 4. A scale is read by position ────────────────────────────────────────

const gap = parsePastedPoints("Pos\tPoints\n1\t350\n2\t320\n4\t280");
check("a missing position pays 0 rather than sliding the next one up", gap.list, "350, 320, 0, 280");
check("…and is named", gap.filled, [3]);
ok("…in a warning an admin will read", gap.warnings.some(w => w.includes("3rd")));

const dupe = parsePastedPoints("Pos\tPoints\n1\t350\n1\t320\n2\t300");
check("a position listed twice keeps the first value", dupe.list, "350, 300");
ok("…and says so rather than picking one quietly", dupe.warnings.some(w => w.includes("1st")));

const junk = parsePastedPoints("Pos\tPoints\n1\t350\n2\tN/A\n3\t300\nnotes: check with Dave");
check("a row with no points in it is left out, not read as 0", junk.list, "350, 0, 300");
check("…and every row left out is named with a reason",
  junk.skipped.map(s => s.reason), ["no points in it", "no points in it"]);
ok("…and the position it left behind is reported as scoring 0", junk.warnings.some(w => w.includes("2nd")));

// ── 5. Text that is not a points scale reads as nothing ───────────────────

check("prose is not a points scale", parsePastedPoints("hello there\nthis is just a note"), null);
check("an empty paste is nothing", parsePastedPoints("   "), null);
check("nothing at all is nothing", parsePastedPoints(null), null);
check("a header with no rows under it is nothing", parsePastedPoints("Position\tPoints"), null);
// A whole spreadsheet pasted by accident, rather than the points column in it.
ok("a scale longer than a points structure can be is refused with a reason",
  parsePastedPoints(Array.from({ length: MAX_POSITIONS + 1 }, () => "5").join("\n"))
    .error?.includes(String(MAX_POSITIONS)));
check("…and a single row claiming a place past the end of one is left out, not read",
  parsePastedPoints(`Pos\tPoints\n${MAX_POSITIONS + 1}\t5`), null);
check("…while the rows around such a row still read",
  list(`Pos\tPoints\n1\t350\n2\t320\n${MAX_POSITIONS + 1}\t5`), "350, 320");

// ── 6. What gets read as a paste at all ───────────────────────────────────

ok("a tabbed paste came out of a spreadsheet", looksPasted("1\t350"));
ok("…so did a paste spanning several lines", looksPasted("350\n320"));
ok("a comma list somebody typed did not, so it lands exactly as typed", !looksPasted("350, 320, 300"));
ok("…nor did a single number", !looksPasted("350"));

// ── 7. The one-line preview ───────────────────────────────────────────────

check("a long scale is previewed by its ends",
  pointsPasteSummary(parsePastedPoints("350\n320\n300\n280\n260")),
  "5 positions — 1st 350, 2nd 320, 3rd 300 … 5th 260");
check("a short one is previewed whole",
  pointsPasteSummary(parsePastedPoints("350\n320")), "2 positions — 1st 350, 2nd 320");
check("nothing read previews as nothing", pointsPasteSummary(null), "");

// A real one, end to end: the IMSA scale as a league keeps it.
const imsa = parsePastedPoints([
  "2026 Championship Points",
  "Finishing Position\tChampionship Points",
  ...Array.from({ length: 30 }, (_, i) => `${i + 1}\t${[350, 320, 300, 280, 260][i] ?? 250 - 10 * (i - 5)}`),
  "Total\t7150",
].join("\n"));
check("a whole season's scale arrives in order", imsa.count, 30);
check("…paying what the sheet says", [imsa.table[1], imsa.table[5], imsa.table[30]], [350, 260, 10]);
check("…with nothing invented", [imsa.filled, imsa.duplicates], [[], []]);
check("…and the totals line left out", imsa.skipped.length, 1);

console.log(`all ${n} checks passed — a points scale pastes out of a spreadsheet in the order it was written`);
