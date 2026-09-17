// A season's schedule, pasted out of a spreadsheet.
//
// SimRacerHub scores iRacing leagues and nothing else, so the schedule importer
// built on it (lib/srhSchedule.js) leaves every other game where it started:
// building next season one round at a time, retyping dates and tracks that are
// already sitting in a spreadsheet somebody made months ago. Those leagues do
// keep a schedule — it just lives in Excel or Google Sheets rather than behind
// a URL:
//
//   2023 Season 1 Schedule
//   Race   Dates       Track                        Total Race Laps
//   1      10/30/2023  Daytona Oval                 50
//   2      11/6/2023   Road America                 18
//   …
//                      Total Laps =                 310
//
// Selecting that and pasting it is the whole import. This module turns it into
// the SAME shape parseSrhSchedule() produces, which is the point of it: every
// hard part downstream is then shared rather than written twice. The round
// numbering, the date-order resolution, the race documents, the venue matching
// against the tracks a league already has, and the review table an admin
// approves are all the ones the SimRacerHub importer already uses, and a fix to
// any of them fixes both.
//
// What is genuinely different is only the reading, and it is different in one
// way that matters: SimRacerHub writes a FIXED set of column headers, so that
// module matches them exactly. A spreadsheet header is whatever a human typed —
// "Dates", "Total Race Laps", "Circuit", "Rd" — so the matching here is
// deliberately loose, and the review table is what catches a column it read
// wrongly.
//
// Pure and dependency-free, so the whole thing is testable with bare `node`.

import { detectDelimiter, splitLine } from "@/lib/resultsImport";
import { readRaceLength, readScheduleDate, resolveDates } from "@/lib/srhSchedule";

// ── 1. The columns ────────────────────────────────────────────────────────
//
// Ordered most specific first, because a header can answer to two: "Total Race
// Laps" contains both "race" and "lap", and it is a distance, not a round
// number. First pattern to match wins, so putting `laps` above `round` is what
// decides that — and a column nothing matches is simply ignored, which is
// better than guessing at it.
const COLUMNS = [
  ["laps", [/lap/]],
  ["minutes", [/\bmins?\b/, /minute/, /duration/]],
  ["length", [/length/, /distance/]],
  ["date", [/date/, /\bwhen\b/, /\bday\b/]],
  ["track", [/track/, /venue/, /circuit/, /course/, /location/]],
  // NOT a bare "Race" — in a schedule that column holds the round number far
  // more often than the event's name, and it is `round` below that claims it.
  // "Race Name" still lands here, through /name/.
  ["name", [/event/, /name/, /title/]],
  ["car", [/\bcars?\b/, /vehicle/]],
  ["round", [/^#$/, /round/, /\brd\b/, /^race$/, /^no\.?$/, /^r$/]],
];

const clean = s => String(s ?? "").trim();
const lower = s => clean(s).toLowerCase();

// The field a header cell names, or null.
export function pastedHeaderField(header) {
  const h = lower(header);
  if (!h) return null;
  for (const [field, patterns] of COLUMNS) {
    if (patterns.some(re => re.test(h))) return field;
  }
  return null;
}

// headers[] → { field: columnIndex }. First column to claim a field keeps it.
export function mapPastedHeaders(headers) {
  const mapping = {};
  (headers || []).forEach((h, i) => {
    const field = pastedHeaderField(h);
    if (field && !(field in mapping)) mapping[field] = i;
  });
  return mapping;
}

// ── 2. Reading a row ──────────────────────────────────────────────────────

const int = raw => {
  const n = Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};

// How far a round runs. A "Laps" column holding a bare 50 means fifty laps, and
// a "Minutes" column holding 45 means three quarters of an hour — the header is
// what says which, and a bare number in a column called neither is read as the
// text it is ("50 laps", "1h 30m") before falling back to laps.
function readLength(cell, mapping) {
  const laps = int(cell(mapping.laps));
  if (laps > 0) return { length_type: "laps", total_laps: laps };
  const mins = int(cell(mapping.minutes));
  if (mins > 0) return { length_type: "time", race_minutes: mins };
  const raw = clean(cell(mapping.length));
  if (!raw) return null;
  const read = readRaceLength(raw);
  if (read) return read;
  const bare = int(raw);
  return bare > 0 ? { length_type: "laps", total_laps: bare } : null;
}

// A round nobody races. Leagues write these into a calendar to hold the week,
// and they are not events — srhSchedulePlan drops them and counts them.
const OFF_WEEK = /\b(off[-\s]?week|bye|no\s+race|break|holiday|tbd|tba)\b/i;

// A spreadsheet's last row is very often a total, and a total is not a round:
//
//        Total Laps =    310
//
// It has no round number and no date, which is the test used — a row that says
// neither where it sits in the season nor when it was run is not describing a
// race, whatever else is in it. That one rule also throws out the blank spacer
// rows and the stray note at the bottom, without this needing a list of the
// words people write in them.
const looksLikeTotal = cells => /\btotals?\b/i.test(cells.join(" "));

// ── 3. JSON, read as the same table ───────────────────────────────────────

// A schedule exported as JSON, turned into the grid the rest of this module
// reads. An array of objects IS a table — its keys are the header row and its
// values are the rows — so rather than a second reader with its own ideas about
// dates and totals, JSON becomes a grid and goes through exactly the pipeline a
// paste does. The key names go through the same forgiving vocabulary, so
// {"Race":1,"Dates":"10/30/2023"} and {"round":1,"date":"2023-10-30"} both land.
//
// Returns { grid, title } or null when the text isn't JSON, or is JSON that
// isn't a list of rounds.
export function jsonScheduleGrid(text) {
  const raw = String(text ?? "").trim();
  if (!raw.startsWith("[") && !raw.startsWith("{")) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }

  // A bare array, or an object wrapping one under whichever name the exporter
  // chose. The title comes along when the wrapper carries one.
  let title = "";
  let list = null;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object") {
    for (const key of ["races", "rounds", "schedule", "events", "rows", "data"]) {
      if (Array.isArray(data[key])) { list = data[key]; break; }
    }
    for (const key of ["season", "season_name", "name", "title"]) {
      if (typeof data[key] === "string" && data[key].trim()) { title = data[key].trim(); break; }
    }
  }
  if (!Array.isArray(list)) return null;

  const rows = list.filter(r => r && typeof r === "object" && !Array.isArray(r));
  if (!rows.length) return null;

  // Every key any round carries, in the order they are first seen — an exporter
  // that leaves a field off one round must not shift the others' columns.
  const headers = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
  if (!headers.length) return null;

  const cell = v => {
    if (v == null) return "";
    if (typeof v === "object") return "";
    return String(v);
  };
  return { grid: [headers, ...rows.map(row => headers.map(h => cell(row[h])))], title };
}

