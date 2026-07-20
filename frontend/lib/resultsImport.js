// Game-agnostic results parser for the Smart Import tool.
//
// Turns a pasted table (from SimRacerHub, iRacing, Forza, an F1 game, a
// spreadsheet, …) or a CSV export into grid-ready result rows. Everything
// here is pure and defensive: it never throws on malformed input — it
// collects `warnings` and falls missing stats back to null/0 so a partial
// import still succeeds.
//
// Pipeline: parseTable() → mapHeaders() → matchDriver() per row, all wrapped
// by the parseResults() convenience entry point. Each stage is exported so
// the import UI can let an admin override the column mapping or resolve an
// ambiguous driver name and re-run just that stage.

// ── 1. Tabular parsing ────────────────────────────────────────────────────

// Pick the delimiter that yields the most consistent column count across
// lines. Handles comma CSV, tab-separated, pipe tables, and whitespace-
// aligned text (2+ spaces) — the shapes these game exports actually take.
export function detectDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return ",";
  const candidates = [
    { key: "\t", re: /\t/ },
    { key: ",", re: /,/ },
    { key: "|", re: /\s*\|\s*/ },
    { key: "ws", re: /\s{2,}/ }, // whitespace-aligned columns
  ];
  let best = { key: ",", score: -1 };
  for (const c of candidates) {
    const counts = lines.slice(0, 20).map(l => l.split(c.re).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Reward many columns that are consistent line-to-line.
    const consistent = counts.filter(n => n === max).length;
    const score = max * 10 + consistent;
    if (score > best.score) best = { key: c.key, score };
  }
  return best.key;
}

// Split one line into cells for the chosen delimiter, honouring simple
// double-quote CSV quoting (commas inside quotes stay put).
function splitLine(line, delim) {
  if (delim === "ws") return line.trim().split(/\s{2,}/).map(c => c.trim());
  if (delim === "|") return line.split(/\s*\|\s*/).map(c => c.trim()).filter((c, i, a) => !((i === 0 || i === a.length - 1) && c === ""));
  if (delim === ",") {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  return line.split(delim).map(c => c.trim());
}

// Parse raw text into { headers, rows, delimiter }. Locates the header row
// (which is not always the first line — SimRacerHub / iRacing exports lead with
// a metadata block: League, Track, Race Laps, …) and treats everything above it
// as preamble to discard. `headers` is null when no header row is detected.
export function parseTable(text) {
  const delimiter = detectDelimiter(text);
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: null, rows: [], delimiter };
  const grid = lines.map(l => splitLine(l, delimiter)).filter(r => r.some(c => c !== ""));
  if (!grid.length) return { headers: null, rows: [], delimiter };

  // Find the row that best looks like a column header: the one mapping the most
  // cells to known result fields. The real header wins easily over a 2-column
  // "Race Laps,18" metadata line, so scanning past a preamble is safe. Empty
  // leading columns (SimRacerHub prefixes rows with ",,") map to nothing and are
  // harmless — the same offset applies to the data rows, so indices stay aligned.
  let headerIdx = -1, headerScore = 0;
  const scanTo = Math.min(grid.length, 40);
  for (let i = 0; i < scanTo; i++) {
    const known = grid[i].filter(c => headerToField(c) != null).length;
    if (known > headerScore) { headerScore = known; headerIdx = i; }
  }

  // A confident header row (several recognised columns) lets us drop everything
  // above it as preamble and take the rest as data — this is the export path.
  if (headerIdx >= 0 && headerScore >= 3) {
    return { headers: grid[headerIdx], rows: grid.slice(headerIdx + 1), delimiter };
  }

  // Otherwise fall back to the single-row heuristic for simple pasted tables,
  // where the header (if any) is the first line and may map only a field or two.
  const first = grid[0];
  const numericCells = first.filter(c => /^[-+]?\d+(\.\d+)?$/.test(c)).length;
  const knownCells = first.filter(c => headerToField(c) != null).length;
  const looksLikeHeader = knownCells >= 2 || (knownCells >= 1 && numericCells === 0);

  return looksLikeHeader
    ? { headers: first, rows: grid.slice(1), delimiter }
    : { headers: null, rows: grid, delimiter };
}

// ── 2. Header → schema mapping ────────────────────────────────────────────

