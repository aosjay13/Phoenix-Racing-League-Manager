// A points scale, pasted out of a spreadsheet.
//
// Leagues do not invent their points structure in this app. It already exists,
// in a sheet somebody built years ago and edits every off-season:
//
//   2026 Points Structure
//   Position   Points
//   1          350
//   2          320
//   3          300
//   …
//
// Retyping that as a comma list — forty numbers, in order, without transposing
// two of them — is the kind of job a computer should be doing. So selecting the
// column and pasting it IS the import: paste into the Race Points box (or the
// Qualifying one) and the scale arrives already in order.
//
// What comes back is the same comma list an admin would have typed, so nothing
// downstream changes at all: the scale is still stored, scored and edited
// exactly as it always was, and a paste read wrongly is fixed by typing over
// it. That is the whole design — this module turns text into a scale and has no
// opinion about what a scale is for.
//
// The splitting is the importers' own (detectDelimiter / splitLine in
// lib/resultsImport.js) and so is the header vocabulary, because a points
// table's columns are named the same things a results table's are — "Pos",
// "Place", "Finish", "Points", "Pts". A pasted schedule reuses the same two
// (lib/pastedSchedule.js); a fix to them fixes all three.
//
// Pure and dependency-free, so the whole thing is testable with bare `node`.

import { detectDelimiter, headerToField, splitLine } from "@/lib/resultsImport";

const clean = s => String(s ?? "").trim();

// A scale longer than this is not a points structure, it is a spreadsheet
// pasted by accident. Refused with a reason rather than filling the box with a
// thousand positions.
export const MAX_POSITIONS = 500;

