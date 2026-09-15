// A SimRacerHub race page → the same tabular shape the CSV/paste importer
// already understands (see lib/resultsImport.js).
//
// SimRacerHub (SRH) is where most iRacing leagues' results actually live, and
// up to now getting a night of racing out of it meant selecting a table in the
// browser, pasting it into Smart Import, and doing that again for every heat.
// One SRH race page already holds the WHOLE event — practice, qualifying, every
// heat, the consolation and the feature — so this module turns one URL into one
// segment per session, which is exactly the shape of a league night here.
//
// It does three things and nothing else:
//   parseSrhRef(input)       — a pasted URL or bare id → the page to fetch
//   parseSrhPage(html)       — that page → the event and its sessions
//   srhSegmentTable(segment) — one session → { headers, rows }
// The third hands back a table with headers mapHeaders() already maps, so the
// whole downstream pipeline (column mapping, fuzzy driver matching against
// every name a driver answers to, the review grid) is reused unchanged — and,
// as with every other import source, nothing is written to Firestore. The API
// route fills the grid; the statistician reviews it and presses Save.
//
// Where the data comes from: an SRH results page renders each session's table
// through a React component, and hands it the session's rows as JSON in the
// page source —
//
//   React.createElement(ResultsTable, { rps: [{"finish_pos":"1",…}], … })
//
// so the numbers are read from that payload rather than scraped back out of
// table cells. No HTML parser (cheerio and friends) is needed for the results
// themselves: the only markup this reads is what SRH prints AROUND each table —
// the session's NAME (in its tab button and an <h2>) and the line of race
// statistics under it (cautions, caution laps, lead changes). That keeps this
// module dependency-free and pure, which is what lets it be unit-tested with
// bare `node` like the rest of lib/.
//
// Everything here is defensive: an unrecognised page yields null, and a session
// missing a column yields an empty cell rather than throwing.

import { formatGap, formatTime } from "@/lib/raceTime";
import { sessionTypeFromName } from "@/lib/resultsImport";

// ── 1. What to fetch ──────────────────────────────────────────────────────

// SRH serves the same scoring app on both hosts, with and without /scoring/.
const SRH_HOSTS = new Set(["simracerhub.com", "www.simracerhub.com"]);

// The query parameters an SRH race page accepts, in the order a bare number is
// tried as each. `schedule_id` identifies the event on a season's calendar and
// is what the URL in an admin's address bar almost always carries; `race_id`
// identifies one session of it (the page then shows the whole event anyway).
// `season_id` and `series_id` both resolve to that season's or series' most
// recent race, which is a useful shortcut for "import last night's results".
export const SRH_ID_PARAMS = ["schedule_id", "race_id", "season_id", "series_id"];

export const SRH_PAGE = "https://www.simracerhub.com/scoring/season_race.php";

export const srhPageUrl = (param, id) => `${SRH_PAGE}?${param}=${encodeURIComponent(id)}`;