// Ordered so earlier fields win when a header could match two (e.g. a column
// literally named "Pos" maps to finish, not start). Each entry lists lower-
// case synonyms; matching is done on a normalized (alnum-only) token.
export const FIELD_SYNONYMS = [
  ["finish_pos", ["fin", "finish", "finishpos", "finishingposition", "pos", "position", "place", "final", "result", "rank", "p", "overall"]],
  ["start_pos", ["start", "startpos", "startingposition", "grid", "gridpos", "st", "qualifyingposition", "qualpos", "starting"]],
  ["driver", ["driver", "drivername", "name", "racer", "competitor", "member", "entrant"]],
  ["car_number", ["car", "carno", "carnumber", "no", "num", "number", "carnum"]],
  ["laps", ["laps", "lap", "lapscompleted", "lapscomplete", "completed", "comp"]],
  ["laps_led", ["led", "lapsled", "ledlaps", "ll"]],
  ["incidents", ["inc", "incidents", "incident", "contact", "x", "offtracks"]],
  ["interval", ["interval", "int", "gap", "behind", "diff", "delta"]],
  ["race_time", ["time", "totaltime", "racetime", "elapsed", "totalracetime", "finishtime"]],
  ["qual_time", ["qualtime", "qtime", "bestqual", "qualifyingtime", "bestqualtime"]],
  ["fastest_lap_time", ["fastestlap", "fastlap", "bestlap", "fastest", "bestlaptime", "fl", "fastestlaptime"]],
  ["status", ["status", "out", "reason", "outreason", "classified", "dnf"]],
  ["points", ["points", "pts", "champpoints"]],
];

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The schema field a single header cell maps to, or null.
export function headerToField(header) {
  const n = norm(header);
  if (!n) return null;
  for (const [field, syns] of FIELD_SYNONYMS) {
    if (syns.includes(n)) return field;
  }
  // Loose contains-match as a fallback (e.g. "Start Pos", "Driver Name"). Only
  // distinctive synonyms (4+ chars) participate — a 3-char token like "int"
  // would otherwise match inside unrelated headers ("Total Po·int·s"); short
  // synonyms such as int/led/pos/inc are still caught by the exact pass above.
  for (const [field, syns] of FIELD_SYNONYMS) {
    if (syns.some(s => s.length >= 4 && (n.includes(s) || s.includes(n)))) return field;
  }
  return null;
}

// headers[] → { field: columnIndex }. First column to claim a field wins, so
// a later ambiguous header can't steal it. When there's no header row, guess
// positionally: the widest text column is the driver, the first small-integer
// column is finishing position.
export function mapHeaders(headers, sampleRows = []) {
  const mapping = {};
  if (headers) {
    headers.forEach((h, i) => {
      const field = headerToField(h);
      if (field && !(field in mapping)) mapping[field] = i;
    });
    return mapping;
  }
  // Headerless: positional inference from the data itself.
  const cols = Math.max(0, ...sampleRows.map(r => r.length));
  const colStats = [];
  for (let c = 0; c < cols; c++) {
    const cells = sampleRows.map(r => r[c] ?? "").filter(x => x !== "");
    const alpha = cells.filter(x => /[a-z]/i.test(x)).length;
    const smallInt = cells.filter(x => /^\d{1,3}$/.test(x)).length;
    colStats.push({ c, alpha, smallInt, textLen: cells.reduce((a, x) => a + x.length, 0) });
  }
  const driverCol = colStats.slice().sort((a, b) => b.alpha - a.alpha || b.textLen - a.textLen)[0];
  if (driverCol && driverCol.alpha) mapping.driver = driverCol.c;
  const finishCol = colStats.find(s => s.c !== mapping.driver && s.smallInt);
  if (finishCol) mapping.finish_pos = finishCol.c;
  return mapping;
}

// ── 3. Fuzzy driver matching ──────────────────────────────────────────────