// ── 4. The paste → the same rounds parseSrhSchedule yields ────────────────

// Returns null when the text isn't a schedule at all, so a caller can say so
// rather than create an empty season.
//
// The shape is parseSrhSchedule's, exactly, so srhSchedulePlan() consumes this
// without knowing where it came from.
export function parsePastedSchedule(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  // JSON first — it is unambiguous, and reading it as delimited text would
  // find commas inside it and make nonsense. Either way what comes out is a
  // grid, and the rest of this reads a grid.
  const asJson = jsonScheduleGrid(raw);
  const delimiter = asJson ? "json" : detectDelimiter(raw);
  const grid = (asJson
    ? asJson.grid
    : raw.split(/\r?\n/).map(line => splitLine(line, delimiter))
  )
    // A spreadsheet pads short rows with empty cells, so a "blank" line is one
    // whose cells are all empty rather than one with no characters.
    .filter(cells => cells.some(c => clean(c) !== ""));
  if (!grid.length) return null;

  // The header row: whichever of the first few rows names the most columns.
  // It is rarely the first — a schedule is usually titled, and the title is
  // what the season gets called.
  let headerIdx = -1, best = 0;
  // JSON has no title rows and no preamble: its keys are the header row, full
  // stop. Scoring for one would let a round whose values happen to read like
  // column names beat it.
  if (asJson) { headerIdx = 0; best = grid[0].filter(c => pastedHeaderField(c) != null).length; }
  else for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const known = grid[i].filter(c => pastedHeaderField(c) != null).length;
    if (known > best) { best = known; headerIdx = i; }
  }
  // One recognised column is not a header row, it is a coincidence — a row
  // reading "1  10/30/2023  Daytona Oval  50" has a cell matching /\brace$/
  // nowhere, but a title like "2023 Season 1 Schedule" could match one pattern
  // on its own. Two is the bar.
  if (headerIdx < 0 || best < 2) return null;

  const headers = grid[headerIdx].map(clean);
  const mapping = mapPastedHeaders(headers);
  // Without somewhere to put a date, a track or a name, whatever this is isn't
  // a schedule this app can build a season from.
  if (mapping.date == null && mapping.track == null && mapping.name == null) return null;

  // Everything above the header is the title. The last non-empty line of it is
  // the one nearest the table, which is the one naming this schedule.
  const titleRows = grid.slice(0, headerIdx).map(cells => cells.map(clean).filter(Boolean).join(" ").trim());
  const title = seasonNameFrom(asJson ? asJson.title : (titleRows.filter(Boolean).pop() || ""));

  const body = grid.slice(headerIdx + 1);
  const cellOf = cells => idx => (idx == null ? "" : clean(cells[idx]));

  const kept = [];
  const skipped = [];
  for (const cells of body) {
    const cell = cellOf(cells);
    const roundText = cell(mapping.round);
    const dateText = cell(mapping.date);
    const round = int(roundText);
    const dateRead = readScheduleDate(dateText);
    const track = cell(mapping.track);
    const name = cell(mapping.name);

    // The one test that separates a round from a footer: a race says either
    // where it sits in the season or when it was run.
    const placed = (Number.isInteger(round) && round >= 1) || !!dateRead;
    if (!placed) {
      const said = cells.map(clean).filter(Boolean).join(" ");
      if (said) skipped.push({ text: said, reason: looksLikeTotal(cells) ? "a total, not a round" : "no round number and no date" });
      continue;
    }

    const offWeek = OFF_WEEK.test(`${track} ${name}`);
    kept.push({
      cells,
      round: Number.isInteger(round) && round >= 1 ? round : null,
      dateRead,
      date_text: dateText,
      event: name,
      track: offWeek ? "" : track,
      off_week: offWeek,
      car: cell(mapping.car),
      length: readLength(cell, mapping),
      length_text: [cell(mapping.laps), cell(mapping.minutes), cell(mapping.length)].filter(Boolean).join(" "),
    });
  }
  if (!kept.length) return null;

  // Dates are resolved across the WHOLE paste at once, not row by row: only the
  // table as a whole can say whether 10/30 is October or a month that doesn't
  // exist. Same reader, same rule, same warning as a SimRacerHub schedule.
  const resolved = resolveDates(kept.map(r => r.dateRead));

  const rounds = kept.map((r, i) => ({
    schedule_id: null,
    off_week: r.off_week,
    round: r.round,
    date: resolved.dates[i] || "",
    date_text: r.date_text,
    event: r.event,
    track: r.track,
    config_id: null,
    car_ids: [],
    car_names: r.car ? [r.car] : [],
    length: r.length,
    length_text: r.length_text,
    // A pasted schedule says nothing about which rounds score, and a column
    // this doesn't know about is not read as one — every round counts, which is
    // what they all do by default anyway.
    points_count: null,
    times: { practice: null, qualifying: null, race: null },
  }));

  const races = rounds.filter(r => !r.off_week);
  const undated = races.filter(r => !r.date).length;
  const warnings = [];
  if (resolved.ambiguous) {
    warnings.push("These dates are written as numbers (17/08/2026) and nothing in the paste says which number is the month. They have been read as month/day — check them before creating.");
  }
  if (undated) warnings.push(`${undated} round${undated === 1 ? "" : "s"} had no date that could be read — set ${undated === 1 ? "it" : "them"} after importing.`);
  if (mapping.track == null) warnings.push("No track column was recognised, so these rounds arrive with no venue. Name the column “Track” and paste again, or set them afterwards.");
  if (mapping.laps == null && mapping.minutes == null && mapping.length == null) {
    warnings.push("No race length column was recognised, so no distance is set. Name the column “Laps” or “Minutes” and paste again, or set them afterwards.");
  }

  return {
    title,
    names: { league: "", series: "", season: title },
    headers,
    mapping,
    delimiter,
    date_order: resolved.order,
    dates_ambiguous: resolved.ambiguous,
    rounds,
    off_weeks: rounds.length - races.length,
    // Every row that was NOT read as a round, and why. A schedule importer that
    // quietly dropped a line would be one an admin could not check.
    skipped,
    warnings,
  };
}

// The title line → a season name. A spreadsheet tab is usually headed
// "2023 Season 1 Schedule", and the season is called "2023 Season 1" —
// the trailing noun says what the sheet is, not what the season is.
export function seasonNameFrom(title) {
  return clean(title).replace(/\s*[-–—:]?\s*(schedule|calendar|season schedule)\s*$/i, "").trim() || clean(title);
}