export function ordinal(n) {
  const teen = Math.abs(n) % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][Math.abs(n) % 10] || "th"}`;
}

// One cell → the number in it, or null.
//
// Forgiving about what a spreadsheet puts around a number and strict about
// whether there is one: "1st" is 1, "1,200" is 1200 (a thousands separator that
// survived the split), "350 pts" is 350, and "—", "N/A" and "DNF" are nothing
// at all rather than 0 — a position that pays no points and a cell nobody
// filled in must not read the same.
export function pointsNumber(raw) {
  const text = clean(raw);
  if (!text) return null;
  const stripped = text
    .replace(/(\d)(st|nd|rd|th)\b/i, "$1")   // 1st, 2nd, 3rd…
    .replace(/[^0-9.\-]/g, "");
  if (!/\d/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// Is this cell a number and nothing else? Used to tell a row of DATA from a
// row of words above it — "2026 Points Structure" holds a number without being
// one, and a heading is not a finishing position.
const BARE = /^[-+]?\$?\d[\d.,]*%?$/;
const bareNumber = cell => {
  const text = clean(cell);
  return !!text && (BARE.test(text) || /^\d+(st|nd|rd|th)$/i.test(text));
};

// Which of the two columns a header names, or null for one this doesn't read.
//
// The shared importer vocabulary answers first — a results table and a points
// table name these columns the same things — and only the words a points TABLE
// uses that a results table never does are added on top.
const EXTRA_HEADERS = [
  ["points", /\b(score|award|payout|worth|value)\b/i],
  ["position", /\b(spot|standing|slot|grid)\b/i],
];

export function pointsHeaderField(cell) {
  const shared = headerToField(cell);
  if (shared === "points") return "points";
  if (shared === "finish_pos") return "position";
  const text = clean(cell);
  if (!text) return null;
  for (const [field, re] of EXTRA_HEADERS) if (re.test(text)) return field;
  return null;
}

// The pasted text → a grid of cells, blank lines dropped.
//
// The comma is the one delimiter that is also punctuation inside a number, so
// it is trusted only when every line splits into the same number of cells —
// which is what a real CSV does. A column of points where one figure is written
// "1,200" splits unevenly, and reading those lines whole (with pointsNumber
// putting the number back together) is right where reading them as two columns
// would invent a 1st place worth 200.
function toGrid(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { delimiter: null, grid: [] };
  const delimiter = detectDelimiter(lines.join("\n"));
  const grid = lines.map(l => splitLine(l, delimiter)).filter(cells => cells.some(c => clean(c) !== ""));
  if (delimiter === "," && grid.length > 1 && new Set(grid.map(r => r.length)).size > 1) {
    return { delimiter: "line", grid: lines.map(l => [clean(l)]) };
  }
  return { delimiter, grid };
}

const isPosition = n => Number.isInteger(n) && n >= 1 && n <= MAX_POSITIONS;

// A spreadsheet's last row is very often a total, and a total is not a
// finishing position. Named as such when it is left out, so an admin can tell
// "left out because it is a total" from "left out because I misread it".
const totalish = cells => /\b(totals?|sum|average|avg|maximum|max)\b/i.test(cells.join(" "));

// The row that names the columns, or -1: whichever of the first few rows names
// the most of them, the lower row winning a tie because it is the one nearest
// the data. A row holding a bare number is data, whatever its other cells spell
// — which is what stops "1  350" being read as a header for mentioning nothing.
function findHeader(grid) {
  let idx = -1, best = 0;
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
    if (grid[i].some(bareNumber)) continue;
    const named = grid[i].filter(c => pointsHeaderField(c) != null).length;
    if (named >= best && named >= 1) { best = named; idx = i; }
  }
  return idx;
}

// Every column index whose cells are ALL numbers — the candidates for "which
// column holds the points".
function numericColumns(rows) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out = [];
  for (let i = 0; i < width; i++) {
    if (rows.length && rows.every(r => pointsNumber(r[i]) != null)) out.push(i);
  }
  return out;
}

// A column of positions: whole numbers, each one only once, counting upwards.
// Anything else is a points column that happens to come first.
function looksLikePositions(values) {
  if (values.length < 2 || !values.every(isPosition)) return false;
  if (new Set(values).size !== values.length) return false;
  return values.every((v, i) => i === 0 || v > values[i - 1]);
}

// A scale written along a row rather than down a column: either one row of
// points, or a row of positions with the points under it. Both are layouts
// spreadsheets genuinely use, and reading one down the first column instead
// would turn a 30-position scale into a 2-position one. Null when the text
// isn't that shape.
function readAcross(rows) {
  if (rows.length === 1) {
    const values = rows[0].map(pointsNumber).filter(v => v != null);
    if (values.length < 2) return null;
    return {
      pairs: values.map((v, i) => [i + 1, v]),
      layout: "across",
      columns: { points: "the pasted row", position: null },
    };
  }
  if (rows.length === 2) {
    const top = rows[0].map(pointsNumber);
    const bottom = rows[1].map(pointsNumber);
    const width = Math.min(top.length, bottom.length);
    if (width < 2 || top.some(v => v == null) || bottom.some(v => v == null)) return null;
    if (!looksLikePositions(top.slice(0, width))) return null;
    return {
      pairs: top.slice(0, width).map((pos, i) => [pos, bottom[i]]),
      layout: "across",
      columns: { points: "the second row", position: "the first row" },
    };
  }
  return null;
}

// ── The paste → a points scale ────────────────────────────────────────────
//
// Returns null when the text holds no points at all, so a caller can say so
// instead of blanking a scale somebody had already typed.
//
// Everything it read, and everything it did not, comes back with it: which
// column was taken as what, the rows left out and why, the positions nobody
// listed. A points structure is forty numbers that all look alike, so "here is
// what I made of your paste" is the only way an admin can check it before it
// replaces the one they had.
export function parsePastedPoints(text) {
  const { delimiter, grid } = toGrid(text);
  if (!grid.length) return null;

  const skipped = [];
  const warnings = [];
  const said = cells => cells.map(clean).filter(Boolean).join(" ");

  const headerIdx = findHeader(grid);
  const headers = headerIdx >= 0 ? grid[headerIdx].map(clean) : null;

  // Everything from the header row up is preamble — a sheet's title, a note,
  // the blank line under it. So is any row above the first one holding a real
  // number, which is what catches a title when no header row was found.
  const rest = grid.slice(headerIdx + 1);
  let start = 0;
  while (start < rest.length && !rest[start].some(bareNumber)) {
    const text = said(rest[start]);
    if (text) skipped.push({ text, reason: "a heading, not a position" });
    start += 1;
  }

  const rows = [];
  for (const cells of rest.slice(start)) {
    if (totalish(cells)) {
      const text = said(cells);
      if (text) skipped.push({ text, reason: "a total, not a position" });
      continue;
    }
    rows.push(cells);
  }
  if (!rows.length) return null;

  if (!headers) {
    const across = readAcross(rows);
    if (across) return finish(across, { headers, delimiter, skipped, warnings });
  }

  // ── Which column is which ───────────────────────────────────────────────
  const withNumbers = rows.filter(r => r.some(c => pointsNumber(c) != null));
  const numeric = numericColumns(withNumbers);
  const headerCol = field => (headers || []).findIndex(h => pointsHeaderField(h) === field);
  const namedPoints = headers ? headerCol("points") : -1;
  const namedPosition = headers ? headerCol("position") : -1;

  // The points column: the one the header names, else the last column that is a
  // number all the way down — the rightmost figure on a row is the one a sheet
  // works its way towards.
  let pointsCol = namedPoints >= 0 ? namedPoints : (numeric.length ? numeric[numeric.length - 1] : -1);
  if (pointsCol < 0) return null;
  // A column the header named but which never holds a number is a header read
  // wrongly, not an empty scale.
  if (namedPoints >= 0 && !rows.some(r => pointsNumber(r[pointsCol]) != null)) {
    if (!numeric.length) return null;
    pointsCol = numeric[numeric.length - 1];
    warnings.push(`The column headed “${headers[namedPoints]}” held no numbers, so the points were read from the ${ordinal(pointsCol + 1)} column instead.`);
  }

  // The position column: the one the header names, else a first column that
  // counts 1, 2, 3 upwards while a different column holds the points.
  let positionCol = namedPosition >= 0 && namedPosition !== pointsCol ? namedPosition : -1;
  if (positionCol < 0 && pointsCol !== 0 && numeric.includes(0)
      && looksLikePositions(withNumbers.map(r => pointsNumber(r[0])))) {
    positionCol = 0;
  }

  const pairs = [];
  let implied = 0;
  for (const cells of rows) {
    const points = pointsNumber(cells[pointsCol]);
    if (points == null) {
      const text = said(cells);
      if (text) skipped.push({ text, reason: "no points in it" });
      continue;
    }
    if (positionCol < 0) { pairs.push([++implied, points]); continue; }
    const position = pointsNumber(cells[positionCol]);
    if (!isPosition(position)) {
      const text = said(cells);
      if (text) skipped.push({ text, reason: "no finishing position in it" });
      continue;
    }
    pairs.push([position, points]);
  }
  if (!pairs.length) return null;

  return finish({
    pairs,
    layout: positionCol >= 0 ? "table" : "list",
    columns: {
      points: headers?.[pointsCol] || `column ${pointsCol + 1}`,
      position: positionCol >= 0 ? (headers?.[positionCol] || `column ${positionCol + 1}`) : null,
    },
  }, { headers, delimiter, skipped, warnings });
}

// position/points pairs → the scale a points box holds, plus everything an
// admin needs to check it before it is applied.
function finish({ pairs, layout, columns }, { headers, delimiter, skipped, warnings }) {
  const table = {};
  const duplicates = [];
  for (const [position, points] of pairs) {
    // The first wins, and the second is named. A position listed twice is a
    // mistake in the paste — two scales side by side, a row copied twice — and
    // quietly taking either one would be a scale nobody chose.
    if (position in table) { duplicates.push(position); continue; }
    table[position] = points;
  }
  const last = Math.max(...Object.keys(table).map(Number));
  if (last > MAX_POSITIONS) {
    return { error: `That paste reaches position ${last}. A points scale stops at ${MAX_POSITIONS} — check you selected the points and nothing else.` };
  }

  // Gaps are filled with 0 rather than closed up. A scale is read BY POSITION —
  // the first number is what a win pays, the second what 2nd pays — so a paste
  // missing 4th has to leave 4th paying nothing, not slide 5th up into it.
  const filled = [];
  for (let pos = 1; pos <= last; pos++) {
    if (!(pos in table)) { table[pos] = 0; filled.push(pos); }
  }

  if (duplicates.length) {
    const named = [...new Set(duplicates)];
    warnings.push(`${named.map(ordinal).join(", ")} ${named.length === 1 ? "is" : "are"} listed more than once — the first value was kept.`);
  }
  if (filled.length) {
    const shown = filled.slice(0, 6).map(ordinal).join(", ");
    warnings.push(`Nothing was listed for ${shown}${filled.length > 6 ? ` and ${filled.length - 6} more` : ""}, so ${filled.length === 1 ? "it scores" : "they score"} 0.`);
  }

  const list = Array.from({ length: last }, (_, i) => table[i + 1]).join(", ");
  return { list, table, count: last, layout, columns, headers, delimiter, skipped, warnings, filled, duplicates };
}

// One line saying what a paste came to, for the preview above the Fill button.
export function pointsPasteSummary(read) {
  if (!read || read.error) return "";
  const shown = [1, 2, 3].filter(p => p <= read.count).map(p => `${ordinal(p)} ${read.table[p]}`);
  const tail = read.count > 4 ? ` … ${ordinal(read.count)} ${read.table[read.count]}` : "";
  return `${read.count} position${read.count === 1 ? "" : "s"} — ${shown.join(", ")}${tail}`;
}

// Does this text look like it came out of a spreadsheet rather than being a
// comma list somebody typed? What decides whether a paste into a points box is
// read as a scale or dropped in as-is: a scale written across several lines, or
// with tab stops in it, is a spreadsheet's doing.
export function looksPasted(text) {
  const raw = String(text ?? "");
  return /\t/.test(raw) || raw.split(/\r?\n/).filter(l => l.trim()).length > 1;
}