// Levenshtein edit distance, capped-small strings so it's cheap per compare.
function editDistance(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const cleanName = s => String(s ?? "")
  .replace(/^#?\d{1,3}\s+/, "")        // leading car number "12 Jane Doe"
  .replace(/\(.*?\)/g, "")             // "(ROOKIE)", team tags
  .replace(/[_*]/g, " ")
  .toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

// 0..1 similarity; blends whole-string edit ratio with last-name/token overlap
// so "J. Doe" ↔ "Jane Doe" and "Doe, Jane" ↔ "Jane Doe" score well.
export function nameSimilarity(a, b) {
  const ca = cleanName(a), cb = cleanName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const ratio = 1 - editDistance(ca, cb) / Math.max(ca.length, cb.length);
  const ta = new Set(ca.split(" ")), tb = new Set(cb.split(" "));
  const shared = [...ta].filter(t => tb.has(t) && t.length > 1).length;
  const tokenScore = shared / Math.max(ta.size, tb.size);
  return Math.max(ratio, tokenScore * 0.95);
}

// Match one imported name against roster entries. Returns the best entry plus
// ranked candidates and a status the UI acts on:
//   matched   — confident (exact/normalized or ≥ strong threshold)
//   suggested — a likely candidate the admin should confirm
//   unmatched — nothing close; admin picks manually or skips the row
export function matchDriver(rawName, entries, { strong = 0.9, weak = 0.55 } = {}) {
  const ranked = entries
    .map(e => ({ entry_id: e.id ?? e.entry_id, name: e.name ?? e.driver_name, number: e.number ?? e.driver_number ?? null, score: nameSimilarity(rawName, e.name ?? e.driver_name) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const candidates = ranked.slice(0, 5);
  if (!best || best.score < weak) return { raw: rawName, entry_id: null, status: "unmatched", candidates };
  if (best.score >= strong) return { raw: rawName, entry_id: best.entry_id, matched_name: best.name, score: best.score, status: "matched", candidates };
  return { raw: rawName, entry_id: best.entry_id, matched_name: best.name, score: best.score, status: "suggested", candidates };
}

// ── 4. Row assembly ───────────────────────────────────────────────────────

const toInt = v => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const truthyStatus = v => {
  const s = String(v ?? "").toLowerCase();
  if (/dns|did not start/.test(s)) return "dns";
  if (/dnf|dq|disq|retired|out|crash/.test(s)) return /dq|disq/.test(s) ? "dq" : "dnf";
  return "finished";
};

// Convert parsed cells + a column mapping into normalized result rows. Missing
// columns degrade gracefully to null/0. `finish_pos` falls back to import
// order (1..N) when no finishing-position column is present, so a bare name
// list still imports as an ordered field the admin can adjust.
export function buildRows({ rows }, mapping, entries, opts = {}) {
  const warnings = [];
  const get = (row, field) => (mapping[field] != null ? row[mapping[field]] : undefined);
  const out = rows.map((row, idx) => {
    const rawName = String(get(row, "driver") ?? "").trim();
    const match = rawName ? matchDriver(rawName, entries) : { raw: "", entry_id: null, status: "unmatched", candidates: [] };
    const fastRaw = get(row, "fastest_lap_time");
    const values = {
      finish_pos: toInt(get(row, "finish_pos")) ?? (idx + 1),
      start_pos: toInt(get(row, "start_pos")),
      laps: toInt(get(row, "laps")) ?? 0,
      laps_led: toInt(get(row, "laps_led")) ?? 0,
      incidents: toInt(get(row, "incidents")) ?? 0,
      interval: (get(row, "interval") ?? "").toString().trim() || "",
      race_time: (get(row, "race_time") ?? "").toString().trim() || "",
      qual_time: (get(row, "qual_time") ?? "").toString().trim() || "",
      status: truthyStatus(get(row, "status")),
      // A fastest-lap *time* column can't tell us who was fastest overall on
      // its own; we mark the fastest of the field below.
      _fastest_lap_time: fastRaw ? String(fastRaw).trim() : "",
    };
    return { raw: row, rawName, match, values };
  });

  // Flag the single fastest lap of the field if a lap-time column was mapped.
  if (mapping.fastest_lap_time != null) {
    const parseLap = t => {
      const m = String(t).match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
      if (!m) return Infinity;
      return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
    };
    let bestI = -1, bestV = Infinity;
    out.forEach((r, i) => { const v = parseLap(r.values._fastest_lap_time); if (r.values._fastest_lap_time && v < bestV) { bestV = v; bestI = i; } });
    out.forEach((r, i) => { r.values.fastest_lap = i === bestI; });
  } else {
    out.forEach(r => { r.values.fastest_lap = false; });
  }

  if (!("driver" in mapping)) warnings.push("No driver column detected — map one to match names.");
  if (!("finish_pos" in mapping)) warnings.push("No finishing-position column detected — rows will import in the order pasted.");
  return { rows: out, warnings };
}

// ── High-level entry point ────────────────────────────────────────────────

// One-shot parse: raw text/CSV + roster entries → everything the import UI
// needs. Never throws; parse failures surface as a warning with empty rows.
export function parseResults(text, entries = [], opts = {}) {
  try {
    const table = parseTable(text);
    const mapping = mapHeaders(table.headers, table.rows.slice(0, 8));
    const built = buildRows(table, mapping, entries, opts);
    const matched = built.rows.filter(r => r.match.status === "matched").length;
    const suggested = built.rows.filter(r => r.match.status === "suggested").length;
    const unmatched = built.rows.filter(r => r.match.status === "unmatched").length;
    return {
      ok: true,
      delimiter: table.delimiter,
      headers: table.headers,
      mapping,
      rows: built.rows,
      warnings: built.warnings,
      summary: { total: built.rows.length, matched, suggested, unmatched },
    };
  } catch (err) {
    return { ok: false, error: err.message, rows: [], warnings: [`Could not parse input: ${err.message}`], mapping: {}, headers: null, summary: { total: 0, matched: 0, suggested: 0, unmatched: 0 } };
  }
}

// The schema fields the UI offers in its column-mapping dropdowns.
export const MAPPABLE_FIELDS = [
  ["finish_pos", "Finish"],
  ["start_pos", "Start"],
  ["driver", "Driver"],
  ["car_number", "Car #"],
  ["laps", "Laps"],
  ["laps_led", "Laps Led"],
  ["incidents", "Incidents"],
  ["interval", "Interval / Gap"],
  ["race_time", "Race Time"],
  ["qual_time", "Qual Time"],
  ["fastest_lap_time", "Fastest Lap"],
  ["status", "Status"],
  ["points", "Points (ignored)"],
];