// A pasted SimRacerHub race URL — or a bare id — → the page(s) to fetch.
//
// Returns { ok: true, param, id, urls } where `urls` is what the importer tries
// in order: one entry when the input named its own parameter, and two for a
// bare number (which could be either a schedule or a race id — SRH tells them
// apart only by trying). A refusal comes back as { ok: false, error } with
// something an admin can act on, never an exception.
//
// The host allowlist is the point of this function as much as the parsing is:
// it is the only thing that decides where the server will make a request to, so
// a link to anywhere else — an internal address, a metadata endpoint — is
// rejected here rather than fetched.
export function parseSrhRef(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "Paste a SimRacerHub race URL or race id." };

  // A bare number: the id itself, off the end of a URL the admin retyped.
  if (/^\d+$/.test(raw)) {
    return {
      ok: true, param: "schedule_id", id: raw, bare: true,
      urls: [srhPageUrl("schedule_id", raw), srhPageUrl("race_id", raw)],
    };
  }

  // A bare "schedule_id=12345" / "?race_id=12345" fragment.
  const fragment = raw.match(/^\??\s*([a-z_]+)\s*=\s*(\d+)$/i);
  if (fragment && SRH_ID_PARAMS.includes(fragment[1].toLowerCase())) {
    const param = fragment[1].toLowerCase();
    return { ok: true, param, id: fragment[2], urls: [srhPageUrl(param, fragment[2])] };
  }

  let url;
  try {
    // A link copied from the browser usually carries its scheme; one typed by
    // hand ("simracerhub.com/…") does not.
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That doesn't look like a SimRacerHub race URL or race id." };
  }

  const host = url.hostname.toLowerCase();
  if (!SRH_HOSTS.has(host)) {
    return { ok: false, error: `Only simracerhub.com links can be imported — that one points at ${host}.` };
  }

  for (const param of SRH_ID_PARAMS) {
    const id = (url.searchParams.get(param) || "").trim();
    if (/^\d+$/.test(id)) return { ok: true, param, id, urls: [srhPageUrl(param, id)] };
  }

  return {
    ok: false,
    error: "That SimRacerHub link carries no race id — open the race itself on SimRacerHub and copy the URL from there.",
  };
}

// Is this text a SimRacerHub reference rather than a results table? Cheap
// enough to run on every paste, so a URL dropped into the paste box can be
// fetched instead of parsed as one very confusing row of data.
export function looksLikeSrhRef(text) {
  const t = String(text || "").trim();
  if (!t || /[\n\r\t]/.test(t)) return false;
  if (!/simracerhub/i.test(t)) return false;
  return parseSrhRef(t).ok;
}

// ── 2. Reading the page ───────────────────────────────────────────────────

const CLOSERS = { "[": "]", "{": "}" };

// The JSON literal starting at `start` (an "[" or "{"), scanned with an
// awareness of strings so a bracket inside a driver's name can't end it early.
// → { raw, end } or null when it never closes.
function scanJson(text, start) {
  const open = text[start];
  const close = CLOSERS[open];
  if (!close) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return { raw: text.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

// Every `<key>: <json literal>` in the page, parsed. SRH renders one
// ResultsTable call per session, so `rps` (a session's rows) appears once per
// session and the rest once each. Anything unparseable is skipped rather than
// failing the import.
function jsonProps(html, key) {
  const out = [];
  const re = new RegExp(`\\b${key}\\s*:\\s*(?=[\\[{])`, "g");
  let m;
  while ((m = re.exec(html))) {
    const found = scanJson(html, m.index + m[0].length);
    if (!found) continue;
    re.lastIndex = found.end;
    try { out.push(JSON.parse(found.raw)); } catch { /* not ours — skip */ }
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

// The handful of entities SRH's own markup uses in a session name.
const decode = s => String(s ?? "")
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e) => ENTITIES[e])
  .replace(/\s+/g, " ")
  .trim();

// race id → session name.
//
// SRH heads every session's table with an <h2 class='heading-session-name'>
// ("FEATURE", "CONSOLATION", "HEAT 1", "QUALIFY") and gives the table itself
// the id `driver_table_<race id>`, so each heading names the first table that
// follows it. That pairing is what's read here, because it holds however SRH
// lays the night out: sessions with a tab each, and the stages of a single race
// (STAGE 1, STAGE 2), which are separate scored sessions sharing one tab.
//
// The tab buttons are then read as a fallback for any session whose heading
// wasn't found, being the other place the same names are written.
// The stats block between a session's heading and its table also gives up the
// race statistics this app keeps on the event: see srhSessionStats.
function sessionNames(html) {
  const names = new Map();
  const stats = new Map();

  const headings = /heading-session-name[^>]*>([^<]*)</g;
  let m;
  while ((m = headings.exec(html))) {
    const name = decode(m[1]);
    if (!name) continue;
    const table = /driver_table_(\d+)/g;
    table.lastIndex = m.index;
    const found = table.exec(html);
    if (!found || names.has(found[1])) continue;
    names.set(found[1], name);
    // Everything between the heading and the table, which is where SimRacerHub
    // prints the session's own summary line.
    stats.set(found[1], srhSessionStats(html.slice(m.index, found.index)));
  }

  const tabs = /data-bs-target\s*=\s*['"]#tab_(\d+)['"][^>]*>([^<]*)</g;
  while ((m = tabs.exec(html))) {
    const name = decode(m[2]);
    if (name && !names.has(m[1])) names.set(m[1], name);
  }

  return { names, stats };
}

// The race statistics out of a session's summary line.
//
// SimRacerHub heads each session's table with a line of its own figures, in one
// consistent shape:
//
//   1h 9m · 200 laps · 4 Leaders · 5 Lead Changes · 8 cautions (33 laps)
//
// Three of those are figures this app keeps on the race itself — how many
// caution flags flew, how many laps ran under them, and how many times the lead
// changed hands (see lib/raceStats.js) — and they are exactly the ones a
// statistician would otherwise be reading off SimRacerHub and typing in by
// hand. The leader count comes back too, but only as something to check
// against: this app counts its own leaders off the Led column rather than
// storing a figure that could disagree with the grid.
//
// A qualifying or practice session prints only its duration and lap count, so
// nothing is found and nothing is proposed — which is right, since cautions are
// not a qualifying idea.
//
// Singulars are real ("1 caution (0 laps)", "1 Leader", "1 Lead Change"), and
// so is a caution count with no lap figure at all ("0 cautions"), so every
// plural is optional and every part is read on its own.
export function srhSessionStats(html) {
  const text = decode(String(html || "").replace(/<[^>]*>/g, " "));
  const int = re => {
    const m = text.match(re);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // The lap figure is only ever the one in brackets after the caution count —
  // the session's own distance ("200 laps") is written without them.
  const cautions = text.match(/(\d+)\s+cautions?(?:\s*\(\s*(\d+)\s+laps?\s*\))?/i);
  const cautionLaps = cautions?.[2] != null ? Number(cautions[2]) : null;
  const stats = {
    caution_flags: cautions ? Number(cautions[1]) : null,
    caution_laps: Number.isFinite(cautionLaps) ? cautionLaps : null,
    lead_changes: int(/(\d+)\s+lead\s+changes?/i),
    // Not stored — see above.
    leaders: int(/(\d+)\s+leaders?/i),
  };
  return Object.values(stats).some(v => v != null) ? stats : null;
}

// Are any of a session's stats worth proposing? A line that said nothing but
// "0 cautions" is a real answer (no cautions flew), but it's also what an
// unraced session looks like, so the importer only offers a set with at least
// one figure of one in it — the same rule the results page prints them by.
export const hasSrhSessionStats = stats =>
  !!stats && ["caution_flags", "caution_laps", "lead_changes"].some(k => Number(stats[k] || 0) >= 1);

// The order SRH ran the sessions in. Its `race_id` script variable lists them
// newest-first (FEATURE, CONSOLATION, HEAT 1), so reversing gives the running
// order of the night — the order the importer's picker offers them in, and the
// same practice → qualifying → heats → feature reading the iRacing importer has.
function sessionOrder(html) {
  const declared = html.match(/\brace_id\s*=\s*(\[[^\]]*\])/);
  if (declared) {
    try {
      const ids = JSON.parse(declared[1]).map(String).filter(id => /^\d+$/.test(id));
      if (ids.length) return ids.reverse();
    } catch { /* fall through to the page order */ }
  }
  return null;
}

// Tidy display label for a session. SRH shouts its names ("CONSOLATION");
// title-case them so the picker reads like the rest of the app.
function sessionLabel(name) {
  return String(name || "Session").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// Whatever went wrong, in SRH's own words. Its error pages are a Bootstrap
// alert ("Series ID, Season ID, Schedule ID, or Race ID is required"), which is
// far more useful to an admin who mistyped an id than "no results found".
export function srhPageError(html) {
  const alert = String(html || "").match(/alert-danger[\s\S]{0,600}?<div>([^<]{3,200})<\/div>/);
  return alert ? decode(alert[1]) : "";
}

// Parse an SRH race page into the sessions it holds. Returns null when the text
// isn't an SRH results page at all (an error page, a login wall, a redirect to
// something else), so the caller can say so rather than import nothing.
//
// Rows are grouped by the race id each one carries rather than by which
// payload they arrived in, so a session can never end up with another's field.
export function parseSrhPage(html) {
  const text = String(html || "");
  if (!text) return null;

  const rows = [];
  for (const payload of jsonProps(text, "rps")) {
    if (Array.isArray(payload)) rows.push(...payload.filter(r => r && typeof r === "object"));
  }
  if (!rows.length) return null;

  const drivers = Object.assign({}, ...jsonProps(text, "drivers").filter(d => d && !Array.isArray(d)));
  const schedule = jsonProps(text, "schedule").find(s => s && !Array.isArray(s)) || {};
  const { names, stats } = sessionNames(text);

  // Grouped by race id, and deduplicated on the id SRH gives each driver's
  // entry in a session: a multi-class event renders a table per class as well
  // as the overall one, so the same row legitimately arrives more than once.
  const byRace = new Map();
  const seen = new Set();
  for (const row of rows) {
    const id = String(row.race_id ?? "").trim();
    if (!id) continue;
    const entryId = String(row.race_participant_id ?? row.driver_id ?? "").trim();
    if (entryId) {
      const entry = `${id}:${entryId}`;
      if (seen.has(entry)) continue;
      seen.add(entry);
    }
    if (!byRace.has(id)) byRace.set(id, []);
    byRace.get(id).push(row);
  }
  if (!byRace.size) return null;

  const event = {
    league_name: schedule.league_name || "",
    season_name: schedule.season_name || "",
    series_name: schedule.series_name || "",
    track: [schedule.track_name, schedule.track_config_name].filter(Boolean).join(" — "),
    race_date: schedule.race_date || "",
    planned_laps: schedule.planned_laps ?? null,
    schedule_id: schedule.schedule_id ?? null,
    season_id: schedule.season_id ?? null,
    series_id: schedule.series_id ?? null,
  };

  // Sessions in running order where the page declared one, otherwise in the
  // order their rows appeared.
  const declared = sessionOrder(text);
  const ordered = declared
    ? [...declared.filter(id => byRace.has(id)), ...[...byRace.keys()].filter(id => !declared.includes(id))]
    : [...byRace.keys()];

  // Did this night run its stages as sessions of their own? SimRacerHub scores
  // a stage separately AND rolls its points into the race total, so whether
  // those points are already accounted for depends on the page. See
  // srhRowPoints.
  const stagesScoredSeparately = [...names.values()].some(name => /\bSTAGE\b/i.test(name));

  const segments = ordered.map(id => {
    const rawName = names.get(id) || "";
    return {
      key: id,
      race_id: id,
      event,
      name: sessionLabel(rawName || "Race"),
      raw_name: rawName,
      type: sessionTypeFromName(rawName),
      driver_count: byRace.get(id).length,
      results: byRace.get(id),
      drivers,
      stages_scored_separately: stagesScoredSeparately,
      // The session's own caution / lead-change figures, for the event's race
      // statistics. Null on a session that prints none (qualifying, practice).
      stats: stats.get(id) || null,
    };
  });

  return { event, segments };
}

// ── 3. Session → table ────────────────────────────────────────────────────

export const SRH_HEADERS = [
  "Fin", "Start", "Car", "Driver", "Laps", "Led", "Inc",
  "Interval", "Race Time", "Best Lap", "Qual Time", "Status", "Points",
];

// SRH writes lap and qualifying times as decimal seconds ("90.2236"), with "0"
// for a driver who never set one. → the clock string the results grid stores
// ("1:30.224"), or "".
export function srhLapTime(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? formatTime(n) : "";
}

// Elapsed race time, which SRH reports in ten-thousandths of a second.
export function srhElapsed(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? formatTime(n / 10000) : "";
}

// A position, 1-based on SRH already, with "0" (and anything non-numeric)
// meaning there wasn't one — a qualifying session carries no starting position.
const pos = raw => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

// Gap to the winner, in the form the results grid reads (see lib/raceTime.js):
// "+2.345" for a time gap, "3L" for a car three laps down.
//
// SRH gives the gap twice: as a number in `intv` (seconds, whatever
// `intv_units` claims) and as the display string in `intv_str`, which is
// negative-signed ("-4.903") and spells a lap deficit as "-4L". Laps down are
// taken from that string first because it says so outright; the numeric field
// encodes the same thing as a multiple of 9999 seconds, which is the fallback.
export function srhInterval(row) {
  const str = String(row?.intv_str ?? "").trim();
  const down = str.match(/(\d+)\s*L$/i);
  if (down) return `${Number(down[1])}L`;

  const sec = Number(row?.intv);
  if (Number.isFinite(sec) && sec > 0) {
    if (sec >= 9999) {
      const laps = Math.round(sec / 9999);
      return laps > 0 ? `${laps}L` : "";
    }
    return formatGap(sec);
  }
  // No numeric gap: the leader ("-"), or a car with no gap at all.
  const gap = str.replace(/^[-+]/, "");
  return /^\d/.test(gap) ? `+${gap}` : "";
}

// How the driver's session ended, worded so the shared status parser (see
// truthyStatus in lib/resultsImport.js) reads it right. SRH's own wording
// already does for the most part: "Running" is a finisher, "Disconnected" and
// "Disqualified" are read as a DNF and a DQ. A driver with no status and no
// laps never started.
export function srhStatus(row) {
  const status = String(row?.status ?? "").trim();
  if (status) return status;
  return (Number(row?.num_laps) || 0) > 0 ? "Running" : "DNS";
}

// The name to match against the league's roster. SRH stores the iRacing name
// last-first ("Bage, John"), so it's flipped back — that's the name a driver is
// registered under here, and the form every alias on their profile is compared
// with. Its shortened display name ("J Bage") is the fallback, being the only
// name on the page for a driver the payload didn't carry.
export function srhDriverName(row, drivers = {}) {
  const stored = String(row?.name ?? "").trim();
  const profile = drivers?.[String(row?.driver_id ?? "")] || {};
  const source = stored || String(profile.last_first ?? "").trim();
  const [last, first] = source.split(",");
  const flipped = first ? `${first.trim()} ${last.trim()}`.trim() : source;
  return flipped || String(profile.name ?? "").trim();
}

// Was this driver awarded points without racing? SRH's own flag for it, which
// this app calls a provisional entry.
export const isProvisional = row => /^y/i.test(String(row?.provisional ?? ""));

// ── Points ────────────────────────────────────────────────────────────────
//
// SimRacerHub keeps a driver's points for a session in four parts, and its
// official total is exactly their sum:
//
//   rpts  position points for the session
//   bpts  bonuses, itemised in bonus_rows ("Led one or more laps", +1)
//   ppts  penalties, itemised in penalty_rows ("Cause of Caution", 5) — a
//         positive magnitude, subtracted
//   spts  stage points, rolled into a staged race's total
//   tpts  = rpts + bpts - ppts + spts
//
// That formula held on every row of every real race page this was built
// against, as did bonus_rows summing to bpts and penalty_rows to ppts.
//
// None of it overrides this app's own scoring. A finishing row is paid by the
// league's points structure here (pointsFor in lib/standings.js), off the
// position the grid holds, and an import that wrote SimRacerHub's total over
// that would be a second scorer disagreeing with the first. What DOES come
// across is the part this app can never work out for itself — see below — plus
// a provisional entry's flat value, which has no position to be derived from.

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Bonuses this app derives from the results themselves, by the words
// SimRacerHub describes them with. These are deliberately NOT carried into an
// imported row: whatever the season's own structure pays for the fastest lap,
// for leading a lap, for leading the most laps and for the biggest climb is
// already in the grid's Points column, worked out from the flags and the
// numbers the import just filled in. Carrying SimRacerHub's copy as well would
// pay the same bonus twice and inflate the championship.
//
// Pole is here for the same reason from the other end: this app scores
// Qualifying as its own session on its own line (see pointsFor), so a pole or
// grid-slot bonus SimRacerHub prints against the race is paid on the
// Qualifying grid instead.
const DERIVED_BONUS = [
  /FAST(EST)?\s*(RACE\s*)?LAP/,
  /LED\s+THE\s+MOST|MOST\s+LAPS?\s+LED/,
  /LED\s+(ONE|1|A)\b|LED\s+\d+\s+OR\s+MORE/,
  /HARD\s*CHARGER|MOST\s+POSITIONS?\s+GAINED/,
  /HALF\s*-?\s*WAY|HALFWAY/,
  /POLE\b|QUALIFIED\s*P?\s*\d/,
];

// Does this app pay for the thing a bonus row describes?
export const isDerivedBonus = descr => {
  const d = String(descr ?? "").toUpperCase();
  return DERIVED_BONUS.some(re => re.test(d));
};

const pointRows = list => (Array.isArray(list) ? list : [])
  .map(r => ({ points: num(r?.points), descr: String(r?.descr ?? "").trim() }))
  .filter(r => r.points || r.descr);

const sumPoints = list => list.reduce((t, r) => t + r.points, 0);

// One driver's points as SimRacerHub paid them, split into what this app works
// out for itself and what it cannot.
//
// `carried` is the net that belongs in the results grid's **Adj** column, a
// per-result adjustment applied on top of the scored points and documented for
// exactly this: a penalty or a correction that doesn't touch the finishing
// position.
//
//   + bonuses this app has no way to derive  ("No incidents", "Show Up")
//   − every penalty                          ("Cause of Caution", "14 incidents")
//   + stage points, but only when the page didn't score the stages as sessions
//     of their own. When it did, the statistician imports Stage 1 and Stage 2
//     into their own grids and this app pays them there, so rolling them into
//     the race as well would count them twice. `stagesScoredSeparately` says
//     which case this is; parseSrhPage works it out from the page's sessions.
export function srhRowPoints(row, { stagesScoredSeparately = false } = {}) {
  const bonuses = pointRows(row?.bonus_rows);
  const penalties = pointRows(row?.penalty_rows);
  const extras = bonuses.filter(b => !isDerivedBonus(b.descr));
  const stage = num(row?.spts);
  const stageCarried = !stagesScoredSeparately && stage !== 0;
  return {
    total: num(row?.tpts),
    race: num(row?.rpts),
    bonus: num(row?.bpts),
    penalty: num(row?.ppts),
    stage,
    derived: bonuses.filter(b => isDerivedBonus(b.descr)),
    extras,
    penalties,
    stage_carried: stageCarried,
    carried: sumPoints(extras) - sumPoints(penalties) + (stageCarried ? stage : 0),
  };
}

// One session → { headers, rows } in the shape parseTable() returns, ready for
// mapHeaders() + buildRows(). Rows come out in finishing order.
//
// `provisional` rides alongside as a boolean per row: SRH marks a driver who
// was awarded points without racing, and this app has a section for exactly
// that (Provisional Entries, at the bottom of the results screen), so the
// review table arrives with those rows already ticked.
export function srhSegmentTable(segment) {
  const qualifying = segment?.type === "qualifying";
  const drivers = segment?.drivers || {};
  const results = [...(segment?.results || [])].sort((a, b) => {
    const av = Number(a.finish_pos), bv = Number(b.finish_pos);
    return (Number.isFinite(av) && av > 0 ? av : Infinity) - (Number.isFinite(bv) && bv > 0 ? bv : Infinity);
  });

  const rows = results.map(r => {
    // In a qualifying session the driver's best lap IS their qualifying time.
    // In a race, `qualify_time` is the lap they qualified the event on, which
    // is what the grid's Qual Time column wants, and `fastest_lap_time` their
    // best lap of the run.
    const bestLap = srhLapTime(r.fastest_lap_time);
    const status = srhStatus(r);
    // A driver SRH paid provisionally didn't run the session, so the only cells
    // that mean anything are who they are and what they were paid. SRH still
    // prints a lap deficit against the winner for them ("120L") — not a result,
    // and not something to carry into a grid.
    const provisional = isProvisional(r);
    return [
      pos(r.finish_pos),
      qualifying || provisional ? "" : pos(r.qualify_pos),
      String(r.driver_number ?? "").trim(),
      srhDriverName(r, drivers),
      String(Number(r.num_laps) || 0),
      String(Number(r.laps_led) || 0),
      String(Number(r.incidents) || 0),
      qualifying || provisional ? "" : srhInterval(r),
      // Only a car that saw the flag has a meaningful elapsed time; for one
      // that dropped out it's whatever the clock said when it did, which is not
      // a race time.
      !qualifying && !provisional && /^running$/i.test(status) ? srhElapsed(r.elapsed_time) : "",
      bestLap,
      qualifying ? (bestLap || srhLapTime(r.qualify_time)) : srhLapTime(r.qualify_time),
      status,
      String(r.tpts ?? ""),
    ];
  });

  return {
    headers: [...SRH_HEADERS],
    rows,
    delimiter: "srh",
    provisional: results.map(isProvisional),
    // The points SimRacerHub paid each row, itemised, aligned with `rows`. The
    // Points column above carries the total for the review table to show and
    // for a provisional entry's flat value; this is what says which part of it
    // this app has no way to work out for itself. See srhRowPoints.
    points: results.map(r => srhRowPoints(r, {
      stagesScoredSeparately: !!segment?.stages_scored_separately,
    })),
  };
}

// The Pts cell's hover text in the review table: what SimRacerHub paid, term by
// term, and which terms this app will and will not take. Written so a total
// that looks off on the grid afterwards can be read rather than reverse-
// engineered — the same courtesy the grid's own Points cell does with
// explainPoints (see lib/standings.js).
export function srhPointsSummary(points, { provisional = false } = {}) {
  if (!points) return "";
  const n = v => (Number.isInteger(v) ? String(v) : String(Number(Number(v).toFixed(3))));
  const lines = [`SimRacerHub paid ${n(points.total)}`];
  const parts = [`position ${n(points.race)}`];
  if (points.bonus) parts.push(`bonus ${n(points.bonus)}`);
  if (points.penalty) parts.push(`penalty -${n(points.penalty)}`);
  if (points.stage) parts.push(`stage ${n(points.stage)}`);
  lines.push(parts.join(" · "));

  // A provisional entry has no finishing position to be scored off, so the
  // total is the whole answer for it.
  if (provisional) {
    lines.push("", `Imported as this provisional entry's points: ${n(points.total)}`);
    return lines.join("\n");
  }

  lines.push("");
  if (points.carried) {
    lines.push(`Carried to the grid's Adj column: ${points.carried > 0 ? "+" : ""}${n(points.carried)}`);
    for (const b of points.extras) lines.push(`  + ${b.descr || "bonus"} ${n(b.points)}`);
    for (const p of points.penalties) lines.push(`  - ${p.descr || "penalty"} ${n(p.points)}`);
    if (points.stage_carried) lines.push(`  + stage points ${n(points.stage)}`);
  } else {
    lines.push("Nothing carried — your own points structure scores this row.");
  }
  if (points.derived.length) {
    lines.push("", "Left to your own structure, which pays for these itself:");
    for (const b of points.derived) lines.push(`  · ${b.descr} ${n(b.points)}`);
  }
  if (points.stage && !points.stage_carried) {
    lines.push("", `Stage points (${n(points.stage)}) are scored on this event's own Stage sessions.`);
  }
  return lines.join("\n");
}

// The line of event detail the importer shows above its session picker.
export function srhEventLabel(event) {
  return [event?.league_name, event?.series_name, event?.track, event?.race_date]
    .map(v => String(v ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}
